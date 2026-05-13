import { z } from 'zod';

/**
 * Claude Code hook payload。
 * 字段以实测为准(见 docs/INTERNALS.md);.passthrough() 让未知字段不报错。
 *
 * 关键:CC hook payload 的事件名字段是 `hook_event_name`(不是 `event`!)
 */
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
}).passthrough();

export type HookEvent = z.infer<typeof hookEventSchema>;
