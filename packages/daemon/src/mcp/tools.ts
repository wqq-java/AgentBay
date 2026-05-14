// 6 个 MCP tool 的核心逻辑(纯函数,易测)。
// 每个 tool 接收 db + callerAgentId + 入参,返回结果对象。
// "如何把 callerAgentId 注入" 是 mcp-stdio bridge 进程的事(从 env TMUX_PANE 取)。

import type Database from 'better-sqlite3';
import type { Agent, Topic, Message, Group, ServerEvent } from '@agent-bay/shared';
import { listOnlineAgents, getAgent } from '../store/agents.js';
import {
  listTopicsByGroup, listAllTopics, createTopic as dbCreateTopic, getTopic, resolveTopic as dbResolveTopic,
} from '../store/topics.js';
import { insertMessage, listMessagesByTopic, listUnreadMessages, markRead } from '../store/messages.js';
import { listGroups, getOrCreateDmGroup } from '../store/groups.js';

type BroadcastFn = (event: ServerEvent) => void;

export interface ToolContext {
  db: Database.Database;
  broadcast: BroadcastFn;
  callerAgentId: string | null;  // null 表示来自 human/external(如 HTTP API);MCP 调用一般都有
  /** tmux send-keys 实现(注入便于测试) */
  sendKeys: (target: string, body: string, opts?: { enter?: boolean }) => Promise<void>;
}

// ── tool 1: list_agents ────────────────────────────────

export interface ListAgentsResult {
  agents: Array<Pick<Agent, 'id' | 'name' | 'role' | 'tool' | 'status' | 'groupId'>>;
}

export function listAgentsTool(ctx: ToolContext): ListAgentsResult {
  return {
    agents: listOnlineAgents(ctx.db).map(a => ({
      id: a.id, name: a.name, role: a.role, tool: a.tool, status: a.status, groupId: a.groupId,
    })),
  };
}

// ── tool 2: list_topics ────────────────────────────────

export interface ListTopicsArgs {
  group_id?: string;     // 不传 = 所有 group
  only_open?: boolean;   // 默认 true
}

export interface ListTopicsResult {
  topics: Array<Pick<Topic, 'id' | 'groupId' | 'title' | 'state' | 'createdAt'>>;
  groups: Array<Pick<Group, 'id' | 'name'>>;
}

export function listTopicsTool(ctx: ToolContext, args: ListTopicsArgs = {}): ListTopicsResult {
  const onlyOpen = args.only_open ?? true;
  const groups = listGroups(ctx.db);
  let topics: Topic[];
  if (args.group_id) {
    topics = listTopicsByGroup(ctx.db, args.group_id, { onlyOpen });
  } else {
    const all = listAllTopics(ctx.db);
    topics = onlyOpen ? all.filter(t => t.state === 'open') : all;
  }
  return {
    topics: topics.map(t => ({
      id: t.id, groupId: t.groupId, title: t.title, state: t.state, createdAt: t.createdAt,
    })),
    groups: groups.map(g => ({ id: g.id, name: g.name })),
  };
}

// ── tool 3: send_message ───────────────────────────────

export interface SendMessageArgs {
  topic_id: string;
  body: string;
  image_path?: string;
}

export interface SendMessageResult {
  message_id: number;
  delivered_to: string[]; // agent ids the message was tmux send-keys'd to
}

export async function sendMessageTool(ctx: ToolContext, args: SendMessageArgs): Promise<SendMessageResult> {
  const topic = getTopic(ctx.db, args.topic_id);
  if (!topic) throw new Error(`topic ${args.topic_id} not found`);
  if (topic.state !== 'open') throw new Error(`topic ${args.topic_id} is resolved`);

  // 写入消息
  const msg = insertMessage(ctx.db, {
    topicId: topic.id,
    fromAgentId: ctx.callerAgentId,
    body: args.body,
    imagePath: args.image_path ?? null,
  });

  // 广播
  ctx.broadcast({ type: 'message-created', message: msg });

  // 派送给同 group 的其他在线 agent(tmux send-keys 通知文本)
  const fromAgent = ctx.callerAgentId ? getAgent(ctx.db, ctx.callerAgentId) : null;
  const fromName = fromAgent?.name ?? 'human';
  const imgSuffix = args.image_path ? ` [image: ${args.image_path}]` : '';
  const delivered: string[] = [];
  const recipients = listOnlineAgents(ctx.db).filter(
    a => a.groupId === topic.groupId && a.id !== ctx.callerAgentId,
  );
  for (const r of recipients) {
    try {
      await ctx.sendKeys(r.tmuxTarget, `\n[from @${fromName}] ${args.body}${imgSuffix}\n`);
      delivered.push(r.id);
    } catch (e) {
      console.warn(`[send_message] failed to deliver to ${r.id}:`, e);
    }
  }

  return { message_id: msg.id, delivered_to: delivered };
}

// ── tool 7: send_dm(1v1 私聊)────────────────────────

export interface SendDmArgs {
  to_agent_id: string;
  body: string;
  image_path?: string;
}

