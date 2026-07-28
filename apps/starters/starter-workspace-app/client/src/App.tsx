import { Routes, Route } from 'react-router-dom';
import { ModelsPage } from '@teamsuzie/models-ui';

import { AppShell } from './components/AppShell';
import { HomePage } from './pages/HomePage';

/**
 * Router. The template ships a Home route and the shared Models page (pick a
 * hosted/local model and chat with it — hosted keys inherited from the parent).
 * The build agent adds one <Route> per nav-group item and object workspace from
 * docs/ux/layout.json, each rendering a canonical pattern from ./patterns.
 */
export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/models" element={<ModelsPage />} />
      </Routes>
    </AppShell>
  );
}
