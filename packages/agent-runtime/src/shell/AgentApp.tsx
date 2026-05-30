import { useCallback, useEffect, useState, type ComponentProps } from 'react';
import { Link, NavLink, Route, Routes, useLocation, useParams } from 'react-router-dom';
import type { Chat } from '@teamsuzie/chats';
import {
  ConfirmDialogProvider, SidebarNavItem, SidePanelProvider,
} from '@teamsuzie/ui';
import { ClientSafeProvider, type AudienceState } from './ClientSafeContext.js';
import { AppLayout } from './AppLayout.js';
import { Sidebar, type NavItem } from './Sidebar.js';
import { Wordmark } from './Wordmark.js';
import {
  AssistantPage, LibraryPage, MattersPage, MatterDetailPage,
  PersonasPage, HistoryPage, ReviewDetailPage, ReviewsPage, SettingsPage,
} from '../pages/index.js';
import { DEFAULT_MODULES, resolveModules, resolveMattersLabel } from '../manifest/defaults.js';
import type { AgentManifest, ManifestModules } from '../manifest/schema.js';
import { useThemeFontLinks } from './useThemeFontLinks.js';
import { useThemeTokens } from './useThemeTokens.js';

interface ManifestResponse { manifest: AgentManifest }
interface HealthResponse {
  title: string;
  agent: { name: string; model?: string; reachable?: boolean };
}

// v2 brand fields. Read from manifest via a runtime cast — v1 manifests
// don't have `brand` and v2 manifests don't have a top-level `name`.
type BrandLogo =
  | { type: 'text'; wordmark: string }
  | { type: 'asset'; assetId: string };
type BrandBlock = {
  name?: string;
  shortName?: string;
  tagline?: string;
  logo?: BrandLogo;
  favicon?: { assetId: string };
};
function brandOf(m: AgentManifest | null): BrandBlock | undefined {
  return (m as unknown as { brand?: BrandBlock } | null)?.brand;
}

type HomeRead = {
  disclaimerPlacement?: 'prominent' | 'footer' | 'hidden';
};
type LegalRead = {
  jurisdictions?: string[];
  disclaimer?: string;
  clientFacing?: boolean;
};
function homeOf(m: AgentManifest | null): HomeRead | undefined {
  return (m as unknown as { home?: HomeRead } | null)?.home;
}
function legalOf(m: AgentManifest | null): LegalRead | undefined {
  return (m as unknown as { legal?: LegalRead } | null)?.legal;
}

type NavItemRead = { id: string; label: string; visible: boolean; order?: number };
function navigationOf(m: AgentManifest | null): { items: NavItemRead[] } | undefined {
  return (m as unknown as { navigation?: { items: NavItemRead[] } } | null)?.navigation;
}

function audienceOf(m: AgentManifest | null): AudienceState | undefined {
  return (m as unknown as { audience?: AudienceState } | null)?.audience;
}

function AssistantChatRoute({ agentName }: { agentName: string }) {
  const { chatId } = useParams<{ chatId: string }>();
  return <AssistantPage agentName={agentName} chatId={chatId} />;
}

