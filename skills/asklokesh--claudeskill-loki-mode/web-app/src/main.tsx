import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import App from './App';

// BrowserRouter basename honors Vite's BASE_URL so the Lab app routes correctly
// whether served at root '/' (legacy standalone) or at '/lab/' (merged Dashboard).
const ROUTER_BASE = (import.meta.env.BASE_URL || '/').replace(/\/$/, '') || '/';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={ROUTER_BASE}>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
