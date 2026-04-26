import * as React from "react"

import { Button } from "./button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./card"
import { Input } from "./input"
import { Label } from "./label"

export interface LoginCredentials {
  email: string
  password: string
}

export interface LoginFormProps {
  /**
   * App title shown above the form. Optional — when the brand slot already
   * carries the wordmark, omit title (and description) to avoid redundancy.
   */
  title?: string
  /** Optional sub-line. Omitted entirely if not set. */
  description?: string
  /**
   * Submit handler. Throw to surface a message in the form. Called only after
   * the form's own client-side validation (required fields) passes.
   */
  onSubmit: (credentials: LoginCredentials) => Promise<void> | void
  /** Optional demo credentials. When set, a small "Fill credentials" box appears below the form. */
  demo?: LoginCredentials
  /** Defaults to "Sign in". */
  submitLabel?: string
  /** Optional slot above the title — typically a logo or wordmark. */
  brand?: React.ReactNode
}

/**
 * Generic email/password sign-in form. Apps wire `onSubmit` to whatever auth
 * backend they're using (`@teamsuzie/shared-auth`, a local stub, an external
 * IdP). The form owns its own state, validation, loading state, and error
 * surface; the surrounding page is responsible for what happens after a
 * successful sign-in (refresh session, navigate, etc.).
 */
export function LoginForm({
  title,
  description,
  onSubmit,
  demo,
  submitLabel = "Sign in",
  brand,
}: LoginFormProps) {
  const [email, setEmail] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await onSubmit({ email, password })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted px-4">
      <Card className="w-full max-w-sm">
        {(brand || title || description) && (
          <CardHeader>
            {brand && <div className="mb-3">{brand}</div>}
            {title && <CardTitle>{title}</CardTitle>}
            {description && <CardDescription>{description}</CardDescription>}
          </CardHeader>
        )}
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-1.5">
              <Label htmlFor="login-email">Email</Label>
              <Input
                id="login-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="login-password">Password</Label>
              <Input
                id="login-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? "Signing in…" : submitLabel}
            </Button>
            {demo && (
              <div className="rounded-md border border-border bg-muted/50 p-3 text-xs">
                <div className="mb-1 font-medium text-foreground">Try the demo</div>
                <div className="space-y-0.5 font-mono text-muted-foreground">
                  <div>{demo.email}</div>
                  <div>{demo.password}</div>
                </div>
                <button
                  type="button"
                  className="mt-2 text-primary underline-offset-2 hover:underline"
                  onClick={() => {
                    setEmail(demo.email)
                    setPassword(demo.password)
                  }}
                >
                  Fill credentials
                </button>
              </div>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