function MatterChatRoute({ agentName }: { agentName: string }) {
  const { matterId, chatId } = useParams<{ matterId: string; chatId: string }>();
  return <AssistantPage agentName={agentName} chatId={chatId} matterId={matterId} />;
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

  const mods = manifest ? resolveModules(manifest) : DEFAULT_MODULES;
  const brand = brandOf(manifest);
  const home = homeOf(manifest);
  const legal = legalOf(manifest);
  const disclaimerText = legal?.disclaimer?.trim() ?? '';
  const placement = home?.disclaimerPlacement ?? 'footer';
  const showProminent = placement === 'prominent' && disclaimerText.length > 0;
  const showFooterDisclaimer = placement === 'footer' && disclaimerText.length > 0;
  const jurisdictionsText = (legal?.jurisdictions ?? []).join(', ');
  const title = brand?.name ?? manifest?.name ?? health?.title ?? 'Agent';
  const sidebarTitle = brand?.shortName ?? title;
  const agentName = manifest?.persona?.name ?? health?.agent?.name ?? 'Agent';
  const theme = manifest?.theme ?? { id: 'default' };

  // Push the brand name into the browser tab title.
  useEffect(() => {
    if (title && title !== 'Agent') document.title = title;
  }, [title]);

  // Inject / update <link rel="icon"> from brand.favicon.assetId. Idempotent.
  useEffect(() => {
    const assetId = brand?.favicon?.assetId;
    if (!assetId) return;
    const href = `/assets/${assetId}`;
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    if (link.href.endsWith(href)) return;
    link.href = href;
  }, [brand?.favicon?.assetId]);
  // Ensure the theme's web fonts are loaded. Idempotent + manifest-driven —
  // a theme switch via the builder chat updates manifest.theme.fontLinks,
  // which propagates here on the next /api/manifest poll and triggers a
  // fresh injection.
  useThemeFontLinks(theme.fontLinks);
  // Push manifest tokens (bg, fg, primary, card, border, muted, fonts,
  // colorScheme) to documentElement so a runtime theme swap actually
  // re-skins the page. The build's index.css @theme defaults are
  // overridden by these inline styles.
  useThemeTokens(theme.tokens);

  const audience = audienceOf(manifest);
  const mattersLabel = manifest
    ? resolveMattersLabel(manifest)
    : { singular: 'Matter', plural: 'Matters' };
  const navItems = navigationOf(manifest)?.items ?? [];

  const idToCap: Record<string, boolean> = {
    assistant: true,
    matters: Boolean(mods.matters),
    library: Boolean(mods.library),
    personas: Boolean(mods.personas),
    reviews: Boolean(mods.reviews),
    history: Boolean(mods.history),
  };

  // Prefer manifest.navigation.items when present; fall back to legacy
  // module-derived order otherwise.
  const orderedIds = navItems.length > 0
    ? navItems.map((n) => n.id).filter((id) => idToCap[id] !== undefined)
    : ['assistant', 'matters', 'library', 'personas', 'reviews', 'history'];

  const items: NavItem[] = [];
  for (const id of orderedIds) {
    if (!idToCap[id]) continue;
    const fromManifest = navItems.find((n) => n.id === id);
    if (fromManifest && !fromManifest.visible) continue;
    const defaultLabel =
      id === 'assistant' ? 'Assistant'
      : id === 'matters' ? mattersLabel.plural
      : id.charAt(0).toUpperCase() + id.slice(1);
    const label = fromManifest?.label ?? defaultLabel;
    const to = id === 'assistant' ? '/' : `/${id}`;
    items.push({ to, label, testId: `nav-${id}` });
  }

  return (
    <ClientSafeProvider audience={audience ?? null}>
      <SidePanelProvider>
      <ConfirmDialogProvider>
      <AppLayout
        sidebar={
          <Sidebar
            theme={theme}
            header={
              <>
                <Wordmark title={sidebarTitle} theme={theme} logo={brand?.logo} />
                {brand?.tagline && (
                  <div className="text-[11px] text-muted-foreground mt-0.5 leading-tight">
                    {brand.tagline}
                  </div>
                )}
              </>
            }
            items={items}
            renderItem={(item) => (
              item.label === 'Assistant'
                ? <SidebarNavItem asChild><AssistantNavLink /></SidebarNavItem>
                : <SidebarNavItem asChild><NavLink to={item.to}>{item.label}</NavLink></SidebarNavItem>
            )}
            footer={
              <>
                {mods.settings && (
                  <SidebarNavItem asChild>
                    <NavLink to="/settings">Settings</NavLink>
                  </SidebarNavItem>
                )}
                {(jurisdictionsText.length > 0 || showFooterDisclaimer) && (
                  <div className="mt-2 border-t border-border pt-2 px-2 text-[10.5px] leading-[1.4] text-muted-foreground">
                    {jurisdictionsText.length > 0 && (
                      <div>Jurisdictions: {jurisdictionsText}</div>
                    )}
                    {showFooterDisclaimer && (
                      <div className="mt-1 italic">{disclaimerText}</div>
                    )}
                  </div>
                )}
              </>
            }
          />
        }
      >
        {showProminent && (
          <div className="border-b border-border bg-muted/50 px-6 py-2 text-[12.5px] text-foreground">
            {disclaimerText}
          </div>
        )}
        <Routes>
          <Route path="/" element={<AssistantPage agentName={agentName} />} />
          <Route path="/c/:chatId" element={<AssistantChatRoute agentName={agentName} />} />
          {mods.matters  && <Route path="/matters"                          element={<MattersPage manifest={manifest} />} />}
          {mods.matters  && <Route path="/matters/:matterId"                 element={<MatterDetailPage manifest={manifest} />} />}
          {mods.matters && mods.reviews && <Route path="/matters/:matterId/reviews/:reviewId" element={<ReviewDetailPage manifest={manifest} />} />}
          {mods.matters  && <Route path="/m/:matterId/c/:chatId"             element={<MatterChatRoute agentName={agentName} />} />}
          {mods.library  && <Route path="/library"  element={<LibraryPage />} />}
          {mods.personas && <Route path="/personas" element={<PersonasPage />} />}
          {mods.reviews  && <Route path="/reviews"  element={<ReviewsPage />} />}
          {mods.history  && <Route path="/history"  element={<HistoryPage />} />}
          {mods.settings && <Route path="/settings" element={<SettingsPage defaultModel={health?.agent?.model} />} />}
        </Routes>
      </AppLayout>
      </ConfirmDialogProvider>
      </SidePanelProvider>
    </ClientSafeProvider>
  );
}
