#!/usr/bin/env node
// AgentBay CLI 入口。
//
// 子命令:
//   agent-bay start          —— 起 daemon(默认)
//   agent-bay mcp-stdio      —— worker MCP stdio bridge,由 worker 通过其 mcp config 自动 spawn
//   agent-bay status         —— 查端口和 pid
//   agent-bay version
//
// mcp-stdio 模式说明:
//   每个 worker(Claude Code / Codex)在其 mcp 配置里把 AgentBay 加上,
//   像 { command: "agent-bay", args: ["mcp-stdio"] }。
//   该子进程随 worker 启动,从 env TMUX_PANE 推断自己服务的 agent 是哪个 pane,
//   然后 stdio 跟 worker 跑 MCP 协议。
//   M1 简化:mcp-stdio 直接打开同一个 SQLite db 工作,跟 daemon 共享数据。

import fs from 'node:fs';
import { startDaemon } from './main.js';
import { runStdioMcpServer } from './mcp/server.js';
import { openDb } from './store/db.js';
import { getDbPath, getDataDir } from './config/paths.js';

function ensureDataDir(): void {
  fs.mkdirSync(getDataDir(), { recursive: true });
}

async function cmdStart(): Promise<void> {
  ensureDataDir();
  const port = Number(process.env.AGENT_BAY_PORT ?? 7777);
  const daemon = await startDaemon({ port, dbPath: getDbPath() });
  console.log(`agent-bay daemon listening on http://127.0.0.1:${daemon.port}`);
  console.log(`db: ${getDbPath()}`);

  const shutdown = async (): Promise<void> => {
    console.log('\nshutting down...');
    await daemon.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function cmdMcpStdio(): Promise<void> {
  ensureDataDir();
  const db = openDb(getDbPath());

  // 推断 caller agent id —— 从 tmux env 推
  // tmux 在 pane 内启的进程会有 TMUX_PANE='%N' 环境变量
  const tmuxPane = process.env.TMUX_PANE ?? null;
  const callerAgentId = tmuxPane;

  await runStdioMcpServer({
    db,
    callerAgentId,
    // broadcast 是 no-op,因为 SSE 在 daemon 主进程里;
    // 这里写 db,主 daemon scanner+SSE 不直接看 mcp-stdio 的事件——
    // 但 daemon 的 scanner 每 5s 会查 db,前端 / 主 daemon broadcast 不会立刻知道。
    // M2 改进:用 unix socket 把 broadcast 转给主 daemon。
    broadcast: () => { /* M2 改进:转发给主 daemon */ },
  });
}

function cmdVersion(): void {
  console.log('agent-bay 0.0.1');
}

function cmdHelp(): void {
  console.log(`agent-bay — multi-agent coordination cockpit

Usage:
  agent-bay [start]      Start daemon (default; listens on 127.0.0.1:7777)
  agent-bay mcp-stdio    MCP stdio bridge (spawned by workers; not for human use)
  agent-bay version      Print version
  agent-bay help         Print this

Env:
  AGENT_BAY_PORT         Daemon port (default 7777)
`);
}

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? 'start';
  switch (cmd) {
    case 'start':
      await cmdStart();
      break;
    case 'mcp-stdio':
      await cmdMcpStdio();
      break;
    case 'version':
    case '-v':
    case '--version':
      cmdVersion();
      break;
    case 'help':
    case '-h':
    case '--help':
      cmdHelp();
      break;
    default:
      console.error(`unknown command: ${cmd}`);
      cmdHelp();
      process.exit(1);
  }
}

main().catch((e: unknown) => {
  console.error('fatal:', e);
  process.exit(1);
});
