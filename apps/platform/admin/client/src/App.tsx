import { useEffect, useState } from 'react';
import { NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import {
  AppShell,
  AppShellMain,
  Button,
  Sidebar,
  SidebarFooter,
  SidebarHeader,
  SidebarNav,
  SidebarNavItem,
} from '@teamsuzie/ui';
import { Protected } from './components/protected.js';
import { useSession, type SessionUser } from './hooks/use-session.js';
import { LoginPage } from './pages/login.js';
import { ChatPage } from './pages/chat.js';
import { OverviewPage } from './pages/overview.js';
import { AgentsPage } from './pages/agents.js';
import { AgentEditPage } from './pages/agent-edit.js';
import { SkillsPage } from './pages/skills.js';
import { ApprovalsPage } from './pages/approvals.js';
import { ArtifactsPage } from './pages/artifacts.js';
import { TokensPage } from './pages/tokens.js';
import { ConfigPage } from './pages/config.js';
import { ActivityPage } from './pages/activity.js';

interface HealthResponse {
  title: string;
  agentsConfigured: number;
  demo?: { email: string; password: string };
}

interface NavEntry {
  to: string;
  label: string;
  end?: boolean;
}

const NAV: NavEntry[] = [
  { to: '/', label: 'Overview', end: true },
  { to: '/chat', label: 'Chat' },
  { to: '/agents', label: 'Agents' },
  { to: '/skills', label: 'Skills' },
  { to: '/approvals', label: 'Approvals' },
  { to: '/artifacts', label: 'Artifacts' },
  { to: '/tokens', label: 'Tokens' },
  { to: '/config', label: 'Config' },
  { to: '/activity', label: 'Activity' },
];

function Wordmark({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="size-6 rounded-md bg-foreground" aria-hidden="true" />
      <span className="text-sm font-semibold tracking-tight">{title}</span>
    </div>
  );
}

function AdminSidebar({
  title,
  user,
  onLogout,
}: {
  title: string;
  user: SessionUser;
  onLogout: () => Promise<void>;
}) {
  return (
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
        <div className="space-y-2">
          <div className="truncate text-foreground/80">{user.email}</div>
          <Button variant="outline" size="sm" className="w-full" onClick={() => void onLogout()}>
            Sign out
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}

function AppContent({
  health,
  user,
  onLogout,
}: {
  health: HealthResponse;
  user: SessionUser;
  onLogout: () => Promise<void>;
}) {
  return (
    <AppShell>
      <AdminSidebar title={health.title} user={user} onLogout={onLogout} />
      <AppShellMain>
        <Routes>
          <Route
            path="/"
            element={<OverviewPage title={health.title} agentsConfigured={health.agentsConfigured} user={user} />}
          />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/agents/new" element={<AgentEditPage />} />
          <Route path="/agents/:id" element={<AgentEditPage />} />
          <Route path="/skills" element={<SkillsPage />} />
          <Route path="/approvals" element={<ApprovalsPage />} />
          <Route path="/artifacts" element={<ArtifactsPage />} />
          <Route path="/tokens" element={<TokensPage />} />
          <Route path="/config" element={<ConfigPage />} />
          <Route path="/activity" element={<ActivityPage />} />
        </Routes>
      </AppShellMain>
    </AppShell>
  );
}

function AuthedGate({
  children,
  user,
  loading,
}: {
  children: React.ReactNode;
  user: SessionUser | null;
  loading: boolean;
}) {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && user && location.pathname === '/login') {
      navigate('/', { replace: true });
    }
  }, [loading, user, location.pathname, navigate]);

  return <>{children}</>;
}

export default function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const session = useSession();

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json() as Promise<HealthResponse>)
      .then(setHealth)
      .catch(() => setHealth({ title: 'Team Suzie Admin', agentsConfigured: 0 }));
  }, []);

  const resolvedHealth = health ?? { title: 'Team Suzie Admin', agentsConfigured: 0 };

  return (
    <AuthedGate user={session.user} loading={session.loading}>
      <Routes>
        <Route
          path="/login"
          element={
            <LoginPage
              title={resolvedHealth.title}
              onAuthenticated={session.refresh}
              demo={resolvedHealth.demo}
            />
          }
        />
        <Route
          path="/*"
          element={
            <Protected user={session.user} loading={session.loading}>
              {session.user && (
                <AppContent
                  health={resolvedHealth}
                  user={session.user}
                  onLogout={session.logout}
                />
              )}
            </Protected>
          }
        />
      </Routes>
    </AuthedGate>
  );
}
