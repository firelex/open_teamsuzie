import * as React from "react"
import { KeyRound, Loader2, ShieldCheck, ShieldOff, Trash2, UserCheck, UserX } from "lucide-react"

import { Badge } from "./badge.js"
import { Button } from "./button.js"
import { useConfirm } from "./confirm-dialog.js"
import { DataTable, formatDateTime, type Column } from "./data-table.js"
import { Input } from "./input.js"
import { Label } from "./label.js"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select.js"
import { RowActions } from "./row-actions.js"
import { useUiT } from "../lib/i18n.js"

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
  /**
   * Prefix for the invite and reset links shown to the admin: the app's public
   * address including any sub-path it is served under, without a trailing
   * slash (e.g. `https://firm.example/allinone`). The server's link path
   * (`/join/…`, `/reset/…`) is appended to it.
   */
  linkBase: string
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
export function UserAdmin({ apiBase, currentUserEmail, linkBase }: UserAdminProps) {
  const { t } = useUiT()
  const [users, setUsers] = React.useState<AdminUserRow[]>([])
  const [invites, setInvites] = React.useState<InviteRow[]>([])
  const [error, setError] = React.useState<string | null>(null)
  const [link, setLink] = React.useState<ShownLink | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [pending, setPending] = React.useState<PendingAction | null>(null)
  const [loading, setLoading] = React.useState(true)
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
    load()
      .catch((err) => setError(err instanceof Error ? err.message : t('userAdmin.failedToLoad')))
      .finally(() => setLoading(false))
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
      setError(err instanceof Error ? err.message : t('userAdmin.requestFailed'))
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
        ? t('userAdmin.makeAdminDescription', { name: user.name })
        : t('userAdmin.makeUserDescription', { name: user.name })
    await confirmThenRun(
      {
        title:
          nextRole === "admin"
            ? t('userAdmin.makeAdminTitle', { name: user.name })
            : t('userAdmin.makeUserTitle', { name: user.name }),
        description,
      },
      () => send("PATCH", `/users/${user.id}`, { role: nextRole }),
      { id: roleActionId(user.id), label: t('userAdmin.savingEllipsis') },
    )
  }

  async function toggleActive(user: AdminUserRow) {
    if (user.is_active) {
      await confirmThenRun(
        {
          title: t('userAdmin.deactivateTitle', { name: user.name }),
          description: t('userAdmin.deactivateDescription', { name: user.name }),
          confirmLabel: t('userAdmin.deactivate'),
          variant: "destructive",
        },
        () => send("PATCH", `/users/${user.id}`, { is_active: false }),
        { id: activeActionId(user.id), label: t('userAdmin.deactivatingEllipsis') },
      )
    } else {
      await runAction(
        () => send("PATCH", `/users/${user.id}`, { is_active: true }),
        { id: activeActionId(user.id), label: t('userAdmin.reactivatingEllipsis') },
      )
    }
  }

  async function resetPassword(user: AdminUserRow) {
    await runAction(
      async () => {
        const result = (await send("POST", `/users/${user.id}/password-reset`)) as { path: string }
        setLink({
          url: linkBase + result.path,
          note: t('userAdmin.resetLinkNote'),
        })
      },
      { id: resetActionId(user.id), label: t('userAdmin.resettingEllipsis') },
    )
  }

  async function removeUser(user: AdminUserRow) {
    await confirmThenRun(
      {
        title: t('userAdmin.removeTitle', { name: user.name }),
        description: t('userAdmin.removeDescription', { name: user.name }),
        confirmLabel: t('userAdmin.remove'),
        variant: "destructive",
      },
      () => send("DELETE", `/users/${user.id}`),
      { id: removeActionId(user.id), label: t('userAdmin.removingEllipsis') },
    )
  }

  async function revokeInvite(invite: InviteRow) {
    await confirmThenRun(
      {
        title: t('userAdmin.revokeTitle', { email: invite.email }),
        description: t('userAdmin.revokeDescription'),
        confirmLabel: t('userAdmin.revoke'),
        variant: "destructive",
      },
      () => send("DELETE", `/invites/${invite.id}`),
      { id: revokeActionId(invite.id), label: t('userAdmin.revokingEllipsis') },
    )
  }

  function rowPendingLabel(id: string): string | null {
    if (!pending) return null
    const ids = [roleActionId(id), activeActionId(id), resetActionId(id), removeActionId(id)]
    return ids.includes(pending.id) ? pending.label : null
  }

  const userColumns: Column<AdminUserRow>[] = [
    {
      key: "name",
      header: t('userAdmin.nameHeader'),
      render: (user) => (
        <div className="min-w-0 space-y-1">
          <div className="font-medium text-foreground">
            {user.name}
            {user.email === currentUserEmail && (
              <span className="font-normal text-muted-foreground"> {t('userAdmin.you')}</span>
            )}
          </div>
          {/* On narrow screens the email, role and status columns are
              hidden, so the same facts sit under the name instead. */}
          <div className="break-words text-xs text-muted-foreground md:hidden"><EmailText email={user.email} /></div>
          <div className="flex flex-wrap gap-1.5 sm:hidden">
            <RoleBadge role={user.role} />
            <StatusBadge active={user.is_active} />
          </div>
        </div>
      ),
    },
    {
      key: "email",
      header: t('common.email'),
      className: "hidden md:table-cell",
      render: (user) => <span className="break-words"><EmailText email={user.email} /></span>,
    },
    {
      key: "role",
      header: t('userAdmin.roleHeader'),
      className: "hidden sm:table-cell",
      render: (user) => <RoleBadge role={user.role} />,
    },
    {
      key: "status",
      header: t('userAdmin.statusHeader'),
      className: "hidden sm:table-cell",
      render: (user) => <StatusBadge active={user.is_active} />,
    },
    {
      key: "lastSignIn",
      header: t('userAdmin.lastSignInHeader'),
      className: "hidden lg:table-cell whitespace-nowrap text-muted-foreground",
      render: (user) => (user.last_sign_in_at ? formatDateTime(user.last_sign_in_at) : t('userAdmin.never')),
    },
  ]

  const inviteColumns: Column<InviteRow>[] = [
    {
      key: "email",
      header: t('common.email'),
      render: (invite) => (
        <div className="min-w-0 space-y-1">
          <div className="break-words font-medium text-foreground"><EmailText email={invite.email} /></div>
          {/* Role and expiry columns are hidden on narrow screens. */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground sm:hidden">
            <RoleBadge role={invite.role} />
            <span>{t('userAdmin.expiresOn', { date: formatDateTime(invite.expires_at) })}</span>
          </div>
        </div>
      ),
    },
    {
      key: "role",
      header: t('userAdmin.roleHeader'),
      className: "hidden sm:table-cell",
      render: (invite) => <RoleBadge role={invite.role} />,
    },
    {
      key: "expires",
      header: t('userAdmin.expiresHeader'),
      className: "hidden sm:table-cell whitespace-nowrap text-muted-foreground",
      render: (invite) => formatDateTime(invite.expires_at),
    },
  ]

  return (
    // The panel usually sits inside a settings card whose body text is
    // small and muted; reset to the normal table text here.
    <div className="space-y-6 text-sm text-foreground">
      <InviteForm
        apiBase={apiBase}
        linkBase={linkBase}
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

      <section className="space-y-3">
        <h3 className="text-sm font-medium">{t('userAdmin.everyoneTitle')}</h3>
        <DataTable<AdminUserRow>
          data={users}
          columns={userColumns}
          getRowKey={(user) => user.id}
          isLoading={loading}
          emptyMessage={t('userAdmin.noPeople')}
          actionsWidth="w-12"
          actionsHeader={<span className="sr-only">{t('userAdmin.actionsHeader')}</span>}
          renderActions={(user) => {
            const pendingLabel = rowPendingLabel(user.id)
            return (
              <div className="flex items-center justify-end gap-2">
                {pendingLabel && (
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground" role="status">
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    {pendingLabel}
                  </span>
                )}
                <RowActions
                  triggerLabel={t('userAdmin.ariaActionsFor', { name: user.name })}
                  actions={[
                    {
                      id: "role",
                      label: user.role === "admin" ? t('userAdmin.makeUser') : t('userAdmin.makeAdmin'),
                      icon: user.role === "admin" ? ShieldOff : ShieldCheck,
                      disabled: busy,
                      onSelect: () => changeRole(user),
                    },
                    {
                      id: "reset",
                      label: t('userAdmin.resetPassword'),
                      icon: KeyRound,
                      disabled: busy,
                      onSelect: () => resetPassword(user),
                    },
                    {
                      id: "active",
                      label: user.is_active ? t('userAdmin.deactivate') : t('userAdmin.reactivate'),
                      icon: user.is_active ? UserX : UserCheck,
                      destructive: user.is_active,
                      separatorBefore: true,
                      disabled: busy,
                      onSelect: () => toggleActive(user),
                    },
                    {
                      id: "remove",
                      label: t('userAdmin.remove'),
                      icon: Trash2,
                      destructive: true,
                      disabled: busy,
                      onSelect: () => removeUser(user),
                    },
                  ]}
                />
              </div>
            )
          }}
        />
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-medium">{t('userAdmin.pendingInvitesTitle')}</h3>
        <DataTable<InviteRow>
          data={invites}
          columns={inviteColumns}
          getRowKey={(invite) => invite.id}
          isLoading={loading}
          emptyMessage={t('userAdmin.noPendingInvites')}
          actionsWidth="w-28"
          actionsHeader={<span className="sr-only">{t('userAdmin.actionsHeader')}</span>}
          renderActions={(invite) => (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              aria-label={t('userAdmin.ariaRevoke', { email: invite.email })}
              onClick={() => void revokeInvite(invite)}
            >
              {pending?.id === revokeActionId(invite.id) ? pending.label : t('userAdmin.revoke')}
            </Button>
          )}
        />
      </section>
    </div>
  )
}

