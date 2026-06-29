import { Routes, Route } from 'react-router-dom';

import { AppShell } from './components/AppShell';
import { HomePage } from './pages/HomePage';

/**
 * Router. The template ships a single Home route so the app runs immediately.
 * The build agent adds one <Route> per nav-group item and object workspace from
 * docs/ux/layout.json, each rendering a canonical pattern from ./patterns.
 */
export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<HomePage />} />
      </Routes>
    </AppShell>
  );
}
