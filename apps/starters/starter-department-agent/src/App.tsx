import { Routes, Route } from 'react-router-dom';

import { AppShell } from './components/AppShell';
import { DashboardPage } from './pages/DashboardPage';
import { ChatPage } from './pages/ChatPage';
import { ActivityPage } from './pages/ActivityPage';
import { WorkQueuePage } from './pages/WorkQueuePage';
import { ArtifactsPage } from './pages/ArtifactsPage';
import { ApprovalsPage } from './pages/ApprovalsPage';
import { SettingsPage } from './pages/SettingsPage';

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/activity" element={<ActivityPage />} />
        <Route path="/work-queue" element={<WorkQueuePage />} />
        <Route path="/artifacts" element={<ArtifactsPage />} />
        <Route path="/approvals" element={<ApprovalsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </AppShell>
  );
}
