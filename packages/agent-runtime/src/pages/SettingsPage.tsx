import { useEffect, useState } from 'react';
import {
  AppShellContent,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DEFAULT_MODELS,
  ModelPicker,
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
  useSelectedModel,
} from '@teamsuzie/ui';
import type { ManifestTool } from '../manifest/schema.js';

const SELECTED_MODEL_KEY = 'starter-chat:selected-model';

function PlannedToolsSection({ tools }: { tools?: ManifestTool[] }) {
  const items = tools ?? [];
  if (items.length === 0) return null;
  return (
    <section className="mt-8 max-w-3xl">
      <h2 className="mb-2 text-sm font-semibold">Planned tools</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Declared in agent.json. Stubs are intent-only and not callable until implemented.
      </p>
      <ul className="space-y-2">
        {items.map((t) => (
          <li key={t.name} className="rounded border border-border bg-card p-3">
            <div className="flex items-baseline gap-2">
              <code className="font-mono text-sm">{t.name}</code>
              <span
                className={
                  t.status === 'implemented'
                    ? 'rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary'
                    : 'rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground'
                }
              >
                {t.status ?? 'implemented'}
              </span>
              {t.enabled === false && (
                <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  disabled
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{t.description}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SettingsPage({
  defaultModel,
}: {
  /** Server-configured default model — shown when the user hasn't picked one. */
  defaultModel?: string;
}) {
  const [selected, setSelected] = useSelectedModel(SELECTED_MODEL_KEY, defaultModel);
  const [tools, setTools] = useState<ManifestTool[] | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/manifest')
      .then((r) => r.json() as Promise<{ manifest?: { tools?: ManifestTool[] } }>)
      .then((data) => {
        if (!cancelled) setTools(data?.manifest?.tools);
      })
      .catch(() => { /* best effort */ });
    return () => { cancelled = true; };
  }, []);

  return (
    <>
      <PageHeader>
        <PageHeaderContent>
          <PageHeaderTitle>Settings</PageHeaderTitle>
          <PageHeaderDescription>
            Preferences that apply to your chat sessions.
          </PageHeaderDescription>
        </PageHeaderContent>
      </PageHeader>
      <AppShellContent className="px-6 pt-6 pb-12">
        <div className="grid max-w-3xl gap-4">
          <Card>
            <CardHeader>
              <CardDescription>Chat model</CardDescription>
              <CardTitle>Pick the model that powers your assistant</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-4 text-xs text-muted-foreground">
                Changes apply on the next message. Pricing values are approximate;
                follow the link beside each model to verify on the provider's
                pricing page.
              </p>
              <ModelPicker
                models={DEFAULT_MODELS}
                selected={selected}
                onSelect={setSelected}
              />
            </CardContent>
          </Card>
        </div>
        <PlannedToolsSection tools={tools} />
      </AppShellContent>
    </>
  );
}
