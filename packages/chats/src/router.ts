import { Router, type Request } from 'express';

import type { ChatsStore } from './store.js';

export interface CreateChatsRouterOptions {
    store: ChatsStore;
    /**
     * Resolve the workspace id from the request — typically a parent path
     * param like `/api/matters/:matterId/chats`. Used to scope listing
     * + creation to the right workspace and to check ownership.
     */
    getWorkspaceId: (req: Request) => string;
}

/**
 * REST endpoints for chats and their messages. Mount at any prefix:
 *
 *   GET    /                        — list chats in the workspace, newest first
 *   POST   /                        — create chat ({ name? })
 *   GET    /:chatId                 — chat metadata
 *   GET    /:chatId/messages        — full message history (oldest → newest)
 *   PATCH  /:chatId                 — rename
 *   DELETE /:chatId/messages        — clear history (keeps the chat row)
 *   DELETE /:chatId                 — delete chat (cascades to messages)
 *
 * Sending a new message + streaming the model is the host app's job — it
 * wraps the chat-completion handler and persists the resulting user +
 * assistant messages via `store.appendMessage(...)`.
 */
export function createChatsRouter(opts: CreateChatsRouterOptions): Router {
    const { store, getWorkspaceId } = opts;
    const router: Router = Router();

    router.get('/', (req, res) => {
        res.json({ items: store.listChats(getWorkspaceId(req)) });
    });

    router.post('/', (req, res) => {
        const workspaceId = getWorkspaceId(req);
        const body = req.body as Record<string, unknown> | undefined;
        const name = typeof body?.name === 'string' ? body.name.trim() : undefined;
        // personaId: string switches, null clears, missing leaves unset.
        let personaId: string | null | undefined;
        if (body && 'personaId' in body) {
            const raw = body.personaId;
            personaId = typeof raw === 'string' && raw.length > 0 ? raw : null;
        }
        const chat = store.createChat({ workspaceId, name, personaId });
        res.status(201).json({ item: chat });
    });

    router.get('/:chatId', (req, res) => {
        const chatId = String(req.params.chatId ?? '');
        const chat = store.getChat(chatId);
        if (!chat || chat.workspaceId !== getWorkspaceId(req)) {
            res.status(404).json({ error: 'not_found' });
            return;
        }
        res.json({ item: chat });
    });

    router.get('/:chatId/messages', (req, res) => {
        const chatId = String(req.params.chatId ?? '');
        const chat = store.getChat(chatId);
        if (!chat || chat.workspaceId !== getWorkspaceId(req)) {
            res.status(404).json({ error: 'not_found' });
            return;
        }
        res.json({ items: store.listMessages(chatId) });
    });

    router.patch('/:chatId', (req, res) => {
        const chatId = String(req.params.chatId ?? '');
        const chat = store.getChat(chatId);
        if (!chat || chat.workspaceId !== getWorkspaceId(req)) {
            res.status(404).json({ error: 'not_found' });
            return;
        }
        const body = req.body as Record<string, unknown> | undefined;
        const patch: { name?: string; personaId?: string | null } = {};
        if (typeof body?.name === 'string') {
            const trimmed = body.name.trim();
            if (!trimmed) {
                res.status(400).json({ error: 'name cannot be empty' });
                return;
            }
            patch.name = trimmed;
        }
        // personaId is tri-state: string switches, null clears, missing
        // means "leave the existing value alone". The store.updateChat
        // distinguishes the three via `'personaId' in patch`.
        if (body && 'personaId' in body) {
            const raw = body.personaId;
            patch.personaId =
                typeof raw === 'string' && raw.length > 0 ? raw : null;
        }
        const updated = store.updateChat(chatId, patch);
        res.json({ item: updated });
    });

    router.delete('/:chatId/messages', (req, res) => {
        const chatId = String(req.params.chatId ?? '');
        const chat = store.getChat(chatId);
        if (!chat || chat.workspaceId !== getWorkspaceId(req)) {
            res.status(404).json({ error: 'not_found' });
            return;
        }
        const removed = store.clearMessages(chatId);
        res.json({ ok: true, removed });
    });

    router.delete('/:chatId', (req, res) => {
        const chatId = String(req.params.chatId ?? '');
        const chat = store.getChat(chatId);
        if (!chat || chat.workspaceId !== getWorkspaceId(req)) {
            res.status(404).json({ error: 'not_found' });
            return;
        }
        store.deleteChat(chatId);
        res.json({ ok: true });
    });

    return router;
}
