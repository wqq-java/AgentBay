import { describe, it, expect } from 'vitest';
import { hookEventSchema } from './schemas.js';

describe('hookEventSchema', () => {
  it('accepts a SessionStart payload', () => {
    const result = hookEventSchema.safeParse({
      hook_event_name: 'SessionStart',
      session_id: 'abc',
      cwd: '/foo/bar',
    });
    expect(result.success).toBe(true);
  });

  it('rejects payload without hook_event_name', () => {
    const result = hookEventSchema.safeParse({ session_id: 'x' });
    expect(result.success).toBe(false);
  });

  it('accepts unknown extra fields(forward-compatible)', () => {
    const result = hookEventSchema.safeParse({
      hook_event_name: 'Stop',
      session_id: 'x',
      future_field_we_dont_know: 'whatever',
    });
    expect(result.success).toBe(true);
  });
});
