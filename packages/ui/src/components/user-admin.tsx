import * as React from "react"

import { Badge } from "./badge.js"
import { Button } from "./button.js"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./card.js"
import { useConfirm } from "./confirm-dialog.js"
import { formatDateTime } from "./data-table.js"
import { Input } from "./input.js"
import { Label } from "./label.js"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select.js"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./table.js"

export interface AdminUserRow {
  id: string
  email: string
  name: string
  role: "admin" | "user"
  is_active: boolean
  created_at: string
  last_sign_in_at: string | null
}

export interface InviteRow {
  id: string
  email: string
  role: "admin" | "user"
  expires_at: string
  created_at: string
  created_by_email: string
}

export interface UserAdminProps {
  /** Where `createUserAdminRouter` is mounted, e.g. `/api/admin/people`. */
  apiBase: string
  currentUserEmail: string
}

interface ShownLink {
  url: string
  note: string
}

/** The one action currently in flight, so its own row/button can show a
 *  progress label (e.g. "Deactivating…") instead of just going disabled
 *  like every other button on the panel. */
interface PendingAction {
  id: string
  label: string
}

async function parseJson(res: Response): Promise<unknown> {
  const text = await res.text()
  return text ? JSON.parse(text) : {}
}

// One id per (action kind, target) pair, used to key `PendingAction` so the
// right row's button — and only that one — shows its progress label.
function roleActionId(userId: string): string {
  return `role:${userId}`
}
function activeActionId(userId: string): string {
  return `active:${userId}`
}
function resetActionId(userId: string): string {
  return `reset:${userId}`
}
function removeActionId(userId: string): string {
  return `remove:${userId}`
}
function revokeActionId(inviteId: string): string {
  return `revoke:${inviteId}`
}

/**
 * Law-firm user management panel: lists people and pending invites, and
 * lets an admin invite, change role, deactivate/reactivate, send a
 * password-reset link, or remove someone. Every failed request surfaces
 * the server's own `message` — there is no local guessing at why a
 * request failed.
 */
