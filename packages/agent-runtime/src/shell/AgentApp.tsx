import { useCallback, useEffect, useState, type ComponentProps } from 'react';
import { Link, NavLink, Route, Routes, useLocation, useParams } from 'react-router-dom';
import type { Chat } from '@teamsuzie/chats';
import {
  ConfirmDialogProvider, SidebarNavItem, SidePanelProvider,
} from '@teamsuzie/ui';
import { AppLayout } from './AppLayout.js';
import { Sidebar, type NavItem } from './Sidebar.js';
import { Wordmark } from './Wordmark.js';
import {
  AssistantPage, LibraryPage, MattersPage, MatterDetailPage,
  PersonasPage, HistoryPage, ReviewsPage, SettingsPage,
} from '../pages/index.js';
import { DEFAULT_MODULES, resolveMattersLabel } from '../manifest/defaults.js';
import type { AgentManifest, ManifestModules } from '../manifest/schema.js';

interface ManifestResponse { manifest: AgentManifest }
interface HealthResponse {
  title: string;
  agent: { name: string; model?: string; reachable?: boolean };
}

function resolveModules(m: AgentManifest | null): ManifestModules {
  return { ...DEFAULT_MODULES, ...((m?.modules) ?? {}) };
}

function AssistantChatRoute({ agentName }: { agentName: string }) {
  const { chatId } = useParams<{ chatId: string }>();
  return <AssistantPage agentName={agentName} chatId={chatId} />;
}

type AssistantNavLinkProps = Omit<ComponentProps<typeof Link>, 'to' | 'aria-current' | 'children'>;

function AssistantNavLink(props: AssistantNavLinkProps) {
  const [chats, setChats] = useState<Chat[]>([]);
  const location = useLocation();
  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/chats');
      if (!res.ok) return;
      const data = (await res.json()) as { items: Chat[] };
      setChats(data.items);
    } catch { /* best effort */ }
  }, []);
  useEffect(() => { void refresh(); }, [refresh, location.pathname]);
  const to = chats[0]?.id ? `/c/${encodeURIComponent(chats[0].id)}` : '/';
  const isActive = location.pathname === '/' || location.pathname.startsWith('/c/');
  return <Link {...props} to={to} aria-current={isActive ? 'page' : undefined}>Assistant</Link>;
}

export function AgentApp() {
  const [manifest, setManifest] = useState<AgentManifest | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const [m, h] = await Promise.all([
          fetch('/api/manifest').then((r) => r.json() as Promise<ManifestResponse>),
          fetch('/api/health').then((r) => r.json() as Promise<HealthResponse>),
        ]);
        if (!cancelled) { setManifest(m.manifest); setHealth(h); }
      } catch { /* best effort */ }
    };
    void refresh();
    const id = window.setInterval(() => void refresh(), 5000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);

  const mods = resolveModules(manifest);
  const title = manifest?.name ?? health?.title ?? 'Agent';
  const agentName = manifest?.persona?.name ?? health?.agent?.name ?? 'Agent';
  const theme = manifest?.theme ?? { id: 'default' };

  const mattersLabel = manifest
    ? resolveMattersLabel(manifest)
    : { singular: 'Matter', plural: 'Matters' };
  const items: NavItem[] = [
    { to: '/', label: 'Assistant', testId: 'nav-assistant' },
  ];
  if (mods.matters)  items.push({ to: '/matters',  label: mattersLabel.plural, testId: 'nav-matters' });
  if (mods.library)  items.push({ to: '/library',  label: 'Library',  testId: 'nav-library' });
  if (mods.personas) items.push({ to: '/personas', label: 'Personas', testId: 'nav-personas' });
  if (mods.reviews)  items.push({ to: '/reviews',  label: 'Reviews',  testId: 'nav-reviews' });
  if (mods.history)  items.push({ to: '/history',  label: 'History',  testId: 'nav-history' });

  return (
    <SidePanelProvider>
    <ConfirmDialogProvider>
      <AppLayout
        sidebar={
          <Sidebar
            theme={theme}
            header={<Wordmark title={title} theme={theme} />}
            items={items}
            renderItem={(item) => (
              item.label === 'Assistant'
                ? <SidebarNavItem asChild><AssistantNavLink /></SidebarNavItem>
                : <SidebarNavItem asChild><NavLink to={item.to}>{item.label}</NavLink></SidebarNavItem>
            )}
            footer={mods.settings ? (
              <SidebarNavItem asChild><NavLink to="/settings">Settings</NavLink></SidebarNavItem>
            ) : null}
          />
        }
      >
        <Routes>
          <Route path="/" element={<AssistantPage agentName={agentName} />} />
          <Route path="/c/:chatId" element={<AssistantChatRoute agentName={agentName} />} />
          {mods.matters  && <Route path="/matters"           element={<MattersPage manifest={manifest} />} />}
          {mods.matters  && <Route path="/matters/:matterId"  element={<MatterDetailPage manifest={manifest} />} />}
          {mods.library  && <Route path="/library"  element={<LibraryPage />} />}
          {mods.personas && <Route path="/personas" element={<PersonasPage />} />}
          {mods.reviews  && <Route path="/reviews"  element={<ReviewsPage />} />}
          {mods.history  && <Route path="/history"  element={<HistoryPage />} />}
          {mods.settings && <Route path="/settings" element={<SettingsPage defaultModel={health?.agent?.model} />} />}
        </Routes>
      </AppLayout>
    </ConfirmDialogProvider>
    </SidePanelProvider>
  );
}