export interface SendDmResult {
  topic_id: string;
  message_id: number;
  delivered: boolean;
}

export async function sendDmTool(ctx: ToolContext, args: SendDmArgs): Promise<SendDmResult> {
  if (!ctx.callerAgentId) throw new Error('send_dm requires a caller agent (DM 不支持 human 发起,用 send_message 走 group)');
  if (args.to_agent_id === ctx.callerAgentId) throw new Error('cannot DM yourself');
  const target = getAgent(ctx.db, args.to_agent_id);
  if (!target) throw new Error(`target agent ${args.to_agent_id} not found`);

  const dm = getOrCreateDmGroup(ctx.db, ctx.callerAgentId, args.to_agent_id);

  // 把双方都加入这个 dm group(以便 listAgentsByGroup 能找到)
  // 注:每个 agent 只能在一个 group 里,DM 不能颠覆主 group 归属;
  // 所以这里 *不* 改 agent.groupId,DM 关联只通过 group.is_dm + name 推断
  // (双方的 agent 仍属于他们各自的主 group)

  // 找/建当前 open 的 topic;一个 DM 通常只用一个长 topic
  const topics = listTopicsByGroup(ctx.db, dm.id, { onlyOpen: true });
  const topic = topics[0] ?? dbCreateTopic(ctx.db, {
    groupId: dm.id,
    title: 'DM',
    createdBy: ctx.callerAgentId,
  });
  if (topics.length === 0) {
    ctx.broadcast({ type: 'topic-created', topic });
  }

  const msg = insertMessage(ctx.db, {
    topicId: topic.id,
    fromAgentId: ctx.callerAgentId,
    body: args.body,
    imagePath: args.image_path ?? null,
  });
  ctx.broadcast({ type: 'message-created', message: msg });

  // 直送目标 pane
  const fromAgent = getAgent(ctx.db, ctx.callerAgentId);
  const fromName = fromAgent?.name ?? ctx.callerAgentId;
  const imgSuffix = args.image_path ? ` [image: ${args.image_path}]` : '';
  let delivered = false;
  if (target.status !== 'gone') {
    try {
      await ctx.sendKeys(target.tmuxTarget, `\n[DM @${fromName}] ${args.body}${imgSuffix}\n`);
      delivered = true;
    } catch (e) {
      console.warn(`[send_dm] failed to deliver to ${target.id}:`, e);
    }
  }

  return { topic_id: topic.id, message_id: msg.id, delivered };
}

// ── tool 4: read_topic ─────────────────────────────────

export interface ReadTopicArgs {
  topic_id: string;
  unread_only?: boolean;
  limit?: number;
}

export interface ReadTopicResult {
  topic: Pick<Topic, 'id' | 'title' | 'state' | 'groupId'>;
  messages: Array<Pick<Message, 'id' | 'fromAgentId' | 'body' | 'ts' | 'kind'>>;
}

export function readTopicTool(ctx: ToolContext, args: ReadTopicArgs): ReadTopicResult {
  const topic = getTopic(ctx.db, args.topic_id);
  if (!topic) throw new Error(`topic ${args.topic_id} not found`);

  const limit = args.limit ?? 100;
  let messages: Message[];
  if (args.unread_only && ctx.callerAgentId) {
    messages = listUnreadMessages(ctx.db, ctx.callerAgentId, topic.id, limit);
  } else {
    messages = listMessagesByTopic(ctx.db, topic.id, { limit });
  }

  // 更新 read mark 到最后一条
  if (ctx.callerAgentId && messages.length > 0) {
    const lastId = messages[messages.length - 1].id;
    markRead(ctx.db, ctx.callerAgentId, topic.id, lastId);
  }

  return {
    topic: { id: topic.id, title: topic.title, state: topic.state, groupId: topic.groupId },
    messages: messages.map(m => ({
      id: m.id, fromAgentId: m.fromAgentId, body: m.body, ts: m.ts, kind: m.kind,
    })),
  };
}

// ── tool 5: create_topic ───────────────────────────────

export interface CreateTopicArgs {
  group_id: string;
  title: string;
}

export interface CreateTopicResult {
  topic: Topic;
}

export function createTopicTool(ctx: ToolContext, args: CreateTopicArgs): CreateTopicResult {
  const topic = dbCreateTopic(ctx.db, {
    groupId: args.group_id,
    title: args.title,
    createdBy: ctx.callerAgentId,
  });
  ctx.broadcast({ type: 'topic-created', topic });
  return { topic };
}

// ── tool 6: resolve_topic ──────────────────────────────

export interface ResolveTopicArgs {
  topic_id: string;
}

export interface ResolveTopicResult {
  topic: Topic | null;
}

export function resolveTopicTool(ctx: ToolContext, args: ResolveTopicArgs): ResolveTopicResult {
  const topic = dbResolveTopic(ctx.db, args.topic_id);
  if (topic) ctx.broadcast({ type: 'topic-updated', topic });
  return { topic };
}
