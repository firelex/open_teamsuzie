import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useClientSafe } from '../shell/ClientSafeContext.js';
import {
  ArtifactPanel,
  Button,
  ChatThread,
  CompareTable,
  MarkdownMessage,
  RedlinePanelContent,
  TrackedChangesPanel,
  WorkflowPickerDialog,
  humanSize,
  progressiveArtifactStream,
  useChatComposer,
  useSelectedModel,
  useSidePanel,
  useWorkflows,
  type ArtifactSnapshot,
  type ChatThreadMessage,
  type ChatToolCall,
  type ProposeEditsResult,
  type RedlineParagraph,
  type ResolveResponse,
  type ToolEvent,
  type Workflow,
} from '@teamsuzie/ui';
import type { DocumentDiffResult } from '@teamsuzie/docx-diff';
import type { Chat, ChatMessage as PersistedChatMessage } from '@teamsuzie/chats';

const SELECTED_MODEL_KEY = 'starter-chat:selected-model';

/**
 * Adapt a persisted chat-message row into the ChatThread message shape.
 * The persisted `toolEvents` JSON string carries entries with status
 * `running|done|error`; ChatThread's ChatToolCall uses `running|ok|error`,
 * so the `done` → `ok` rename happens here.
 */
function hydratePersistedToThread(
  messages: PersistedChatMessage[],
): ChatThreadMessage[] {
  return messages.map((m) => {
    const out: ChatThreadMessage = {
      id: m.id,
      role: m.role,
      content: m.content,
    };
    if (m.toolEvents) {
      try {
        const events = JSON.parse(m.toolEvents) as ToolEvent[];
        if (Array.isArray(events) && events.length > 0) {
          // chat-route persists every event (tool_call, tool_result, tool_error)
          // and they all share the same `id`. Dedupe by id, keeping the LAST
          // entry per id so the final result/status overrides the initial call.
          // Without this, React fires a duplicate-key warning on the rendered
          // toolCalls list.
          const byId = new Map<string, ToolEvent>();
          for (const e of events) {
            if (e && typeof e.id === 'string') byId.set(e.id, e);
          }
          out.toolCalls = Array.from(byId.values()).map<ChatToolCall>((e) => ({
            id: e.id,
            name: e.name,
            args: e.args,
            // 'running' → 'running' ; 'done' → 'ok' ; 'error' → 'error'.
            status:
              e.status === 'done'
                ? 'ok'
                : e.status === 'error'
                  ? 'error'
                  : 'running',
            result: e.result,
            error: e.error,
          }));
        }
      } catch {
        // ignore corrupt tool_events
      }
    }
    return out;
  });
}

interface Attachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
}


function PaperclipIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4"
      aria-hidden="true"
    >
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 17.93 8.83l-8.57 8.57a2 2 0 1 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4"
      aria-hidden="true"
    >
      <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3z" />
      <path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16z" />
    </svg>
  );
}

/**
 * Internal prompt shape for the greeting tiles. Workflows from
 * `/api/workflows` are mapped into this shape — `title` = workflow name,
 * `subtitle` = description, `prompt` = workflow prompt body. The static
 * fallback below is used only when no featured workflows are available
 * (e.g. before the workflows seed lands on first boot).
 */
interface PromptIdea {
  title: string;
  subtitle: string;
  prompt: string;
}

const PROMPTS: PromptIdea[] = [
  {
    title: 'Explain this starter',
    subtitle: 'Summarize what this app does and how streaming works.',
    prompt: 'Explain what this starter chat app does and how streaming flows end to end.',
  },
  {
    title: 'Draft a system prompt',
    subtitle: 'Write a system prompt for a research assistant.',
    prompt: 'Draft a clear system prompt for a focused research assistant.',
  },
  {
    title: 'Walk me through SSE',
    subtitle: 'How server-sent events carry chat chunks.',
    prompt: 'Walk me through how SSE carries chat chunks from server to client.',
  },
  {
    title: 'Ways to extend',
    subtitle: 'Suggest the next features for a real app.',
    prompt: 'Suggest the next features I should add to turn this starter into a real app.',
  },
];

function greetingFor(date: Date): string {
  const hour = date.getHours();
  if (hour < 5) return 'Working late';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}


