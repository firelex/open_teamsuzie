import { useEffect, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import {
  AppShell,
  AppShellMain,
  Sidebar,
  SidebarFooter,
  SidebarHeader,
  SidebarNav,
  SidebarNavItem,
  cn,
} from '@teamsuzie/ui';
import { AssistantPage } from './pages/assistant.js';
import { HistoryPage } from './pages/history.js';
import { LibraryPage } from './pages/library.js';

interface HealthResponse {
  title: string;
  agent: {
    name: string;
    description?: string;
    reachable: boolean;
    error?: string;
  };
}

const NAV = [
  { to: '/', label: 'Assistant', end: true },
  { to: '/library', label: 'Library' },
  { to: '/history', label: 'History' },
];

function Wordmark({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="size-6 rounded-md bg-foreground" aria-hidden="true" />
      <span className="text-sm font-semibold tracking-tight">{title}</span>
    </div>
  );
}

function StatusDot({
  name,
  state,
}: {
  name: string;
  state: 'online' | 'offline' | 'pending';
}) {
  const dot = {
    online: 'bg-emerald-500',
    offline: 'bg-destructive',
    pending: 'bg-muted-foreground/50',
  }[state];
  const title = {
    online: 'Runtime reachable',
    offline: 'Runtime offline',
    pending: 'Checking runtime',
  }[state];
  return (
    <span
      className="inline-flex items-center gap-2 text-xs text-muted-foreground"
      title={title}
    >
      <span className={cn('size-1.5 rounded-full', dot)} aria-hidden="true" />
      <span className="font-medium text-foreground/80">{name}</span>
    </span>
  );
}

export default function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthLoaded, setHealthLoaded] = useState(false);

  useEffect(() => {
    fetch('/api/health')
      .then((response) => response.json() as Promise<HealthResponse>)
      .then(setHealth)
      .catch(() => undefined)
      .finally(() => setHealthLoaded(true));
  }, []);

  const title = health?.title || 'Starter Chat';
  const agentName = health?.agent?.name || 'Assistant';
  const agentReachable = health?.agent?.reachable ?? false;
  const statusState: 'online' | 'offline' | 'pending' = !healthLoaded
    ? 'pending'
    : agentReachable
      ? 'online'
      : 'offline';

  return (
    <AppShell>
      <Sidebar>
        <SidebarHeader>
          <Wordmark title={title} />
        </SidebarHeader>
        <SidebarNav>
          {NAV.map((item) => (
            <SidebarNavItem key={item.to} asChild>
              <NavLink to={item.to} end={item.end}>
                {item.label}
              </NavLink>
            </SidebarNavItem>
          ))}
        </SidebarNav>
        <SidebarFooter>
          <StatusDot name={agentName} state={statusState} />
        </SidebarFooter>
      </Sidebar>
      <AppShellMain>
        <Routes>
          <Route path="/" element={<AssistantPage agentName={agentName} />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/history" element={<HistoryPage />} />
        </Routes>
      </AppShellMain>
    </AppShell>
  );
}
