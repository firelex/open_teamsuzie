import { useCallback, useEffect, useState } from 'react';
import {
  Link,
  NavLink,
  Route,
  Routes,
  useLocation,
  useParams,
} from 'react-router-dom';
import {
  AppShell,
  AppShellMain,
  Sidebar,
  SidebarFooter,
  SidebarHeader,
  SidebarNav,
  SidebarNavItem,
  StatusDot,
} from '@teamsuzie/ui';
import type { Chat } from '@teamsuzie/chats';
import { AssistantPage } from './pages/assistant.js';
import { HistoryPage } from './pages/history.js';
import { LibraryPage } from './pages/library.js';
import { SettingsPage } from './pages/settings.js';

interface HealthResponse {
  title: string;
  agent: {
    name: string;
    description?: string;
    model?: string;
    reachable: boolean;
    error?: string;
  };
}

function AssistantChatRoute({ agentName }: { agentName: string }) {
  const { chatId } = useParams<{ chatId: string }>();
  return <AssistantPage agentName={agentName} chatId={chatId} />;
}

/**
 * Sidebar Assistant link. Resumes the most recent chat when one exists, so
 * navigating away and back doesn't blow away the conversation; falls back
 * to `/` (greeting) when there are no chats yet. The "New chat" button on
 * the Assistant page navigates to `/` to start a fresh thread.
 *
 * Drives `aria-current` from `useLocation` so the row is highlighted on
 * both `/` and `/c/*` — NavLink's built-in matcher only handles a single
 * path pattern.
 */
function AssistantNavLink(props: React.ComponentPropsWithoutRef<'a'>) {
  const [chats, setChats] = useState<Chat[]>([]);
  const location = useLocation();
  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/chats');
      if (!res.ok) return;
      const data = (await res.json()) as { items: Chat[] };
      setChats(data.items);
    } catch {
      // best-effort — link falls back to `/`.
    }
  }, []);
  // Refresh on every route change so creating / deleting a chat updates the
  // target without us having to thread state through.
  useEffect(() => {
    void refresh();
  }, [refresh, location.pathname]);
  const mostRecentId = chats[0]?.id;
  const to = mostRecentId ? `/c/${encodeURIComponent(mostRecentId)}` : '/';
  const isActive =
    location.pathname === '/' || location.pathname.startsWith('/c/');
  // SidebarNavItem with `asChild` uses Radix Slot, which clones className /
  // data-slot props onto the child *element*. Spread `props` onto the inner
  // Link so the sidebar's row styling actually reaches the anchor.
  return (
    <Link to={to} aria-current={isActive ? 'page' : undefined} {...props}>
      Assistant
    </Link>
  );
}

const SECONDARY_NAV = [
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
          <SidebarNavItem asChild>
            <AssistantNavLink />
          </SidebarNavItem>
          {SECONDARY_NAV.map((item) => (
            <SidebarNavItem key={item.to} asChild>
              <NavLink to={item.to}>{item.label}</NavLink>
            </SidebarNavItem>
          ))}
        </SidebarNav>
        <SidebarFooter>
          <SidebarNavItem asChild>
            <NavLink to="/settings">Settings</NavLink>
          </SidebarNavItem>
          <div className="mt-2">
            <StatusDot name={agentName} state={statusState} />
          </div>
        </SidebarFooter>
      </Sidebar>
      <AppShellMain>
        <Routes>
          <Route path="/" element={<AssistantPage agentName={agentName} />} />
          <Route
            path="/c/:chatId"
            element={<AssistantChatRoute agentName={agentName} />}
          />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route
            path="/settings"
            element={<SettingsPage defaultModel={health?.agent?.model} />}
          />
        </Routes>
      </AppShellMain>
    </AppShell>
  );
}
