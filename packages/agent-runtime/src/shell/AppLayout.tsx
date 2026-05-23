import type { ReactNode } from 'react';

export function AppLayout({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-screen">
      {sidebar}
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
