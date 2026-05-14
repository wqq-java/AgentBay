// 浏览器聊天界面用的消息结构(从 CC jsonl 解析出来)。

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

export interface ChatMessage {
  /** jsonl 行的 uuid */
  id: string;
  /** 父消息 uuid(parentUuid),用于线程化 */
  parentId: string | null;
  /** 'user' | 'assistant' | 'system' | 'tool_result_synthetic' */
  role: 'user' | 'assistant' | 'system' | 'tool_result_synthetic';
  /** ms epoch */
  ts: number;
  /** 解析后的内容块 */
  blocks: ContentBlock[];
  /** 是不是 sidechain(teammate 旁支) */
  isSidechain: boolean;
  /** token usage(仅 assistant) */
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
  };
  /** 系统消息子类型(只对 role=system 有意义) */
  systemSubtype?: string;
}