function Greeting({
  name,
  prompts,
  onSelect,
  headline,
  subheadline,
  welcomeMessage,
}: {
  name: string;
  prompts: PromptIdea[];
  onSelect: (prompt: string) => void;
  headline?: string;
  subheadline?: string;
  welcomeMessage?: string;
}) {
  const salutation = useMemo(() => greetingFor(new Date()), []);
  const hero = headline?.trim() || salutation;
  const sub = subheadline?.trim() || `How can ${name} help today?`;
  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col justify-center px-6 py-16">
      <h1 className="ts-display ts-reveal text-[clamp(38px,5vw,64px)] text-foreground" data-delay="1">
        {hero}
      </h1>
      <p className="ts-reveal mt-3 text-[15px] leading-[1.55] text-muted-foreground" data-delay="2">
        {sub}
      </p>
      {welcomeMessage?.trim() && (
        <p className="ts-reveal mt-6 text-[14px] leading-[1.5] text-foreground" data-delay="3">
          {welcomeMessage}
        </p>
      )}
      <div className="ts-reveal mt-10 grid gap-3 sm:grid-cols-2" data-delay="4">
        {prompts.map((card) => (
          <button
            key={card.title}
            type="button"
            onClick={() => onSelect(card.prompt || card.title)}
            className="group rounded-[2px] border border-border bg-card p-5 text-left transition-colors hover:border-foreground/40 hover:bg-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]"
          >
            <h3 className="text-[15px] font-semibold leading-[1.3] tracking-[-0.005em] text-foreground">
              {card.title}
            </h3>
            <p className="mt-1.5 text-[13.5px] leading-[1.5] text-muted-foreground">
              {card.subtitle}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}

export interface AssistantPageProps {
  agentName: string;
  /** When set, the page is bound to a persisted top-level Assistant chat. */
  chatId?: string;
  /**
   * When set, the page is bound to a matter. Chat list + history fetch
   * routes go through `/api/matters/:matterId/...`, the file bucket key
   * is `matterId` (so uploads persist across chats in the matter), and
   * `/api/chat` calls include `workspaceId: matterId` so the chat-route's
   * ownership check matches the chat's stored workspace id.
   */
  matterId?: string;
}

export function AssistantPage({ agentName, chatId, matterId }: AssistantPageProps) {
  const { isClientSafe } = useClientSafe();
  // Side-panel access for tool-result artifacts (compare_documents
  // auto-opens a VersionDiff tab; redline's TrackedChangesPanel opens
  // its own tab from within the inline card). Requires <SidePanelProvider>
  // mounted in AgentApp (we already do this).
  const sidePanel = useSidePanel();
  // Starter tiles on the greeting page come from the workflows store —
  // every workflow with `featured: true` is rendered (capped at 4 for
  // layout). The workflows store is seeded from manifest.prompts on first
  // boot, so out-of-the-box behavior matches the pre-collapse manifest read.
  const { workflows: allWorkflows } = useWorkflows();
  const featuredPrompts = useMemo<PromptIdea[]>(() => {
    return allWorkflows
      .filter((w) => w.featured)
      .slice(0, 4)
      .map((w) => ({
        title: w.name,
        subtitle: w.description,
        prompt: w.prompt,
      }));
  }, [allWorkflows]);

  // Read manifest.home for first-screen overrides.
  const [manifestHome, setManifestHome] = useState<{
    headline?: string;
    subheadline?: string;
    welcomeMessage?: string;
    starterPrompts?: string[];
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetch('/api/manifest')
      .then((r) => r.json() as Promise<{ manifest?: { home?: typeof manifestHome } }>)
      .then((data) => {
        if (!cancelled) setManifestHome(data.manifest?.home ?? null);
      })
      .catch(() => { /* best effort */ });
    return () => { cancelled = true; };
  }, []);

  // Resolve home.starterPrompts (workflow ids OR titles) against the
  // workflows store (seeded from manifest.prompts, indexed by p.id when
  // set or by `manifest-prompt-${i}-${slugify(title)}` otherwise). Each
  // entry is matched against workflow id first, then name. Unmatched
  // entries still render as plain-text cards — the entry doubles as
  // heading and as the prompt body — so set_home with an arbitrary
  // string produces a visible tile rather than silently disappearing.
  const resolvedStarterPrompts = useMemo<PromptIdea[]>(() => {
    const entries = manifestHome?.starterPrompts ?? [];
    if (entries.length === 0) return [];
    const byId = new Map(allWorkflows.map((w) => [w.id, w]));
    const byName = new Map(allWorkflows.map((w) => [w.name, w]));
    return entries.map((e) => {
      const w = byId.get(e) ?? byName.get(e);
      if (w) return { title: w.name, subtitle: w.description, prompt: w.prompt };
      return { title: e, subtitle: '', prompt: e };
    });
  }, [allWorkflows, manifestHome?.starterPrompts]);

  const navigate = useNavigate();
  const location = useLocation();
  // Stable per-render-tab session id used for paperclip uploads. When chatId
  // is present we reuse it as the upload bucket key so paperclips persist
  // alongside the chat — same pattern as matter chats.
  const [tabSessionId] = useState(() => crypto.randomUUID());
  // Matter-bound chats share one file bucket per matter so docs persist
  // across chats in the matter. Top-level Assistant chats key off chatId
  // (or a tab-scoped uuid for the bare route's pre-chat send).
  const sessionId = matterId ?? chatId ?? tabSessionId;
  const [chatName, setChatName] = useState<string | null>(null);
  // Captures the message typed in the bare-route composer so ChatThread can
  // auto-send it once history finishes loading on the /c/:id route.
  const [pendingFirstSend, setPendingFirstSend] = useState<string | undefined>(undefined);
  const [bareInput, setBareInput] = useState('');
  // Bare-route only: track in-flight chat creation so the composer can
  // surface a sending state. Once chatId becomes set we navigate away and
  // ChatThread owns the streaming state.
  const [bareSending, setBareSending] = useState(false);
  const [error, setError] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [workflowOpen, setWorkflowOpen] = useState(false);
  /** Currently active workflow — set when the user picks one from the
   *  composer's Workflow button OR clicks a Library card. Cleared after
   *  the chip is dismissed; we don't (yet) forward the id to the server. */
  const [activeWorkflow, setActiveWorkflow] = useState<{ id: string; name: string } | null>(null);
  // Reads the model selection persisted by the Settings page (if any).
  // Server falls back to its configured default when undefined.
  const [selectedModel] = useSelectedModel(SELECTED_MODEL_KEY);

  // The Library page hands off a workflow via sessionStorage on navigate;
  // pick it up exactly once on mount and prefill the composer.
  //
  // NOTE: With ChatThread owning the composer state on chat routes, this
  // prefill only takes effect on the bare route (where we still own the
  // composer). On chat routes the sessionStorage payload is consumed but
  // not surfaced — follow-up to add a defaultInput prop on ChatThread.
  useEffect(() => {
    const raw = sessionStorage.getItem('counsel:pending-workflow');
    if (!raw) return;
    sessionStorage.removeItem('counsel:pending-workflow');
    try {
      const parsed = JSON.parse(raw) as { id: string; name: string; prompt: string };
      if (parsed?.prompt) {
        setBareInput(parsed.prompt);
        setActiveWorkflow({ id: parsed.id, name: parsed.name });
      }
    } catch { /* ignore */ }
  }, []);

  // Library prompt tiles also hand off via sessionStorage; pick up once on
  // mount and prefill the bare-route composer. (See note above on prefill
  // visibility on chat routes.)
  useEffect(() => {
    const raw = sessionStorage.getItem('counsel:pending-prompt');
    if (!raw) return;
    sessionStorage.removeItem('counsel:pending-prompt');
    try {
      const parsed = JSON.parse(raw) as { name?: string; prompt?: string };
      if (parsed?.prompt) setBareInput(parsed.prompt);
    } catch { /* ignore */ }
  }, []);

  function handleWorkflowPicked(w: Workflow) {
    setBareInput(w.prompt.trim() || w.name);
    setActiveWorkflow({ id: w.id, name: w.name });
  }
  const [activeArtifact, setActiveArtifact] = useState<ArtifactSnapshot | null>(null);

  const resolveRevisions = useCallback(
    async (
      sid: string,
      fileId: string,
      body: { accept?: number[]; reject?: number[] },
    ): Promise<ResolveResponse> => {
      const res = await fetch(
        `/api/files/${encodeURIComponent(sid)}/${encodeURIComponent(fileId)}/revisions/resolve`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`resolve failed: ${res.status} ${text}`);
      }
      return (await res.json()) as ResolveResponse;
    },
    [],
  );

  /**
   * Subscribe to `/api/documents/compare/summary` and yield one
   * CompareTopic per SSE chunk. Built on `progressiveArtifactStream`
   * from `@teamsuzie/ui` — generic SSE plumbing + done/error/cancel
   * framing — with a shape-checker for the chunk payload.
   */
  const streamCompareTopics = useCallback(
    (leftFileId: string, rightFileId: string) =>
      progressiveArtifactStream<{ topic: string; left: string; right: string }>({
        url: '/api/documents/compare/summary',
        body: { leftFileId, rightFileId, sessionId },
        parseChunk(raw) {
          if (!raw || typeof raw !== 'object') return null;
          const p = raw as { topic?: unknown; left?: unknown; right?: unknown };
          if (
            typeof p.topic === 'string'
            && typeof p.left === 'string'
            && typeof p.right === 'string'
          ) {
            return { topic: p.topic, left: p.left, right: p.right };
          }
          return null;
        },
      }),
    [sessionId],
  );

  const exportArtifact = useCallback(
    async (docId: string, title: string): Promise<{ downloadUrl: string; filename?: string }> => {
      const res = await fetch(
        `/api/documents/${encodeURIComponent(sessionId)}/${encodeURIComponent(docId)}/export`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: title }),
        },
      );
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Export failed: ${res.status} ${text}`);
      }
      return (await res.json()) as { downloadUrl: string; filename?: string };
    },
    [sessionId],
  );

  const loadRedline = useCallback(
    async (
      sid: string,
      fileId: string,
      signal?: AbortSignal,
    ): Promise<{ paragraphs: RedlineParagraph[] }> => {
      const res = await fetch(
        `/api/files/${encodeURIComponent(sid)}/${encodeURIComponent(fileId)}/redline-view`,
        { signal },
      );
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`redline-view failed: ${res.status} ${text}`);
      }
      return (await res.json()) as { paragraphs: RedlineParagraph[] };
    },
    [],
  );

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const bareTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Load chat header (name) when bound to a chatId. ChatThread loads the
  // messages themselves via `fetchHistory`; we only need the header here.
  useEffect(() => {
    if (!chatId) {
      setChatName(null);
      setAttachments([]);
      setActiveArtifact(null);
      setError('');
      return;
    }
    let cancelled = false;
    setError('');
    const chatBase = matterId
      ? `/api/matters/${encodeURIComponent(matterId)}/chats/${encodeURIComponent(chatId)}`
      : `/api/chats/${encodeURIComponent(chatId)}`;
    void (async () => {
      try {
        const chatRes = await fetch(chatBase);
        if (cancelled) return;
        if (!chatRes.ok) throw new Error(`Failed to load chat (${chatRes.status})`);
        const chatData = (await chatRes.json()) as { item: Chat };
        setChatName(chatData.item.name);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load chat');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chatId, matterId]);

  // After a fresh navigate from `/` to `/c/:newChatId`, restore the
  // attachments that were uploaded under the bare-route's tabSessionId
  // and promoted server-side to the new chatId, and capture the pending
  // message so ChatThread can auto-send it once history loads.
  useEffect(() => {
    const state = location.state as {
      pendingMessage?: string;
      pendingAttachments?: Attachment[];
    } | null;
    if (!chatId || !state?.pendingMessage) return;
    const pendingAttachments = state.pendingAttachments ?? [];
    if (pendingAttachments.length > 0) setAttachments(pendingAttachments);
    setPendingFirstSend(state.pendingMessage);
    navigate(location.pathname, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  async function uploadFiles(files: FileList) {
    setUploading(true);
    setError('');
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append('sessionId', sessionId);
        form.append('file', file);
        const response = await fetch('/api/files', { method: 'POST', body: form });
        if (!response.ok) {
          const data = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error || `Upload failed (${response.status})`);
        }
        const data = (await response.json()) as { item: Attachment };
        setAttachments((current) => [...current, data.item]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  function removeAttachment(id: string) {
    setAttachments((current) => current.filter((a) => a.id !== id));
    void fetch(`/api/files/${encodeURIComponent(sessionId)}/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }).catch(() => undefined);
  }

  /**
   * Bare-route only: create a chat row, promote any uploaded files
   * from the bare-route's tabSessionId to the new chatId so the next
   * chat-route lookup resolves them, then navigate to `/c/:newId`.
   * The chat starts empty — ChatThread on the next page renders empty
   * state until the user resends. (Pre-refactor we auto-dispatched
   * the message; that handoff is the explicit follow-up below.)
   */
  async function startChatFromBareRoute(textArg: string) {
    const text = textArg.trim();
    if (!text) return;
    if (chatId) return;
    try {
      setBareSending(true);
      setError('');
      const response = await fetch('/api/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        throw new Error(`Failed to start chat (${response.status})`);
      }
      const data = (await response.json()) as { item: Chat };
      let promotedAttachments = attachments;
      if (attachments.length > 0) {
        const promoteRes = await fetch('/api/files/promote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fromSessionId: sessionId,
            toSessionId: data.item.id,
            fileIds: attachments.map((a) => a.id),
          }),
        });
        if (!promoteRes.ok) {
          const body = (await promoteRes.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error || `File handoff failed (${promoteRes.status})`);
        }
        const promoted = (await promoteRes.json()) as { items: Attachment[] };
        promotedAttachments = promoted.items;
      }
      navigate(`/c/${encodeURIComponent(data.item.id)}`, {
        state: { pendingMessage: text, pendingAttachments: promotedAttachments },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start chat');
    } finally {
      setBareSending(false);
    }
  }

  // ChatThread history fetch. Matches the existing route used by the
  // pre-refactor history-load effect.
  const fetchHistory = useCallback(
    async (id: string): Promise<ChatThreadMessage[]> => {
      const chatBase = matterId
        ? `/api/matters/${encodeURIComponent(matterId)}/chats/${encodeURIComponent(id)}`
        : `/api/chats/${encodeURIComponent(id)}`;
      const r = await fetch(`${chatBase}/messages`);
      if (!r.ok) return [];
      const data = (await r.json()) as { items: PersistedChatMessage[] };
      return hydratePersistedToThread(data.items);
    },
    [matterId],
  );

  // Lifted from the pre-refactor SSE reader's `tool_result` branch.
  // ChatThread fires this once per terminal tool result (status ok|error),
  // de-duped by tool-call id.
  const handleToolResult = useCallback(
    (call: ChatToolCall) => {
      if (call.status !== 'ok') return;
      const result = call.result;
      if (!result || typeof result !== 'object') return;

      // (1) drafting / export_to_docx: surface the inline ArtifactPanel for
      // any tool that embeds a `_doc_state` snapshot in its result.
      const carrying = result as {
        _doc_state?: unknown;
        downloadUrl?: unknown;
        download_url?: unknown;
        filename?: unknown;
      };
      const ds = carrying._doc_state;
      if (ds && typeof ds === 'object') {
        const obj = ds as { doc_id?: string; title?: string; markdown?: string };
        if (typeof obj.doc_id === 'string' && typeof obj.markdown === 'string') {
          const docxUrl =
            typeof carrying.downloadUrl === 'string'
              ? carrying.downloadUrl
              : typeof carrying.download_url === 'string'
                ? carrying.download_url
                : undefined;
          const docxName = typeof carrying.filename === 'string'
            ? carrying.filename
            : undefined;
          setActiveArtifact((prev) => {
            const carry = prev && prev.docId === obj.doc_id ? prev : null;
            return {
              docId: obj.doc_id!,
              title: typeof obj.title === 'string' ? obj.title : 'Document',
              markdown: obj.markdown!,
              docxDownloadUrl: docxUrl ?? carry?.docxDownloadUrl,
              docxFilename: docxName ?? carry?.docxFilename,
            };
          });
        }
      }

      // (2) blackline_documents: open a continuous-flow RedlinePanelContent
      // tab pointed at the tracked-change DOCX produced by the tool.
      if (call.name === 'blackline_documents') {
        const blackResult = result as {
          download_file_id?: string;
          download_filename?: string;
          download_url?: string;
          left?: { name?: string };
          right?: { name?: string };
        };
        const redlineFileId = blackResult.download_file_id;
        if (typeof redlineFileId === 'string' && redlineFileId) {
          const leftName = blackResult.left?.name ?? 'left';
          const rightName = blackResult.right?.name ?? 'right';
          const tabTitle =
            blackResult.download_filename
            ?? `${leftName} → ${rightName}`;
          const tabId = `blackline:${sessionId}:${redlineFileId}`;
          const downloadHref =
            typeof blackResult.download_url === 'string' && blackResult.download_url
              ? blackResult.download_url
              : undefined;
          sidePanel.openTab({
            id: tabId,
            title: tabTitle,
            render: () => (
              <RedlinePanelContent
                sessionId={sessionId}
                fileId={redlineFileId}
                fileName={tabTitle}
                chatId={chatId ?? 'assistant-default'}
                onLoadRedline={loadRedline}
                downloadHref={downloadHref}
              />
            ),
          });
        }
      }

      // (3) compare_documents: open a CompareTable tab. Tab id is stable
      // per pair so re-running the compare reuses the tab.
      if (call.name === 'compare_documents') {
        const compareResult = result as unknown as
          Partial<DocumentDiffResult> & {
            left_file_id?: string;
            right_file_id?: string;
            topics?: Array<{ topic?: string; left?: string; right?: string }>;
          };
        if (
          compareResult.left
          && compareResult.right
          && compareResult.stats
          && Array.isArray(compareResult.events)
        ) {
          const fullResult = compareResult as DocumentDiffResult;
          const topics = Array.isArray(compareResult.topics)
            ? compareResult.topics
                .filter((t) =>
                  typeof t?.topic === 'string'
                  && typeof t.left === 'string'
                  && typeof t.right === 'string',
                )
                .map((t) => ({
                  topic: t.topic as string,
                  left: t.left as string,
                  right: t.right as string,
                }))
            : undefined;
          const leftFileId = typeof compareResult.left_file_id === 'string'
            ? compareResult.left_file_id
            : undefined;
          const rightFileId = typeof compareResult.right_file_id === 'string'
            ? compareResult.right_file_id
            : undefined;
          const onLoadTopics = leftFileId && rightFileId
            ? streamCompareTopics(leftFileId, rightFileId)
            : undefined;
          const tabId = `compare:${fullResult.left.name}→${fullResult.right.name}`;
          sidePanel.openTab({
            id: tabId,
            title: `${fullResult.left.name} → ${fullResult.right.name}`,
            render: () => (
              <CompareTable
                result={fullResult}
                topics={topics}
                onLoadTopics={onLoadTopics}
              />
            ),
          });
        }
      }
    },
    [sidePanel, sessionId, chatId, loadRedline, streamCompareTopics],
  );

  // Render the assistant turn's text through MarkdownMessage so the chat
  // looks identical to the pre-refactor render path.
  const renderAssistantText = useCallback(
    (text: string) => <MarkdownMessage content={text} />,
    [],
  );

  // Render an assistant tool call. Streaming/running indicator handled by
  // the ChatThread itself; when the tool is `propose_document_edits` we
  // surface the dedicated TrackedChangesPanel inline (same as pre-refactor).
  // Fix 2: in client-safe mode, tool activity is hidden from end-users.
  const renderToolCall = useCallback(
    (call: ChatToolCall) => {
      if (isClientSafe) return null;
      if (call.name === 'propose_document_edits' && call.status === 'ok') {
        const result = call.result as ProposeEditsResult | undefined;
        if (
          result
          && typeof result === 'object'
          && 'download_file_id' in (result as unknown as Record<string, unknown>)
        ) {
          return (
            <TrackedChangesPanel
              result={result}
              chatId={chatId ?? 'assistant-default'}
              onResolve={resolveRevisions}
              onLoadRedline={loadRedline}
              downloadHref={`/api/files/${encodeURIComponent(result.download_session_id)}/${encodeURIComponent(result.download_file_id)}/content`}
            />
          );
        }
      }
      // Fallback: a compact one-line status chip. We deliberately don't
      // re-implement the rich ToolUseStatus pulsing card here — the thread
      // shows tool calls one-per-row by default and the running indicator
      // is handled by the chip text below.
      const statusGlyph = call.status === 'running'
        ? '…'
        : call.status === 'ok'
          ? '✓'
          : '✗';
      return (
        <div className="mt-1 inline-flex items-center gap-2 rounded-[2px] border border-border bg-muted/40 px-2 py-1 font-mono text-[11px] text-muted-foreground">
          <span className="opacity-60">tool</span>
          <span className="text-foreground">{call.name}</span>
          <span className="ml-1 opacity-70">{statusGlyph}</span>
          {call.status === 'error' && call.error && (
            <span className="ml-1 text-destructive">{call.error}</span>
          )}
        </div>
      );
    },
    [isClientSafe, chatId, resolveRevisions, loadRedline],
  );

  // Bare-route composer plumbing — only used when !chatId. Reuses
  // useChatComposer for the keyboard shortcuts.
  const { handleKeyDown: bareHandleKeyDown, handleSubmit: bareHandleSubmit, canSend: bareCanSend } =
    useChatComposer({
      isStreaming: bareSending,
      onSend: (text) => {
        void startChatFromBareRoute(text);
      },
      onStop: () => {
        // Bare-route doesn't support mid-flight abort (the create-chat
        // call is short). No-op.
      },
      text: bareInput,
      setText: setBareInput,
    });

  async function newChat() {
    await fetch('/api/session/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    }).catch(() => undefined);

    setBareInput('');
    setAttachments([]);
    setActiveArtifact(null);
    setError('');
    if (chatId) {
      // Matter-bound mode goes back to the matter detail; top-level mode
      // goes back to the bare assistant route.
      if (matterId) {
        navigate(`/matters/${encodeURIComponent(matterId)}`);
      } else {
        navigate('/', { state: { forceNewChat: true } });
      }
    }
  }

  // Compute extraBody fresh each render so attachmentIds reflect the
  // current local state. Note: attachments are still cleared by the bare-
  // route promote step before ChatThread mounts, so this stays accurate.
  const extraBody = useMemo(
    () => ({
      sessionId,
      attachmentIds: attachments.map((a) => a.id),
      model: selectedModel,
      ...(matterId ? { workspaceId: matterId } : {}),
    }),
    [sessionId, attachments, selectedModel, matterId],
  );

  const showGreeting = !chatId;

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
      {chatId && (
        // Slim chat-only toolbar — only renders during an active conversation,
        // and only carries the "New chat" affordance. The agent name lived
        // here as a `• <name>` chip but duplicated the sidebar wordmark, so
        // it was removed. On the landing/greeting state there's no header at
        // all — the hero "Good <part-of-day>" copy is the top-of-page anchor.
        <header className="flex h-12 items-center justify-end border-b border-border px-6">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void newChat()}
            className="h-7 rounded-[2px] border-foreground/30 bg-transparent px-3 font-sans text-[11.5px] font-semibold uppercase tracking-[0.10em] text-foreground hover:border-[color:var(--color-accent)] hover:text-foreground"
          >
            New chat
          </Button>
        </header>
      )}

      {showGreeting ? (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <Greeting
              name={agentName}
              prompts={
                resolvedStarterPrompts.length > 0
                  ? resolvedStarterPrompts
                  : (featuredPrompts.length > 0 ? featuredPrompts : PROMPTS)
              }
              headline={manifestHome?.headline}
              subheadline={manifestHome?.subheadline}
              welcomeMessage={manifestHome?.welcomeMessage}
              onSelect={(prompt) => {
                setBareInput(prompt);
                // Defer to next tick so React commits the input change before
                // the create-chat dispatch reads it.
                queueMicrotask(() => {
                  void startChatFromBareRoute(prompt);
                });
              }}
            />
          </div>

          {/* Bare-route composer. Mirrors the chat-route composer below
              the thread but routes Send into the chat-create dance. */}
          <div className="border-t border-border bg-background px-5 py-4">
            <div className="mx-auto w-full max-w-3xl">
              {error && <p className="mb-2 text-xs text-destructive">{error}</p>}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(event) => {
                  const files = event.target.files;
                  if (files && files.length > 0) void uploadFiles(files);
                  event.target.value = '';
                }}
              />
              <div className="rounded-[2px] border border-border bg-card transition-colors focus-within:border-foreground/50">
                {attachments.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 border-b border-border px-3 pb-2 pt-2.5">
                    {attachments.map((att) => (
                      <span
                        key={att.id}
                        className="inline-flex items-center gap-1.5 rounded-[2px] bg-muted px-2 py-1 text-[11px] text-foreground"
                        title={`${att.mimeType} · ${humanSize(att.size)}`}
                      >
                        <span className="max-w-[180px] truncate font-medium">{att.name}</span>
                        <span className="text-muted-foreground">{humanSize(att.size)}</span>
                        <button
                          type="button"
                          onClick={() => removeAttachment(att.id)}
                          className="text-muted-foreground hover:text-foreground"
                          aria-label={`Remove ${att.name}`}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                {activeWorkflow && (
                  <div className="flex items-center justify-between border-b border-border px-3 py-1.5 text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <SparkleIcon />
                      <span className="font-medium text-foreground">{activeWorkflow.name}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setActiveWorkflow(null)}
                      className="text-muted-foreground hover:text-foreground"
                      aria-label="Clear workflow"
                    >
                      ×
                    </button>
                  </div>
                )}
                <textarea
                  ref={bareTextareaRef}
                  value={bareInput}
                  onChange={(event) => setBareInput(event.target.value)}
                  onKeyDown={bareHandleKeyDown}
                  placeholder={`Message ${agentName}`}
                  className="block w-full min-h-20 resize-none border-0 bg-transparent px-4 pt-3.5 font-sans text-[14.5px] leading-[1.55] text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
                />
                <div className="flex items-center justify-between border-t border-border/70 px-3 pb-2.5 pt-2">
                  <div className="flex items-center gap-1.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading}
                      className="h-7 gap-1.5 rounded-[2px] px-2 font-sans text-[12px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label="Attach files"
                    >
                      <PaperclipIcon />
                      <span>{uploading ? 'Uploading…' : 'Files'}</span>
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setWorkflowOpen(true)}
                      className="h-7 gap-1.5 rounded-[2px] px-2 font-sans text-[12px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label="Pick a workflow"
                    >
                      <SparkleIcon />
                      <span>Workflow</span>
                    </Button>
                    <p className="hidden font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground sm:inline">
                      Enter sends · ⇧↵ newline
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => bareHandleSubmit()}
                    disabled={(!bareCanSend && attachments.length === 0) || bareSending}
                    className="h-7 rounded-[2px] bg-foreground px-4 font-sans text-[11.5px] font-semibold uppercase tracking-[0.06em] text-background hover:bg-foreground/90 disabled:opacity-50"
                  >
                    {bareSending ? 'Starting…' : 'Send'}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Render the chat title header only when the server has assigned a
              real title. The chat-route renames the default "New chat" to a
              60-char preview of the first user line in its finally block, so
              "New chat" only appears before the first turn completes — at
              which point the header is a redundant placeholder (the sidebar
              already shows it). Hide it to avoid the "New chat at the top of
              a new chat" noise. */}
          {chatName && chatName !== 'New chat' && (
            <div className="mx-auto w-full max-w-3xl border-b border-border px-6 pb-3 pt-3 text-xs text-muted-foreground">
              {chatName}
            </div>
          )}
          {error && (
            <div className="mx-auto w-full max-w-3xl px-6 pt-2">
              <p className="text-xs text-destructive">{error}</p>
            </div>
          )}
          <ChatThread
            endpoint="/api/chat"
            chatId={chatId}
            fetchHistory={fetchHistory}
            extraBody={extraBody}
            onError={(msg) => setError(msg)}
            onToolResult={handleToolResult}
            renderAssistantText={renderAssistantText}
            renderToolCall={renderToolCall}
            placeholder={`Message ${agentName}`}
            defaultInput={pendingFirstSend}
            autoSendDefaultInput={Boolean(pendingFirstSend)}
            composerExtras={
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    const files = event.target.files;
                    if (files && files.length > 0) void uploadFiles(files);
                    event.target.value = '';
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="h-7 gap-1.5 rounded-[2px] px-2 font-sans text-[12px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Attach files"
                >
                  <PaperclipIcon />
                  <span>{uploading ? 'Uploading…' : 'Files'}</span>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setWorkflowOpen(true)}
                  className="h-7 gap-1.5 rounded-[2px] px-2 font-sans text-[12px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Pick a workflow"
                >
                  <SparkleIcon />
                  <span>Workflow</span>
                </Button>
              </>
            }
          />
          {/* Attachment chips for the chat route — rendered above the
              thread's built-in composer so the user can see and remove
              promoted/uploaded files. */}
          {(attachments.length > 0 || activeWorkflow) && (
            <div className="mx-auto w-full max-w-3xl border-t border-border px-3 py-2">
              {activeWorkflow && (
                <div className="mb-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <SparkleIcon />
                    <span className="font-medium text-foreground">{activeWorkflow.name}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setActiveWorkflow(null)}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label="Clear workflow"
                  >
                    ×
                  </button>
                </div>
              )}
              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {attachments.map((att) => (
                    <span
                      key={att.id}
                      className="inline-flex items-center gap-1.5 rounded-[2px] bg-muted px-2 py-1 text-[11px] text-foreground"
                      title={`${att.mimeType} · ${humanSize(att.size)}`}
                    >
                      <span className="max-w-[180px] truncate font-medium">{att.name}</span>
                      <span className="text-muted-foreground">{humanSize(att.size)}</span>
                      <button
                        type="button"
                        onClick={() => removeAttachment(att.id)}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label={`Remove ${att.name}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      </div>
      {activeArtifact && (
        <ArtifactPanel
          artifact={activeArtifact}
          onClose={() => setActiveArtifact(null)}
          onExport={exportArtifact}
        />
      )}
      <WorkflowPickerDialog
        open={workflowOpen}
        onOpenChange={setWorkflowOpen}
        onSelect={handleWorkflowPicked}
      />
    </div>
  );
}
