import * as React from "react"

import { Button } from "./button.js"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./card.js"
import { Input } from "./input.js"
import { Label } from "./label.js"

async function parseJson(res: Response): Promise<unknown> {
  const text = await res.text()
  return text ? JSON.parse(text) : {}
}

function PageCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted px-4">
      <Card className="w-full max-w-sm">{children}</Card>
    </div>
  )
}

export interface AcceptInvitePageProps {
  /** Where the public auth router is mounted, e.g. `/api/auth`. */
  apiBase: string
  token: string
  onJoined: () => void
}

interface InviteDetails {
  email: string
  role: "admin" | "user"
  organizationName: string
  state: "open" | "used" | "expired" | "revoked"
}

/**
 * The page a new person lands on from an invite link. Loads the invite's
 * details, shows a plain explanation if the link can no longer be used,
 * and otherwise collects a name and password to create the account.
 */
export function AcceptInvitePage({ apiBase, token, onJoined }: AcceptInvitePageProps) {
  const [invite, setInvite] = React.useState<InviteDetails | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [name, setName] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      const res = await fetch(`${apiBase}/invites/${token}`, { credentials: "include" })
      const body = (await parseJson(res)) as Partial<InviteDetails> & { message?: string }
      if (!res.ok) {
        throw new Error(body.message ?? `Request failed (${res.status})`)
      }
      if (!cancelled) {
        setInvite(body as InviteDetails)
      }
    }
    load().catch((err) => {
      if (!cancelled) setLoadError(err instanceof Error ? err.message : "Failed to load invite")
    })
    return () => {
      cancelled = true
    }
  }, [apiBase, token])

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const res = await fetch(`${apiBase}/invites/${token}/accept`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, password }),
      })
      const body = (await parseJson(res)) as { message?: string }
      if (!res.ok) {
        throw new Error(body.message ?? `Request failed (${res.status})`)
      }
      onJoined()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not join")
    } finally {
      setSubmitting(false)
    }
  }

  if (loadError) {
    return (
      <PageCard>
        <CardContent className="pt-6">
          <p className="text-sm text-destructive">{loadError}</p>
        </CardContent>
      </PageCard>
    )
  }

  if (!invite) {
    return (
      <PageCard>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">Loading…</p>
        </CardContent>
      </PageCard>
    )
  }

  if (invite.state !== "open") {
    const reason =
      invite.state === "used"
        ? "has been used"
        : invite.state === "expired"
          ? "has expired"
          : "was revoked"
    return (
      <PageCard>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">
            This invite link {reason}. Ask your admin for a new one.
          </p>
        </CardContent>
      </PageCard>
    )
  }

  return (
    <PageCard>
      <CardHeader>
        <CardTitle>Join {invite.organizationName}</CardTitle>
        <CardDescription>{invite.role === "admin" ? "Admin" : "User"} invite</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-1.5">
            <Label htmlFor="invite-accept-email">Email</Label>
            <Input id="invite-accept-email" type="email" value={invite.email} readOnly />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-accept-name">Name</Label>
            <Input
              id="invite-accept-name"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-accept-password">Password</Label>
            <Input
              id="invite-accept-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <p className="text-xs text-muted-foreground">At least 12 characters</p>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? "Joining…" : "Join"}
          </Button>
        </form>
      </CardContent>
    </PageCard>
  )
}

export interface ResetPasswordPageProps {
  /** Where the public auth router is mounted, e.g. `/api/auth`. */
  apiBase: string
  token: string
  onDone: () => void
}

/**
 * The page a person lands on from a password-reset link. Collects a new
 * password (typed twice) and sets it, or shows the server's message if
 * the link has already been used or has expired.
 */
export function ResetPasswordPage({ apiBase, token, onDone }: ResetPasswordPageProps) {
  const [password, setPassword] = React.useState("")
  const [confirmPassword, setConfirmPassword] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [done, setDone] = React.useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    if (password !== confirmPassword) {
      setError("Passwords don't match.")
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch(`${apiBase}/password-reset/${token}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      })
      const body = (await parseJson(res)) as { message?: string }
      if (!res.ok) {
        throw new Error(body.message ?? `Request failed (${res.status})`)
      }
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not set password")
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <PageCard>
        <CardContent className="space-y-4 pt-6">
          <p className="text-sm text-foreground">Password set. Sign in with your new password.</p>
          <Button type="button" className="w-full" onClick={onDone}>
            Continue
          </Button>
        </CardContent>
      </PageCard>
    )
  }

  return (
    <PageCard>
      <CardHeader>
        <CardTitle>Set a new password</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-1.5">
            <Label htmlFor="reset-password">New password</Label>
            <Input
              id="reset-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <p className="text-xs text-muted-foreground">At least 12 characters</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reset-password-confirm">Confirm password</Label>
            <Input
              id="reset-password-confirm"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? "Setting password…" : "Set password"}
          </Button>
        </form>
      </CardContent>
    </PageCard>
  )
}
