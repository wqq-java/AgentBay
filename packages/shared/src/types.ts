// AgentBay shared types (v2)
// 参考 [[wiki/项目/AgentBay/设计.md]] §4 数据模型

// ─── Agent ────────────────────────────────────────────────

export type AgentTool = 'claude-code' | 'codex' | 'unknown';

export type AgentStatus =
  | 'online'           // 进程存活,M1 阶段所有发现的 pane 默认是这个
  | 'idle'             // M2 状态机识别:无输出
  | 'active'           // M2:正在产出
  | 'waiting-approval' // M2:CC 权限确认框
  | 'waiting-input'    // M2:等待用户输入
  | 'rate-limited'     // M2:Codex/CC 限流
  | 'gone';            // pane 消失

export interface Agent {
  id: string;                                // = tmuxTarget,如 "main:0.1"
  name: string;                              // 显示名,可由用户改;默认从 pane title 或 tool 推断
  role: string | null;                       // 角色画像
  tmuxTarget: string;                        // tmux send-keys -t 用的 target
  pid: number | null;                        // pane 进程 pid(用于活跃检测)
  tool: AgentTool;
  status: AgentStatus;
  statusMeta: Record<string, unknown> | null; // 如 { rateLimitResetsAt: 1735000000 }
  groupId: string | null;                    // 所属 group(可空,表未分配)
  isSpawned: boolean;                        // M3:由 AgentBay spawn 出来的(允许 kill);false 表示用户手起的
  lastSeenAt: number;
  createdAt: number;
}

/** Worker profile —— 预注册的工人画像,spawn 时可用来填默认值 */
export interface WorkerProfile {
  id: string;
  name: string;
  role: string | null;
  command: string;       // 起动命令,例 "claude" / "codex --model gpt-5"
  cwd: string;           // 工作目录
  groupId: string | null; // spawn 后自动加入哪个 group
  description: string | null;
  createdAt: number;
}

// ─── Group / Topic / Message ─────────────────────────────

export interface Group {
  id: string;
  name: string;
  description: string | null;
  isDm: boolean;
  createdAt: number;
}

export type TopicState = 'open' | 'resolved';

export interface Topic {
  id: string;
  groupId: string;
  title: string;
  state: TopicState;
  resolvedAt: number | null;
  createdAt: number;
  createdBy: string | null;
}

export type MessageKind = 'text' | 'ack' | 'system' | 'image';

export interface Message {
  id: number;
  topicId: string;
  fromAgentId: string | null;
  body: string;
  imagePath: string | null;
  ts: number;
  kind: MessageKind;
}

export interface ReadMark {
  agentId: string;
  topicId: string;
  lastMessageId: number;
}

// ─── 接口契约 ───────────────────────────────────────────

/** GET /api/snapshot 的返回 */
export interface Snapshot {
  agents: Agent[];
  groups: Group[];
  topics: Topic[];
}

/** SSE /api/events 流推给前端的事件 */
export type ServerEvent =
  | { type: 'agent-created'; agent: Agent }
  | { type: 'agent-updated'; agent: Agent }
  | { type: 'agent-gone'; agentId: string }
  | { type: 'group-created'; group: Group }
  | { type: 'group-updated'; group: Group }
  | { type: 'topic-created'; topic: Topic }
  | { type: 'topic-updated'; topic: Topic }
  | { type: 'message-created'; message: Message }
  | { type: 'chat-message'; agentId: string; message: import('./chat.js').ChatMessage }
  | { type: 'group-deleted'; groupId: string };
