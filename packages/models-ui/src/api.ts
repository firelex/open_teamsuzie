import type { ChatMessage, ModelInfo } from '@teamsuzie/models';

export type { ChatMessage, ModelInfo };

export interface ModelsListResponse {
  configured: boolean;
  setup: string;
  models: ModelInfo[];
  /** The persisted default model (the one workflows use); null if none set. */
  defaultModelId: string | null;
}

/** Load the selectable model catalogue from the app's `/api/models`. */
export async function fetchModels(signal?: AbortSignal): Promise<ModelsListResponse> {
  const res = await fetch('/api/models', { credentials: 'include', signal });
  if (!res.ok) throw new Error(`Failed to load models (${res.status})`);
  return (await res.json()) as ModelsListResponse;
}

/** Persist the chosen default model — the one workflows use. */
export async function setDefaultModel(id: string): Promise<void> {
  const res = await fetch('/api/models/default', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `Failed to set default model (${res.status})`);
  }
}

/**
 * Stream a chat completion from `/api/models/chat`. Calls `onDelta` for each
 * text chunk; resolves when the stream is done; throws with the server's message
 * if the stream carries an {error} event (so the caller can show it in-viewport).
 */
export async function streamChat(
  req: { id: string; messages: ChatMessage[] },
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch('/api/models/chat', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`Chat request failed (${res.status})`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).replace(/\r$/, '');
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      const evt = JSON.parse(payload) as { text?: string; error?: string; done?: boolean };
      if (evt.error) throw new Error(evt.error);
      if (evt.done) return;
      if (typeof evt.text === 'string') onDelta(evt.text);
    }
  }
}