/** An email address that, when it must wrap, wraps before the "@". */
function EmailText({ email }: { email: string }) {
  const at = email.indexOf("@")
  if (at <= 0) return <>{email}</>
  return (
    <>
      {email.slice(0, at)}
      <wbr />
      {email.slice(at)}
    </>
  )
}

function RoleBadge({ role }: { role: "admin" | "user" }) {
  const { t } = useUiT()
  return (
    <Badge variant={role === "admin" ? "default" : "secondary"}>
      {role === "admin" ? t('userAdmin.admin') : t('userAdmin.user')}
    </Badge>
  )
}

function StatusBadge({ active }: { active: boolean }) {
  const { t } = useUiT()
  return (
    <Badge variant={active ? "success" : "outline"}>
      {active ? t('userAdmin.active') : t('userAdmin.deactivated')}
    </Badge>
  )
}

function InviteForm({
  apiBase,
  linkBase,
  send,
  busy,
  setBusy,
  setError,
  setLink,
}: {
  apiBase: string
  linkBase: string
  send: (method: string, path: string, body?: unknown) => Promise<unknown>
  busy: boolean
  setBusy: (busy: boolean) => void
  setError: (error: string | null) => void
  setLink: (link: ShownLink | null) => void
}) {
  const { t } = useUiT()
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
        url: linkBase + result.path,
        note: t('userAdmin.inviteLinkNote', { expires: formatDateTime(result.invite.expires_at) }),
      })
      setEmail("")
      setRole("user")
    } catch (err) {
      setError(err instanceof Error ? err.message : t('userAdmin.requestFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-medium">{t('userAdmin.addSomeoneTitle')}</h3>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          void handleInvite()
        }}
      >
        {/* gap, not space-y: inside a form, Radix Select adds a hidden
            native <select> after its trigger, and space-y would give the
            trigger a bottom margin and lift it out of line. */}
        <div className="flex min-w-56 flex-1 flex-col gap-1.5 sm:max-w-md">
          <Label htmlFor="invite-email">{t('common.email')}</Label>
          <Input
            id="invite-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-role">{t('userAdmin.roleHeader')}</Label>
          <Select value={role} onValueChange={(value) => setRole(value as "user" | "admin")}>
            <SelectTrigger id="invite-role" className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="user">{t('userAdmin.user')}</SelectItem>
              <SelectItem value="admin">{t('userAdmin.admin')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button type="submit" disabled={busy || !email}>
          {t('userAdmin.createInviteLink')}
        </Button>
      </form>
    </section>
  )
}

function LinkBox({ link }: { link: ShownLink }) {
  const { t } = useUiT()
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
      const message = err instanceof Error ? err.message : t('userAdmin.unknownError')
      setCopyError(t('userAdmin.couldNotCopy', { message }))
    }
  }

  return (
    <div className="space-y-2 rounded-md border bg-muted/40 p-3">
      <div className="flex items-center gap-2">
        <Input readOnly value={link.url} aria-label={t('userAdmin.link')} className="bg-background" />
        <Button type="button" variant="outline" onClick={() => void handleCopy()}>
          {copied ? t('userAdmin.copied') : t('userAdmin.copy')}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{link.note}</p>
      {copyError && <p className="text-xs text-destructive">{copyError}</p>}
    </div>
  )
}
