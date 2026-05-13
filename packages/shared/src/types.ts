/** 一个工作目录 / repo,所有 workspace 在 dashboard 同时可见 */
export interface Workspace {
  id: string;            // uuid
  cwd: string;           // 绝对路径
  label: string;         // 默认为 cwd 的 basename
  createdAt: number;     // ms epoch
}

export type SessionMode = 'owned' | 'observed';
export type SessionState = 'running' | 'idle' | 'crashed' | 'ended';

/** 一个 claude 进程 */
export interface Session {
  id: string;            // = Claude Code 的 sessionId
  workspaceId: string;
  mode: SessionMode;
  pid: number | null;    // owned 才有
  state: SessionState;
  jsonlPath: string;     // 绝对路径
  jsonlOffset: number;   // 已读字节数
  startedAt: number;
  endedAt: number | null;
}

export type AgentState =
  | 'idle'
  | 'thinking'
  | 'tool-running'
  | 'blocked'
  | 'errored';

/** Session 内的角色(main + teammates) */
export interface Agent {
  id: string;            // = `${sessionId}:${name}`
  sessionId: string;
  name: string;          // 'main' | teammate name
  role: string | null;   // subagent_type
  state: AgentState;
  tokenCount: number;
  contextPct: number;
  lastActivityAt: number | null;
}

export type MessageKind =
  | 'user-prompt'
  | 'agent-dispatch'
  | 'send-message'
  | 'tool-call'
  | 'tool-result'
  | 'notification';

export interface MessageEvent {
  id: number;
  sessionId: string;
  ts: number;
  kind: MessageKind;
  fromAgent: string | null;
  toAgent: string | null;
  payload: Record<string, unknown>;
}

/** WebSocket 推送给前端的事件类型 */
export type WsEvent =
  | { type: 'workspace-created'; workspace: Workspace }
  | { type: 'workspace-updated'; workspace: Workspace }
  | { type: 'session-created'; session: Session }
  | { type: 'session-updated'; session: Session }
  | { type: 'session-ended'; sessionId: string }
  | { type: 'agent-created'; agent: Agent }
  | { type: 'agent-updated'; agent: Agent }
  | { type: 'message-event'; event: MessageEvent }
  | { type: 'snapshot'; workspaces: Workspace[]; sessions: Session[]; agents: Agent[] };
