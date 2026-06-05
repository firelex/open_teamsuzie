import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { reduceEvents, useChatThreadStream, type ChatStreamEvent } from '../use-chat-thread-stream.js';
import type { ChatAttachment, ChatThreadMessage } from '../types.js';

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

function makeStreamResponse(events: ChatStreamEvent[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const e of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      }
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

describe('useChatThreadStream.send', () => {
  beforeEach(() => {
    vi.stubGlobal('crypto', { randomUUID: () => 'fixed-id-' + Math.random().toString(36).slice(2, 7) });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('sends attachmentIds in the request body and renders them on the user turn', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeStreamResponse([{ type: 'done' }]));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useChatThreadStream({ endpoint: '/chat' }));
    const attachments: ChatAttachment[] = [
      { id: 'att-1', filename: 'shot.png', mimeType: 'image/png', url: '/uploads/shot.png' },
    ];

    await act(async () => {
      await result.current.send('look at this', { attachments });
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.attachmentIds).toEqual(['att-1']);
    expect(body.message).toBe('look at this');

    const userMsg = result.current.messages.find((m) => m.role === 'user');
    expect(userMsg?.attachments).toEqual(attachments);
  });

  it('allows sending with only attachments and substitutes a fallback message', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeStreamResponse([{ type: 'done' }]));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useChatThreadStream({ endpoint: '/chat' }));
    const attachments: ChatAttachment[] = [
      { id: 'att-2', filename: 'shot.png', mimeType: 'image/png', url: '/uploads/shot.png' },
    ];

    await act(async () => {
      await result.current.send('', { attachments });
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.message).toBe('(image attached)');
    expect(body.attachmentIds).toEqual(['att-2']);
  });

  it('parses JSON error.message from a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'rate limit' }), { status: 429 }),
    ));

    const { result } = renderHook(() => useChatThreadStream({ endpoint: '/chat' }));
    await act(async () => {
      await result.current.send('hi');
    });

    expect(result.current.error).toBe('rate limit');
    const assistant = result.current.messages.find((m) => m.role === 'assistant');
    expect(assistant?.pending).toBe(false);
    expect(assistant?.content).toContain('rate limit');
  });

  it('falls back to the raw body when the non-OK response is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('boom', { status: 500 }),
    ));

    const { result } = renderHook(() => useChatThreadStream({ endpoint: '/chat' }));
    await act(async () => {
      await result.current.send('hi');
    });

    expect(result.current.error).toBe('boom');
  });

  it('clears pending on stream end even without an explicit done event', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      makeStreamResponse([{ type: 'chunk', text: 'hello' }]),
    ));

    const { result } = renderHook(() => useChatThreadStream({ endpoint: '/chat' }));
    await act(async () => {
      await result.current.send('hi');
    });

    const assistant = result.current.messages.find((m) => m.role === 'assistant');
    expect(assistant?.pending).toBe(false);
    expect(assistant?.content).toBe('hello');
  });
});