export function UserAdmin({ apiBase, currentUserEmail }: UserAdminProps) {
  const [users, setUsers] = React.useState<AdminUserRow[]>([])
  const [invites, setInvites] = React.useState<InviteRow[]>([])
  const [error, setError] = React.useState<string | null>(null)
  const [link, setLink] = React.useState<ShownLink | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [pending, setPending] = React.useState<PendingAction | null>(null)
  const confirm = useConfirm()

  const load = React.useCallback(async () => {
    const [usersRes, invitesRes] = await Promise.all([
      fetch(`${apiBase}/users`, { credentials: "include" }),
      fetch(`${apiBase}/invites`, { credentials: "include" }),
    ])
    const usersBody = (await parseJson(usersRes)) as { users?: AdminUserRow[]; message?: string }
    if (!usersRes.ok) {
      throw new Error(usersBody.message ?? `Request failed (${usersRes.status})`)
    }
    const invitesBody = (await parseJson(invitesRes)) as { invites?: InviteRow[]; message?: string }
    if (!invitesRes.ok) {
      throw new Error(invitesBody.message ?? `Request failed (${invitesRes.status})`)
    }
    setUsers(usersBody.users ?? [])
    setInvites(invitesBody.invites ?? [])
  }, [apiBase])

  React.useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : "Failed to load"))
  }, [load])

  const send = React.useCallback(
    async (method: string, path: string, body?: unknown) => {
      const res = await fetch(`${apiBase}${path}`, {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      })
      const parsed = (await parseJson(res)) as { message?: string }
      if (!res.ok) {
        throw new Error(parsed.message ?? `Request failed (${res.status})`)
      }
      await load()
      return parsed
    },
    [apiBase, load],
  )

  // Runs `action` (a server request) and surfaces its message as the
  // panel's own `error`, which is where the test (and the user) looks for
  // it. We deliberately do NOT pass this as a `ConfirmOptions.onConfirm` —
  // `confirm-dialog.tsx` keeps the dialog open and renders a *second* copy
  // of the thrown message inside itself when `onConfirm` throws, which
  // would duplicate the message on screen. Instead we let the dialog close
  // immediately on confirm (no `onConfirm`), then run the request and show
  // any failure in our own banner below — so the message is only ever
  // shown once, and it stays visible after the dialog has closed.
  //
  // `pendingInfo`, when given, is shown as the in-flight action's own row
  // button label (e.g. "Deactivating…") for as long as the request is
  // running — every other button on the panel is just disabled via
  // `busy`, but the one actually doing something says so.
  async function runAction(action: () => Promise<unknown>, pendingInfo?: PendingAction) {
    setBusy(true)
    setError(null)
    if (pendingInfo) setPending(pendingInfo)
    try {
      await action()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed")
    } finally {
      setBusy(false)
      setPending(null)
    }
  }

  async function confirmThenRun(
    options: Parameters<typeof confirm>[0],
    action: () => Promise<unknown>,
    pendingInfo?: PendingAction,
  ) {
    const ok = await confirm(options)
    if (!ok) return
    await runAction(action, pendingInfo)
  }

  async function changeRole(user: AdminUserRow) {
    const nextRole = user.role === "admin" ? "user" : "admin"
    const description =
      nextRole === "admin"
        ? `Admins can invite, change and remove people, and see firm-wide settings. ${user.name} will be signed out and sign in again with the new role.`
        : `${user.name} will no longer be able to invite, change or remove people, or see firm-wide settings. ${user.name} will be signed out and sign in again with the new role.`
    await confirmThenRun(
      {
        title: `Make ${user.name} ${nextRole === "admin" ? "an admin" : "a user"}?`,
        description,
      },
      () => send("PATCH", `/users/${user.id}`, { role: nextRole }),
      { id: roleActionId(user.id), label: "Saving…" },
    )
  }

  async function toggleActive(user: AdminUserRow) {
    if (user.is_active) {
      await confirmThenRun(
        {
          title: `Deactivate ${user.name}?`,
          description: `${user.name} is signed out everywhere and cannot sign in until reactivated. Their matters and history stay.`,
          confirmLabel: "Deactivate",
          variant: "destructive",
        },
        () => send("PATCH", `/users/${user.id}`, { is_active: false }),
        { id: activeActionId(user.id), label: "Deactivating…" },
      )
    } else {
      await runAction(
        () => send("PATCH", `/users/${user.id}`, { is_active: true }),
        { id: activeActionId(user.id), label: "Reactivating…" },
      )
    }
  }

  async function resetPassword(user: AdminUserRow) {
    await runAction(
      async () => {
        const result = (await send("POST", `/users/${user.id}/password-reset`)) as { path: string }
        setLink({
          url: window.location.origin + result.path,
          note: "One use; expires in 24 hours.",
        })
      },
      { id: resetActionId(user.id), label: "Resetting…" },
    )
  }

  async function removeUser(user: AdminUserRow) {
    await confirmThenRun(
      {
        title: `Remove ${user.name} permanently?`,
        description: `Deletes ${user.name}'s account, private chats, playbooks and knowledge-base documents. Matters only ${user.name} is on are deleted. Matters shared with others stay. This cannot be undone. Prefer Deactivate to keep their history.`,
        confirmLabel: "Remove",
        variant: "destructive",
      },
      () => send("DELETE", `/users/${user.id}`),
      { id: removeActionId(user.id), label: "Removing…" },
    )
  }

  async function revokeInvite(invite: InviteRow) {
    await confirmThenRun(
      {
        title: `Revoke the invite for ${invite.email}?`,
        description: "The link stops working.",
        confirmLabel: "Revoke",
        variant: "destructive",
      },
      () => send("DELETE", `/invites/${invite.id}`),
      { id: revokeActionId(invite.id), label: "Revoking…" },
    )
  }

  return (
    <div className="space-y-4">
      <InviteForm
        apiBase={apiBase}
        send={send}
        busy={busy}
        setBusy={setBusy}
        setError={setError}
        setLink={setLink}
      />

      {link && <LinkBox link={link} />}

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardDescription>People</CardDescription>
          <CardTitle>Everyone at the firm</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last sign-in</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    {user.name}
                    {user.email === currentUserEmail && (
                      <span className="text-muted-foreground"> (you)</span>
                    )}
                  </TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>
                    <Badge variant={user.role === "admin" ? "default" : "secondary"}>
                      {user.role === "admin" ? "Admin" : "User"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={user.is_active ? "success" : "outline"}>
                      {user.is_active ? "Active" : "Deactivated"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {user.last_sign_in_at ? formatDateTime(user.last_sign_in_at) : "Never"}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        aria-label={user.role === "admin" ? `Make ${user.name} a user` : `Make ${user.name} an admin`}
                        onClick={() => void changeRole(user)}
                      >
                        {pending?.id === roleActionId(user.id)
                          ? pending.label
                          : user.role === "admin"
                            ? "Make user"
                            : "Make admin"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={user.is_active ? "destructive" : "outline"}
                        disabled={busy}
                        aria-label={`${user.is_active ? "Deactivate" : "Reactivate"} ${user.name}`}
                        onClick={() => void toggleActive(user)}
                      >
                        {pending?.id === activeActionId(user.id)
                          ? pending.label
                          : user.is_active
                            ? "Deactivate"
                            : "Reactivate"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        aria-label={`Reset password for ${user.name}`}
                        onClick={() => void resetPassword(user)}
                      >
                        {pending?.id === resetActionId(user.id) ? pending.label : "Reset password"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        disabled={busy}
                        aria-label={`Remove ${user.name}`}
                        onClick={() => void removeUser(user)}
                      >
                        {pending?.id === removeActionId(user.id) ? pending.label : "Remove"}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardDescription>Pending</CardDescription>
          <CardTitle>Invites</CardTitle>
        </CardHeader>
        <CardContent>
          {invites.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pending invites.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invites.map((invite) => (
                  <TableRow key={invite.id}>
                    <TableCell>{invite.email}</TableCell>
                    <TableCell>
                      <Badge variant={invite.role === "admin" ? "default" : "secondary"}>
                        {invite.role === "admin" ? "Admin" : "User"}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatDateTime(invite.expires_at)}</TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        disabled={busy}
                        aria-label={`Revoke invite for ${invite.email}`}
                        onClick={() => void revokeInvite(invite)}
                      >
                        {pending?.id === revokeActionId(invite.id) ? pending.label : "Revoke"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function InviteForm({
  apiBase,
  send,
  busy,
  setBusy,
  setError,
  setLink,
}: {
  apiBase: string
  send: (method: string, path: string, body?: unknown) => Promise<unknown>
  busy: boolean
  setBusy: (busy: boolean) => void
  setError: (error: string | null) => void
  setLink: (link: ShownLink | null) => void
}) {
  const [email, setEmail] = React.useState("")
  const [role, setRole] = React.useState<"user" | "admin">("user")

  async function handleInvite() {
    setBusy(true)
    setError(null)
    try {
      const result = (await send("POST", "/invites", { email, role })) as {
        path: string
        invite: InviteRow
      }
      setLink({
        url: window.location.origin + result.path,
        note: `One use; expires ${formatDateTime(result.invite.expires_at)}. Send it to them yourself.`,
      })
      setEmail("")
      setRole("user")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardDescription>Invite</CardDescription>
        <CardTitle>Add someone to the firm</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-role">Role</Label>
            <Select value={role} onValueChange={(value) => setRole(value as "user" | "admin")}>
              <SelectTrigger id="invite-role" className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="user">User</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button type="button" disabled={busy || !email} onClick={() => void handleInvite()}>
            Create invite link
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function LinkBox({ link }: { link: ShownLink }) {
  const [copied, setCopied] = React.useState(false)
  const [copyError, setCopyError] = React.useState<string | null>(null)

  async function handleCopy() {
    setCopyError(null)
    try {
      // Only claim success once the browser has actually copied the text —
      // never say "Copied" before (or regardless of whether) it happened.
      await navigator.clipboard.writeText(link.url)
      setCopied(true)
    } catch (err) {
      setCopied(false)
      const message = err instanceof Error ? err.message : "unknown error"
      setCopyError(`Could not copy: ${message}. Select the link and copy it yourself.`)
    }
  }

  return (
    <Card>
      <CardContent className="space-y-2 pt-6">
        <div className="flex items-center gap-2">
          <Input readOnly value={link.url} aria-label="Link" />
          <Button type="button" variant="outline" onClick={() => void handleCopy()}>
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{link.note}</p>
        {copyError && <p className="text-xs text-destructive">{copyError}</p>}
      </CardContent>
    </Card>
  )
}
