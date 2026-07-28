import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ConfirmDialogProvider } from '@teamsuzie/ui';

import App from './App';
import { AuthGate } from './components/AuthGate';
import './index.css';

// AuthGate is the app-wide auth boundary (fixed by the template): an anonymous
// user sees the login page and never the shell, so no protected surface renders
// unauthenticated. ConfirmDialogProvider is the global approval gate: every
// side-effecting pattern routes its confirm through it via useConfirm().
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ConfirmDialogProvider>
        <AuthGate>
          <App />
        </AuthGate>
      </ConfirmDialogProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
