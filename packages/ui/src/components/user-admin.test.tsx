import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { UserAdmin } from './user-admin.js';
import { ConfirmDialogProvider } from './confirm-dialog.js';

const users = [
    { id: 'ann', email: 'ann@firm.test', name: 'Ann', role: 'admin', is_active: true, created_at: '2026-11-01T00:00:00Z', last_sign_in_at: null },
    { id: 'bob', email: 'bob@firm.test', name: 'Bob', role: 'user', is_active: true, created_at: '2026-11-01T00:00:00Z', last_sign_in_at: '2026-11-12T09:00:00Z' },
];

function mockFetch(handlers: Record<string, (init?: RequestInit) => { status: number; body: unknown }>) {
    return vi.fn(async (url: string, init?: RequestInit) => {
        const key = `${init?.method ?? 'GET'} ${url}`;
        const h = handlers[key];
        if (!h) throw new Error(`unexpected request ${key}`);
        const { status, body } = h(init);
        return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    });
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

// Each person's actions live in one row menu. Open it from the keyboard (as
// Radix supports) and pick an item; the item runs once the menu has closed.
async function chooseRowAction(person: string, item: string) {
    fireEvent.keyDown(screen.getByRole('button', { name: `Actions for ${person}` }), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: item }));
}

describe('UserAdmin', () => {
    it('lists people and shows the server’s message when a change is refused', async () => {
        vi.stubGlobal('fetch', mockFetch({
            'GET /api/p/users': () => ({ status: 200, body: { users } }),
            'GET /api/p/invites': () => ({ status: 200, body: { invites: [] } }),
            'PATCH /api/p/users/ann': () => ({ status: 409, body: { error: 'last_admin', message: 'The firm must keep at least one active admin.' } }),
        }));
        render(<ConfirmDialogProvider><UserAdmin apiBase="/api/p" currentUserEmail="ann@firm.test" linkBase="https://firm.example/allinone" /></ConfirmDialogProvider>);
        expect(await screen.findByText('Bob')).toBeTruthy();

        await chooseRowAction('Ann', 'Deactivate');
        fireEvent.click(await screen.findByRole('button', { name: 'Deactivate' }));
        await waitFor(() => expect(screen.getByText('The firm must keep at least one active admin.')).toBeTruthy());
    });

    it('warns that the admin is signed out at once only when the change is to their own account', async () => {
        vi.stubGlobal('fetch', mockFetch({
            'GET /api/p/users': () => ({ status: 200, body: { users } }),
            'GET /api/p/invites': () => ({ status: 200, body: { invites: [] } }),
        }));
        render(<ConfirmDialogProvider><UserAdmin apiBase="/api/p" currentUserEmail="ann@firm.test" linkBase="https://firm.example/allinone" /></ConfirmDialogProvider>);
        await screen.findByText('Bob');
        const note = /This is your own account: you will be signed out immediately\./;

        await chooseRowAction('Ann', 'Make user');
        expect(await screen.findByText(note)).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        await waitFor(() => expect(screen.queryByText(note)).toBeNull());

        await chooseRowAction('Ann', 'Deactivate');
        expect(await screen.findByText(note)).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        await waitFor(() => expect(screen.queryByText(note)).toBeNull());

        await chooseRowAction('Bob', 'Deactivate');
        expect(await screen.findByText(/Bob is signed out everywhere/)).toBeTruthy();
        expect(screen.queryByText(note)).toBeNull();
    });

    it('shows the running action on its own row while the request is unresolved', async () => {
        let resolvePatch: ((value: Response) => void) | undefined;
        const pendingPatch = new Promise<Response>((resolve) => {
            resolvePatch = resolve;
        });
        vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
            const key = `${init?.method ?? 'GET'} ${url}`;
            if (key === 'GET /api/p/users') {
                return new Response(JSON.stringify({ users }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }
            if (key === 'GET /api/p/invites') {
                return new Response(JSON.stringify({ invites: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }
            if (key === 'PATCH /api/p/users/bob') {
                return pendingPatch;
            }
            throw new Error(`unexpected request ${key}`);
        }));

        render(<ConfirmDialogProvider><UserAdmin apiBase="/api/p" currentUserEmail="ann@firm.test" linkBase="https://firm.example/allinone" /></ConfirmDialogProvider>);
        await screen.findByText('Bob');

        await chooseRowAction('Bob', 'Deactivate');
        fireEvent.click(await screen.findByRole('button', { name: 'Deactivate' }));

        // While the PATCH is still unresolved, Bob's own row shows that it is
        // the one running — not just a disabled button indistinguishable from
        // every other disabled button on the panel.
        expect(await screen.findByText('Deactivating…')).toBeTruthy();

        resolvePatch!(
            new Response(JSON.stringify({ user: { ...users[1], is_active: false } }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            }),
        );

        await waitFor(() => expect(screen.queryByText('Deactivating…')).toBeNull());
    });

    it('shows the invite link after inviting someone', async () => {
        vi.stubGlobal('fetch', mockFetch({
            'GET /api/p/users': () => ({ status: 200, body: { users } }),
            'GET /api/p/invites': () => ({ status: 200, body: { invites: [] } }),
            'POST /api/p/invites': () => ({ status: 201, body: { path: '/join/abc', invite: { id: 'i1', email: 'dee@firm.test', role: 'user', expires_at: '2026-11-20T12:00:00Z', created_at: '', created_by_email: 'ann@firm.test' } } }),
        }));
        render(<ConfirmDialogProvider><UserAdmin apiBase="/api/p" currentUserEmail="ann@firm.test" linkBase="https://firm.example/allinone" /></ConfirmDialogProvider>);
        await screen.findByText('Bob');
        fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'dee@firm.test' } });
        fireEvent.click(screen.getByRole('button', { name: 'Create invite link' }));
        expect(await screen.findByDisplayValue('https://firm.example/allinone/join/abc')).toBeTruthy();
    });

    it('shows the reset link under the link base', async () => {
        vi.stubGlobal('fetch', mockFetch({
            'GET /api/p/users': () => ({ status: 200, body: { users } }),
            'GET /api/p/invites': () => ({ status: 200, body: { invites: [] } }),
            'POST /api/p/users/bob/password-reset': () => ({ status: 201, body: { path: '/reset/xyz', expires_at: '2026-11-14T12:00:00Z' } }),
        }));
        render(<ConfirmDialogProvider><UserAdmin apiBase="/api/p" currentUserEmail="ann@firm.test" linkBase="https://firm.example/allinone" /></ConfirmDialogProvider>);
        await screen.findByText('Bob');
        await chooseRowAction('Bob', 'Reset password');
        expect(await screen.findByDisplayValue('https://firm.example/allinone/reset/xyz')).toBeTruthy();
    });
});
