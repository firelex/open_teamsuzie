import * as React from "react"

import { AppShellContent } from "./app-shell.js"
import { Button } from "./button.js"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./card.js"
import {
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from "./page-header.js"
import { ModelPicker, type ModelOption } from "./model-picker.js"
import { useUiT } from "../lib/i18n.js"

export interface SettingsLayoutProps {
  title?: string
  description?: string
  children: React.ReactNode
}

/**
 * Standard settings page chrome. Apps render their own cards as children;
 * the layout provides the page header and a consistent two-column grid
 * (single column on small screens).
 */
export function SettingsLayout({ title, description, children }: SettingsLayoutProps) {
  const { t } = useUiT()
  return (
    <>
      <PageHeader>
        <PageHeaderContent>
          <PageHeaderTitle>{title ?? t('settingsCards.settings')}</PageHeaderTitle>
          {description && <PageHeaderDescription>{description}</PageHeaderDescription>}
        </PageHeaderContent>
      </PageHeader>
      <AppShellContent className="px-6 pt-6 pb-12">
        <div className="grid gap-4 lg:grid-cols-2">{children}</div>
      </AppShellContent>
    </>
  )
}

export interface AccountCardProps {
  user: { name?: string | null; email?: string | null; role?: string | null } | null
  onLogout: () => void | Promise<void>
  /** Card description label. Defaults to "Account". */
  label?: string
  /** Extra rows to render below the standard email/role block. */
  children?: React.ReactNode
}

/**
 * Account card: user identity, sign-out button, plus a children slot for app-
 * specific extras. Uses `<Card>` so the `className` for grid placement is
 * handled by the parent layout.
 */
export function AccountCard({ user, onLogout, label, children }: AccountCardProps) {
  const { t } = useUiT()
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label ?? t('settingsCards.account')}</CardDescription>
        <CardTitle>{user?.name ?? "—"}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-xs text-muted-foreground">
          {user?.email && (
            <div>
              <span className="font-medium text-foreground">{t('settingsCards.emailLabel')}</span>{" "}
              <span className="font-mono">{user.email}</span>
            </div>
          )}
          {user?.role && (
            <div>
              <span className="font-medium text-foreground">{t('settingsCards.roleLabel')}</span>{" "}
              <span className="font-mono">{user.role}</span>
            </div>
          )}
        </div>
        {children}
        <Button variant="outline" size="sm" onClick={() => void onLogout()}>
          {t('settingsCards.signOut')}
        </Button>
      </CardContent>
    </Card>
  )
}

export interface ModelPickerCardProps {
  models: ModelOption[]
  selected?: string
  onSelect: (id: string) => void
  /** Override the default heading. */
  title?: string
  description?: string
  hint?: string
  /** Render full-width by default — most settings pages place the picker
   *  across both columns. */
  fullWidth?: boolean
  /** Forward to ModelPicker.compact. Defaults to true. */
  compact?: boolean
  /** Forward to ModelPicker.onConfigure — wire to a `<LocalModelConfigDialog>`. */
  onConfigure?: (model: ModelOption) => void
}

/**
 * Model-picker card — a card-wrapped `<ModelPicker>`. Apps pass the model
 * list and selection state; persistence (localStorage etc.) is the app's
 * responsibility, typically via `useSelectedModel`.
 */
export function ModelPickerCard({
  models,
  selected,
  onSelect,
  title,
  description,
  hint,
  fullWidth = true,
  compact = true,
  onConfigure,
}: ModelPickerCardProps) {
  const { t } = useUiT()
  const effectiveTitle = title ?? t('settingsCards.pickModelTitle')
  const effectiveDescription = description ?? t('settingsCards.chatModel')
  const effectiveHint = hint ?? t('settingsCards.pickModelHint')
  return (
    <Card className={fullWidth ? "lg:col-span-2" : undefined}>
      <CardHeader>
        <CardDescription>{effectiveDescription}</CardDescription>
        <CardTitle>{effectiveTitle}</CardTitle>
      </CardHeader>
      <CardContent>
        {effectiveHint && <p className="mb-3 text-xs text-muted-foreground">{effectiveHint}</p>}
        <ModelPicker
          models={models}
          selected={selected}
          onSelect={onSelect}
          compact={compact}
          onConfigure={onConfigure}
        />
      </CardContent>
    </Card>
  )
}

export interface SettingsCardProps {
  /** Card description label (small, above the title). */
  label: string
  title: string
  children: React.ReactNode
  /** Make this card span both columns. */
  fullWidth?: boolean
}

/**
 * Generic settings card for app-specific content (About, Storage,
 * connected services, etc.). The layout primitives are exported so apps
 * can drop in their own copy without re-implementing card chrome.
 */
export function SettingsCard({ label, title, children, fullWidth }: SettingsCardProps) {
  return (
    <Card className={fullWidth ? "lg:col-span-2" : undefined}>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-xs text-muted-foreground">{children}</CardContent>
    </Card>
  )
}
