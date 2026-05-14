// CC hook payload schema(M6 加,基于 docs/INTERNALS.md 实测结果)。
// 字段是 hook_event_name(不是 'event'!),实际 payload 通过 stdin 传给 hook 命令。
//
// AgentBay 在 M6 里只是"接收方":CC 启动后,用户的 ~/.claude/settings.json 里
// 配 hook 命令是 `curl POST http://127.0.0.1:7777/api/hook-event`,daemon 接收并
// 用 hook 数据增强已有的 status detection / token tracking。

import { z } from 'zod';

export const hookEventSchema = z.object({
  hook_event_name: z.string(),
  session_id: z.string(),
  cwd: z.string().optional(),
  tool_name: z.string().optional(),
  tool_input: z.unknown().optional(),
  tool_output: z.unknown().optional(),
  tool_use_id: z.string().optional(),
  prompt: z.string().optional(),
  message: z.string().optional(),
  /** Subagent 相关 */
  subagent_id: z.string().optional(),
  subagent_type: z.string().optional(),
  /** Token usage(部分 hook event 携带) */
  usage: z.object({
    input_tokens: z.number().optional(),
    output_tokens: z.number().optional(),
    cache_read_input_tokens: z.number().optional(),
    cache_creation_input_tokens: z.number().optional(),
  }).optional(),
}).passthrough();

export type HookEvent = z.infer<typeof hookEventSchema>;
