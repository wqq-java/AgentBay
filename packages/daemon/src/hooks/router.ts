import path from 'node:path';
import type Database from 'better-sqlite3';
import { createOrGetWorkspaceByCwd } from '../store/workspaces.js';
import { upsertSession, getSession } from '../store/sessions.js';
import { getClaudeProjectsDir, encodeCwdAsProjectDirName } from '../config/paths.js';
import type { Session, WsEvent } from '@claude-teams/shared';
import type { HookEvent } from './schemas.js';

type BroadcastFn = (event: WsEvent) => void;

/**
 * 主入口:按 event 类型分发。M1 只处理 SessionStart;其他 event 仅记录到日志,留给 M2 实现。
 */
export function handleHookEvent(db: Database.Database, broadcast: BroadcastFn, ev: HookEvent): void {
  switch (ev.hook_event_name) {
    case 'SessionStart':
      handleSessionStart(db, broadcast, ev);
      break;
    // M1 暂不处理其他 event
    default:
      break;
  }
}

function handleSessionStart(db: Database.Database, broadcast: BroadcastFn, ev: HookEvent): void {
  if (!ev.cwd) return; // 没有 cwd 无法归类 workspace,跳过
  if (getSession(db, ev.session_id)) return; // 已存在,幂等

  const ws = createOrGetWorkspaceByCwd(db, ev.cwd);
  const encoded = encodeCwdAsProjectDirName(ev.cwd);
  const jsonlPath = path.join(getClaudeProjectsDir(), encoded, `${ev.session_id}.jsonl`);

  const session: Session = {
    id: ev.session_id,
    workspaceId: ws.id,
    mode: 'observed',
    pid: null,
    state: 'running',
    jsonlPath,
    jsonlOffset: 0,
    startedAt: Date.now(),
    endedAt: null,
  };
  upsertSession(db, session);

  broadcast({ type: 'workspace-created', workspace: ws });
  broadcast({ type: 'session-created', session });
}
