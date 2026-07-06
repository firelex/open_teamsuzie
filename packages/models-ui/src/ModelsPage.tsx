import { useEffect, useRef, useState } from 'react';
import { PageShell, PageBody, Card, Button, Boxes, Send, Loader2 } from '@teamsuzie/ui';

import type { ChatMessage, ModelInfo } from './api.js';
import { fetchModels, streamChat, setDefaultModel } from './api.js';
import { ModelPicker } from './ModelPicker.js';

/** Stable test ids for the Models page (self-contained in the package). */
export const MODELS_TESTIDS = {
  page: 'models-page',
  picker: 'models-picker',
  input: 'models-input',
  send: 'models-send',
  error: 'models-error',
  empty: 'models-empty',
  message: (i: number) => `models-message-${i}`,
} as const;

/**
 * The shared Models page: pick a hosted or reachable-local model and chat with
 * it. Hosted models use the API keys inherited from the parent app — the page
 * never asks for a key. When nothing is available it shows a visible reason
 * (not a silent empty screen); a provider error is shown inline by the input.
 */
export function ModelsPage() {
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [setup, setSetup] = useState('');
  const [selected, setSelected] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    fetchModels()
      .then((r) => {
        if (!live) return;
        setModels(r.models);
        setSetup(r.setup);
        // Restore the persisted default (the workflow model) if still available,
        // else fall back to the first available model.
        const preset =
          r.defaultModelId && r.models.some((m) => m.id === r.defaultModelId && m.available)
            ? r.defaultModelId
            : r.models.find((m) => m.available)?.id;
        if (preset) setSelected(preset);
      })
      .catch((e) => {
        if (!live) return;
        setModels([]);
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      live = false;
    };
  }, []);

  // Keep a provider/refusal error in view (never stranded off-screen).
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [error]);

  const anyAvailable = (models ?? []).some((m) => m.available);

  // Picking a model both drives the chat AND persists it as the default the
  // app's workflows use.
  const onPickModel = (id: string) => {
    setSelected(id);
    setError(null);
    void setDefaultModel(id).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };

  const send = async () => {
    const text = input.trim();
    if (!text || !selected || busy) return;
    setError(null);
    const history = [...messages, { role: 'user', content: text } as ChatMessage];
    setMessages([...history, { role: 'assistant', content: '' }]);
    setInput('');
    setBusy(true);
    try {
      await streamChat({ id: selected, messages: history }, (delta) => {
        setMessages((prev) => {
          const next = prev.slice();
          const last = next[next.length - 1];
          next[next.length - 1] = { role: 'assistant', content: last.content + delta };
          return next;
        });
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageShell
      icon={Boxes}
      kicker="Workspace"
      title="Models"
      tagline="Pick a model and chat with it. Hosted models use the API keys inherited from the parent app — no key needed here. Reachable local runtimes appear too."
    >
      <PageBody data-testid={MODELS_TESTIDS.page}>
        {models === null ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading models…
          </div>
        ) : !anyAvailable ? (
          <Card data-testid={MODELS_TESTIDS.empty} className="max-w-2xl p-6">
            <h2 className="text-base font-semibold text-foreground">No models available</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {setup ||
                'The parent app has no provider API keys configured. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or DASHSCOPE_API_KEY in the environment and reload.'}
            </p>
          </Card>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm font-medium text-foreground">Model</span>
                <ModelPicker
                  models={models}
                  value={selected}
                  onChange={onPickModel}
                  testid={MODELS_TESTIDS.picker}
                />
              </div>
              <span className="text-xs text-muted-foreground">
                The selected model is used for chat here and by the app's workflows.
              </span>
            </div>

            {error && (
              <div
                ref={errorRef}
                data-testid={MODELS_TESTIDS.error}
                role="alert"
                className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"
              >
                {error}
              </div>
            )}

            <Card className="flex min-h-[22rem] flex-col gap-3 p-4">
              <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
                {messages.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Send a message to test the selected model.</p>
                ) : (
                  messages.map((m, i) => (
                    <div
                      key={i}
                      data-testid={MODELS_TESTIDS.message(i)}
                      className={
                        m.role === 'user'
                          ? 'max-w-[85%] self-end rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground'
                          : 'max-w-[85%] self-start rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-foreground'
                      }
                    >
                      <div className="whitespace-pre-wrap">
                        {m.content || (busy && i === messages.length - 1 ? '…' : '')}
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="flex items-end gap-2">
                <textarea
                  data-testid={MODELS_TESTIDS.input}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  placeholder="Message the model…  (Enter to send, Shift+Enter for a newline)"
                  rows={2}
                  className="min-h-[2.75rem] flex-1 resize-y rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <Button
                  data-testid={MODELS_TESTIDS.send}
                  onClick={() => void send()}
                  disabled={busy || !input.trim() || !selected}
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Send
                </Button>
              </div>
            </Card>
          </div>
        )}
      </PageBody>
    </PageShell>
  );
}
