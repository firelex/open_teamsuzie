import type { ReactNode } from 'react';
import { AppShell, AppShellMain } from '@teamsuzie/ui';

export function AppLayout({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  return (
    <AppShell>
      {sidebar}
      <AppShellMain>{children}</AppShellMain>
    </AppShell>
  );
}
