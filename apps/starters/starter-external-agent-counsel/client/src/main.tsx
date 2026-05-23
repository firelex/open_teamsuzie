import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AgentApp } from '@teamsuzie/agent-runtime';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');
createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <AgentApp />
    </BrowserRouter>
  </StrictMode>,
);
