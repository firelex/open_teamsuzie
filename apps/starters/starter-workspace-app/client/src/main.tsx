import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ConfirmDialogProvider } from '@teamsuzie/ui';

import App from './App';
import './index.css';

// ConfirmDialogProvider is the global approval gate: every side-effecting
// pattern (guided runs, deliverable approval, config save) routes its confirm
// through it via useConfirm(). Fixed by the template.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ConfirmDialogProvider>
        <App />
      </ConfirmDialogProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
