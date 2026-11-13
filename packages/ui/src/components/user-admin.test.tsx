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

describe('UserAdmin', () => {
    it('lists people and shows the server’s message when a change is refused', async () => {
        vi.stubGlobal('fetch', mockFetch({
            'GET /api/p/users': () => ({ status: 200, body: { users } }),
            'GET /api/p/invites': () => ({ status: 200, body: { invites: [] } }),
            'PATCH /api/p/users/ann': () => ({ status: 409, body: { error: 'last_admin', message: 'The firm must keep at least one active admin.' } }),
        }));
        render(<ConfirmDialogProvider><UserAdmin apiBase="/api/p" currentUserEmail="ann@firm.test" /></ConfirmDialogProvider>);
        expect(await screen.findByText('Bob')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Deactivate Ann' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Deactivate' }));
        await waitFor(() => expect(screen.getByText('The firm must keep at least one active admin.')).toBeTruthy());
    });

    it('shows the invite link after inviting someone', async () => {
        vi.stubGlobal('fetch', mockFetch({
            'GET /api/p/users': () => ({ status: 200, body: { users } }),
            'GET /api/p/invites': () => ({ status: 200, body: { invites: [] } }),
            'POST /api/p/invites': () => ({ status: 201, body: { path: '/join/abc', invite: { id: 'i1', email: 'dee@firm.test', role: 'user', expires_at: '2026-11-20T12:00:00Z', created_at: '', created_by_email: 'ann@firm.test' } } }),
        }));
        render(<ConfirmDialogProvider><UserAdmin apiBase="/api/p" currentUserEmail="ann@firm.test" /></ConfirmDialogProvider>);
        await screen.findByText('Bob');
        fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'dee@firm.test' } });
        fireEvent.click(screen.getByRole('button', { name: 'Create invite link' }));
        expect(await screen.findByDisplayValue(`${window.location.origin}/join/abc`)).toBeTruthy();
    });
});
