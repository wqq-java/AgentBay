// MCP server 实现:用 @modelcontextprotocol/sdk 包出 6 个 tool。
// 这个 server 在 mcp-stdio 子进程里跑(每个 worker 一个 MCP server 实例)。

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type Database from 'better-sqlite3';
import {
  listAgentsTool, listTopicsTool, sendMessageTool, readTopicTool,
  createTopicTool, resolveTopicTool, type ToolContext,
} from './tools.js';
import { sendKeys } from '../scanner/tmux.js';

export interface CreateMcpServerOpts {
  db: Database.Database;
  /** 这个 MCP server 实例服务的是哪个 agent(从 mcp-stdio 进程的 env 推断) */
  callerAgentId: string | null;
  /** SSE/IPC 广播(M1 在 mcp-stdio 进程里 broadcast 暂时是 no-op,事件会写 db,主 daemon 由 db 触发器或 polling 转发) */
  broadcast?: (event: import('@agent-bay/shared').ServerEvent) => void;
}

export function createMcpServer(opts: CreateMcpServerOpts): McpServer {
  const server = new McpServer({
    name: 'agent-bay',
    version: '0.0.1',
  });

  const ctx: ToolContext = {
    db: opts.db,
    callerAgentId: opts.callerAgentId,
    broadcast: opts.broadcast ?? (() => { /* no-op */ }),
    sendKeys,
  };

  // 工具响应包装:MCP tool 必须返回 { content: [{type:'text', text:...}] }
  function ok(data: unknown) {
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  }
  function err(message: string) {
    return { content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }], isError: true };
  }

  server.tool(
    'list_agents',
    '列出当前在线的所有 agent(name, role, tool, status, groupId)',
    {},
    async () => ok(listAgentsTool(ctx)),
  );

  server.tool(
    'list_topics',
    '列出 topic。可选 group_id 过滤,默认只返回 open 状态的。',
    {
      group_id: z.string().optional().describe('Group id;不传则列出全部 group 的 topic'),
      only_open: z.boolean().optional().describe('默认 true,只返回未 resolve 的 topic'),
    },
    async (args) => ok(listTopicsTool(ctx, args)),
  );

  server.tool(
    'send_message',
    '在 topic 内发一条消息。会写入历史 + tmux send-keys 通知同 group 内的其他 agent。',
    {
      topic_id: z.string().describe('目标 topic 的 id'),
      body: z.string().describe('消息内容'),
    },
    async (args) => {
      try { return ok(await sendMessageTool(ctx, args)); }
      catch (e) { return err((e as Error).message); }
    },
  );

  server.tool(
    'read_topic',
    '读取 topic 的消息历史。设 unread_only=true 只取自己没读过的,并自动更新 read mark。',
    {
      topic_id: z.string().describe('目标 topic 的 id'),
      unread_only: z.boolean().optional().describe('只读未读消息(需要 callerAgentId)'),
      limit: z.number().int().positive().max(500).optional().describe('最多返回多少条(默认 100)'),
    },
    async (args) => {
      try { return ok(readTopicTool(ctx, args)); }
      catch (e) { return err((e as Error).message); }
    },
  );

  server.tool(
    'create_topic',
    '在 group 里开一个新 topic(线程)。',
    {
      group_id: z.string().describe('所属 group id'),
      title: z.string().describe('topic 标题'),
    },
    async (args) => ok(createTopicTool(ctx, args)),
  );

  server.tool(
    'resolve_topic',
    '把 topic 标记为 resolved,后续不再推送。',
    {
      topic_id: z.string().describe('要 resolve 的 topic id'),
    },
    async (args) => ok(resolveTopicTool(ctx, args)),
  );

  return server;
}

/**
 * 在 stdio transport 上启动 MCP server——给 mcp-stdio 子命令用。
 */
export async function runStdioMcpServer(opts: CreateMcpServerOpts): Promise<void> {
  const server = createMcpServer(opts);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
