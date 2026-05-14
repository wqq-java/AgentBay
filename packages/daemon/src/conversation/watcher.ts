// 监控 agent 的 jsonl 文件变化,新行出现时 broadcast 'conversation-message-added' SSE event。
//
// 策略:
//   - 启动时为每个 online agent 找它的 jsonl 路径,记 byteOffset = 文件长度
//   - 用 fs.watch 监 cwd 目录;有 jsonl 改动时,从 byteOffset 开始读新增内容
//   - 解析新行 → broadcast(每条新消息)
//   - byteOffset 更新到当前长度
//
// 简化版(M1):每个 agent 起一个 fs.watch;数量增加时考虑共享 watcher。

import fs from 'node:fs/promises';
import { watch as fsWatch, type FSWatcher } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { createReadStream } from 'node:fs';
import type Database from 'better-sqlite3';
import type { ChatMessage, ServerEvent } from '@agent-bay/shared';
import { findAgentJsonl } from './discovery.js';
import { parseLine } from './reader.js';
import { listOnlineAgents, getAgent } from '../store/agents.js';

type BroadcastFn = (event: ServerEvent) => void;

interface WatcherState {
  jsonlPath: string;
  byteOffset: number;
  watcher: FSWatcher;
  /** 短时间内多次 fs 事件 debounce */
  pendingTimer: NodeJS.Timeout | null;
}

export interface ConversationWatchHandle {
  /** 重新扫描所有 agent,同步 watcher 集合;新 agent → 加 watcher,gone agent → 卸 */
  resync: () => Promise<void>;
  stop: () => void;
}

export function startConversationWatchers(
  db: Database.Database,
  broadcast: BroadcastFn,
): ConversationWatchHandle {
  const states = new Map<string, WatcherState>();  // agentId → state

  async function ensureWatcher(agentId: string) {
    if (states.has(agentId)) return;
    const agent = getAgent(db, agentId);
    if (!agent) return;
    const jsonlPath = await findAgentJsonl(agent);
    if (!jsonlPath) return;

    let byteOffset = 0;
    try { byteOffset = (await fs.stat(jsonlPath)).size; } catch { return; }

    const watcher = fsWatch(path.dirname(jsonlPath), { persistent: true }, (_evt, filename) => {
      if (filename !== path.basename(jsonlPath)) return;
      // debounce
      const s = states.get(agentId);
      if (!s) return;
      if (s.pendingTimer) clearTimeout(s.pendingTimer);
      s.pendingTimer = setTimeout(() => {
        void readNewLines(agentId, broadcast, states);
      }, 80);
    });

    states.set(agentId, { jsonlPath, byteOffset, watcher, pendingTimer: null });
  }

  async function unwatch(agentId: string) {
    const s = states.get(agentId);
    if (!s) return;
    if (s.pendingTimer) clearTimeout(s.pendingTimer);
    s.watcher.close();
    states.delete(agentId);
  }

  async function resync() {
    const live = new Set(listOnlineAgents(db).map(a => a.id));
    // 加新的
    for (const id of live) await ensureWatcher(id);
    // 移走 gone 的
    for (const id of states.keys()) {
      if (!live.has(id)) await unwatch(id);
    }
  }

  // 初次启动 + 每 10s 同步一次(scanner 可能加了新 agent)
  void resync();
  const interval = setInterval(() => { void resync(); }, 10000);

  return {
    resync,
    stop() {
      clearInterval(interval);
      for (const id of [...states.keys()]) void unwatch(id);
    },
  };
}

async function readNewLines(
  agentId: string,
  broadcast: BroadcastFn,
  states: Map<string, WatcherState>,
): Promise<void> {
  const s = states.get(agentId);
  if (!s) return;

  let stat;
  try { stat = await fs.stat(s.jsonlPath); } catch { return; }
  if (stat.size <= s.byteOffset) return;

  const stream = createReadStream(s.jsonlPath, {
    encoding: 'utf-8',
    start: s.byteOffset,
    end: stat.size - 1,
  });
  const rl = readline.createInterface({ input: stream });

  const newMessages: ChatMessage[] = [];
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const msg = parseLine(JSON.parse(line));
      if (msg) newMessages.push(msg);
    } catch { /* skip bad */ }
  }
  s.byteOffset = stat.size;

  for (const msg of newMessages) {
    broadcast({ type: 'chat-message', agentId, message: msg });
  }
}
