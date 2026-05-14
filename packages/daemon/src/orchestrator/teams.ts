// 一键建团队 —— 选模板 / 起团队名 / 选 cwd → spawn N 个 CC pane,
// 自动建 group + 加成员 + 给每个 pane 发"你是 @<role>"角色 kickoff。

import type Database from 'better-sqlite3';
import type { Agent, Group, ServerEvent } from '@agent-bay/shared';
import type { Config } from '../config/config.js';
import { spawnWorker } from './spawn.js';
import { createGroup, getGroupByName } from '../store/groups.js';
import { sendKeys } from '../scanner/tmux.js';

type BroadcastFn = (e: ServerEvent) => void;

export interface TeamMemberSpec {
  /** 显示名/角色,例 'main' / 'architect' / 'backend' */
  role: string;
  /** 启动命令,默认 'claude' */
  command?: string;
  /** 角色 kickoff 文本,spawn 后自动作为第一条消息发给 pane */
  kickoff?: string;
}

export interface TeamTemplate {
  id: string;
  name: string;
  description: string;
  members: TeamMemberSpec[];
}

export const TEAM_TEMPLATES: TeamTemplate[] = [
  {
    id: 'fullstack',
    name: '全栈团队',
    description: '5 角色:main(team-lead) + architect + backend + frontend + tester。适合一个项目的完整开发任务。',
    members: [
      { role: 'main', kickoff: '你是 @main(team lead)。等用户提需求后,负责拆任务派给 @architect/@backend/@frontend/@tester,推进 + 验收。' },
      { role: 'architect', kickoff: '你是 @architect。@main 派来的需求,负责出方案/接口/数据流,通过 SendMessage 答复 @main。' },
      { role: 'backend', kickoff: '你是 @backend。@main 派来的后端任务,实现 + 单测 + commit;通过 SendMessage 报进度给 @main。' },
      { role: 'frontend', kickoff: '你是 @frontend。@main 派来的前端任务,实现 + 验视觉 + commit;通过 SendMessage 报进度。' },
      { role: 'tester', kickoff: '你是 @tester。@main 派来的回归 / 验证任务,跑测试或人工验,反馈结果给 @main。' },
    ],
  },
  {
    id: 'frontend-backend',
    name: '前后端二人组',
    description: '2 角色:backend + frontend。简单的接口对接场景。',
    members: [
      { role: 'backend', kickoff: '你是 @backend,负责后端 API/数据库;有事跟 @frontend 通过 SendMessage 沟通。' },
      { role: 'frontend', kickoff: '你是 @frontend,负责前端实现;有事跟 @backend 沟通。' },
    ],
  },
  {
    id: 'review-pair',
    name: 'Writer + Reviewer',
    description: '2 角色:writer 写、reviewer 严格 review。适合代码审查 / 文章对峙。',
    members: [
      { role: 'writer', kickoff: '你是 @writer。负责按用户需求出第一版;@reviewer 会评审,你按反馈改。' },
      { role: 'reviewer', kickoff: '你是 @reviewer。三档评审:approved / changes / escalate。禁说"看起来没问题"——必须给具体理由。' },
    ],
  },
  {
    id: 'solo',
    name: '单 Agent 会话',
    description: '1 个 agent,纯单聊。适合普通任务。',
    members: [
      { role: 'main', kickoff: '' },
    ],
  },
];

export function getTeamTemplates(): TeamTemplate[] {
  return TEAM_TEMPLATES;
}

export interface CreateTeamArgs {
  name: string;          // group name(必须唯一)
  cwd: string;
  templateId?: string;   // 不传则需要 members
  members?: TeamMemberSpec[];
  /** 启动命令默认 claude;如果用户改了 config 也可以 codex */
  defaultCommand?: string;
}

export interface CreateTeamResult {
  group: Group;
  agents: Agent[];
  errors: Array<{ role: string; error: string }>;
}

export async function createTeam(
  db: Database.Database,
  config: Config,
  args: CreateTeamArgs,
  broadcast: BroadcastFn,
): Promise<CreateTeamResult> {
  if (!args.name?.trim()) throw new Error('team name required');
  if (!args.cwd?.trim()) throw new Error('cwd required');

  // 查 members:模板 or 自定义
  let members: TeamMemberSpec[] = args.members ?? [];
  if (args.templateId) {
    const tpl = TEAM_TEMPLATES.find(t => t.id === args.templateId);
    if (!tpl) throw new Error(`template ${args.templateId} not found`);
    members = tpl.members;
  }
  if (members.length === 0) throw new Error('team has no members');

  // 建 group(如果同名已存在则复用 —— 用户可能再加成员)
  let group = getGroupByName(db, args.name);
  if (!group) {
    group = createGroup(db, { name: args.name, description: `Team · ${args.templateId ?? 'custom'}` });
    broadcast({ type: 'group-created', group });
  }

  const defaultCommand = args.defaultCommand ?? 'claude';
  const agents: Agent[] = [];
  const errors: Array<{ role: string; error: string }> = [];

  for (const m of members) {
    try {
      const r = await spawnWorker(db, config, {
        command: m.command ?? defaultCommand,
        cwd: args.cwd,
        name: `${args.name}/${m.role}`,
        role: m.role,
        groupId: group.id,
        waitTimeoutMs: 8000,
      }, broadcast);
      agents.push(r.agent);

      // 角色 kickoff:tmux send-keys 把 kickoff 文本送进 pane(带回车自动 submit)
      if (m.kickoff?.trim()) {
        // 给 CC 一点时间初始化
        await new Promise(res => setTimeout(res, 800));
        try {
          await sendKeys(r.agent.tmuxTarget, m.kickoff, { enter: true });
        } catch (e) {
          errors.push({ role: m.role, error: `kickoff 失败:${(e as Error).message}` });
        }
      }
    } catch (e) {
      errors.push({ role: m.role, error: (e as Error).message });
    }
  }

  return { group, agents, errors };
}
