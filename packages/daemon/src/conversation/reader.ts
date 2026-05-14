// 把 CC 的 jsonl 解析成浏览器聊天界面用的消息数组。
//
// jsonl 行实际格式见 docs/INTERNALS.md。每行一个 JSON 对象,关键字段:
//   { type: 'user'|'assistant'|'system'|'attachment', uuid, parentUuid, sessionId,
//     cwd, timestamp(ISO), isSidechain, message: { role, content, usage } }

import { createReadStream } from 'node:fs';
import readline from 'node:readline';
import type { ChatMessage, ContentBlock } from '@agent-bay/shared';

export async function readConversation(jsonlPath: string): Promise<ChatMessage[]> {
  const stream = createReadStream(jsonlPath, { encoding: 'utf-8' });
  const rl = readline.createInterface({ input: stream });
  const out: ChatMessage[] = [];
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      const msg = parseLine(obj);
      if (msg) out.push(msg);
    } catch { /* skip bad line */ }
  }
  return out;
}

interface RawLine {
  type?: string;
  uuid?: string;
  parentUuid?: string | null;
  timestamp?: string;
  isSidechain?: boolean;
  message?: {
    role?: string;
    content?: string | RawBlock[];
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
  subtype?: string;
}

interface RawBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string | unknown[];
  is_error?: boolean;
}

export function parseLine(raw: unknown): ChatMessage | null {
  const obj = raw as RawLine;
  if (!obj.type || !obj.uuid || !obj.timestamp) return null;
  if (obj.type !== 'user' && obj.type !== 'assistant' && obj.type !== 'system' && obj.type !== 'attachment') return null;

  const ts = Date.parse(obj.timestamp);
  if (!Number.isFinite(ts)) return null;

  let role: ChatMessage['role'];
  if (obj.type === 'assistant') role = 'assistant';
  else if (obj.type === 'system' || obj.type === 'attachment') role = 'system';
  else role = 'user';

  const blocks: ContentBlock[] = [];
  const content = obj.message?.content;
  if (typeof content === 'string') {
    blocks.push({ type: 'text', text: content });
  } else if (Array.isArray(content)) {
    for (const b of content) {
      const block = normalizeBlock(b);
      if (block) blocks.push(block);
    }
  }

  // user message 里如果只有 tool_result block,标记为 tool_result_synthetic 方便前端
  // 折叠/嵌入到对应 tool_use 旁边,不要作为独立 user bubble 渲染
  if (role === 'user' && blocks.length > 0 && blocks.every(b => b.type === 'tool_result')) {
    role = 'tool_result_synthetic';
  }

  const usage = obj.message?.usage;
  return {
    id: obj.uuid,
    parentId: obj.parentUuid ?? null,
    role,
    ts,
    blocks,
    isSidechain: !!obj.isSidechain,
    usage: usage ? {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheReadTokens: usage.cache_read_input_tokens,
      cacheCreationTokens: usage.cache_creation_input_tokens,
    } : undefined,
    systemSubtype: obj.subtype,
  };
}

function normalizeBlock(b: RawBlock): ContentBlock | null {
  if (!b || !b.type) return null;
  switch (b.type) {
    case 'text':
      return { type: 'text', text: b.text ?? '' };
    case 'thinking':
      return { type: 'thinking', thinking: b.thinking ?? '' };
    case 'tool_use':
      return { type: 'tool_use', id: b.id ?? '', name: b.name ?? '', input: b.input };
    case 'tool_result': {
      const c = typeof b.content === 'string' ? b.content : JSON.stringify(b.content);
      return { type: 'tool_result', tool_use_id: b.tool_use_id ?? '', content: c, is_error: b.is_error };
    }
    default:
      return null;
  }
}
