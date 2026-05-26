import { describe, it, expect } from 'vitest';
import { reduceEvents, type ChatStreamEvent } from '../use-chat-thread-stream.js';
import type { ChatThreadMessage } from '../types.js';

function userTurn(id: string, content: string): ChatThreadMessage {
  return { id, role: 'user', content };
}
function assistantSeed(id: string): ChatThreadMessage {
  return { id, role: 'assistant', content: '', pending: true };
}

describe('reduceEvents', () => {
  it('appends streamed chunks to the current assistant message', () => {
    const initial = [userTurn('u1', 'hi'), assistantSeed('a1')];
    const events: ChatStreamEvent[] = [
      { type: 'chunk', text: 'Hel' },
      { type: 'chunk', text: 'lo!' },
    ];
    const out = events.reduce((m, e) => reduceEvents(m, e, 'a1'), initial);
    const last = out[out.length - 1];
    expect(last.content).toBe('Hello!');
    expect(last.pending).toBe(true);
  });

  it('attaches a running tool_call to the current assistant message', () => {
    const initial = [userTurn('u1', 'hi'), assistantSeed('a1')];
    const events: ChatStreamEvent[] = [
      { type: 'tool_call', id: 't1', name: 'apply_manifest_patch', args: { instruction: 'noir' } },
    ];
    const out = events.reduce((m, e) => reduceEvents(m, e, 'a1'), initial);
    const last = out[out.length - 1];
    expect(last.toolCalls).toEqual([
      { id: 't1', name: 'apply_manifest_patch', args: { instruction: 'noir' }, status: 'running' },
    ]);
  });

  it('promotes tool_call to ok status on tool_result', () => {
    const initial = [
      userTurn('u1', 'hi'),
      { id: 'a1', role: 'assistant' as const, content: '', pending: true, toolCalls: [
        { id: 't1', name: 'apply_manifest_patch', args: {}, status: 'running' as const },
      ] },
    ];
    const events: ChatStreamEvent[] = [
      { type: 'tool_result', id: 't1', name: 'apply_manifest_patch', result: { ok: true } },
    ];
    const out = events.reduce((m, e) => reduceEvents(m, e, 'a1'), initial);
    const call = out[out.length - 1].toolCalls?.[0];
    expect(call?.status).toBe('ok');
    expect(call?.result).toEqual({ ok: true });
  });

  it('promotes tool_call to error status on tool_error', () => {
    const initial = [
      userTurn('u1', 'hi'),
      { id: 'a1', role: 'assistant' as const, content: '', pending: true, toolCalls: [
        { id: 't1', name: 'x', args: {}, status: 'running' as const },
      ] },
    ];
    const events: ChatStreamEvent[] = [
      { type: 'tool_error', id: 't1', name: 'x', error: 'boom' },
    ];
    const out = events.reduce((m, e) => reduceEvents(m, e, 'a1'), initial);
    const call = out[out.length - 1].toolCalls?.[0];
    expect(call?.status).toBe('error');
    expect(call?.error).toBe('boom');
  });

  it('clears pending on done', () => {
    const initial = [userTurn('u1', 'hi'), assistantSeed('a1')];
    const events: ChatStreamEvent[] = [{ type: 'chunk', text: 'ok' }, { type: 'done' }];
    const out = events.reduce((m, e) => reduceEvents(m, e, 'a1'), initial);
    const last = out[out.length - 1];
    expect(last.pending).toBe(false);
  });
});
