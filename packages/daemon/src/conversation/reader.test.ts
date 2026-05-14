import { describe, it, expect } from 'vitest';
import { parseLine } from './reader.js';

describe('parseLine', () => {
  it('parses user text message', () => {
    const m = parseLine({
      type: 'user',
      uuid: 'u1',
      parentUuid: null,
      timestamp: '2026-05-13T07:00:00.000Z',
      message: { role: 'user', content: 'hello' },
    });
    expect(m?.role).toBe('user');
    expect(m?.blocks).toEqual([{ type: 'text', text: 'hello' }]);
  });

  it('parses user message with text block array', () => {
    const m = parseLine({
      type: 'user',
      uuid: 'u2',
      timestamp: '2026-05-13T07:00:00.000Z',
      message: { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    });
    expect(m?.role).toBe('user');
    expect(m?.blocks).toEqual([{ type: 'text', text: 'hi' }]);
  });

  it('parses assistant message with thinking + text + tool_use', () => {
    const m = parseLine({
      type: 'assistant',
      uuid: 'a1',
      timestamp: '2026-05-13T07:00:00.000Z',
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'let me think...' },
          { type: 'text', text: '回答你' },
          { type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: '/x' } },
        ],
        usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 5, cache_creation_input_tokens: 3 },
      },
    });
    expect(m?.role).toBe('assistant');
    expect(m?.blocks).toHaveLength(3);
    expect(m?.usage?.inputTokens).toBe(10);
    expect(m?.usage?.cacheReadTokens).toBe(5);
  });

  it('marks tool_result-only user message as tool_result_synthetic', () => {
    const m = parseLine({
      type: 'user',
      uuid: 'r1',
      timestamp: '2026-05-13T07:00:00.000Z',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'ok' }],
      },
    });
    expect(m?.role).toBe('tool_result_synthetic');
    expect(m?.blocks).toEqual([{ type: 'tool_result', tool_use_id: 'tu1', content: 'ok', is_error: undefined }]);
  });

  it('returns null for missing fields', () => {
    expect(parseLine({})).toBeNull();
    expect(parseLine({ type: 'user' })).toBeNull();
    expect(parseLine({ type: 'last-prompt', uuid: 'x', timestamp: '2026-05-13T07:00:00Z' })).toBeNull();
  });

  it('marks isSidechain', () => {
    const m = parseLine({
      type: 'assistant', uuid: 's1', timestamp: '2026-05-13T07:00:00Z',
      isSidechain: true, message: { role: 'assistant', content: 'side' },
    });
    expect(m?.isSidechain).toBe(true);
  });

  it('flattens object tool_result content to JSON string', () => {
    const m = parseLine({
      type: 'user', uuid: 'r2', timestamp: '2026-05-13T07:00:00Z',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu', content: [{ a: 1 }] }] },
    });
    const block = m?.blocks[0];
    expect(block?.type).toBe('tool_result');
    if (block?.type === 'tool_result') {
      expect(block.content).toBe('[{"a":1}]');
    }
  });
});
