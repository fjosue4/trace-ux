import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
// Self-hosted Inter (latin subset) — consistent, professional type everywhere,
// no external font CDN calls.
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/inter/latin-800.css';
// Global styles load first so page-level CSS can override base rules.
import './styles/tokens.css';
import './styles/base.css';
import App from './App';
import Login from './pages/Login';
import Sites from './pages/Sites';
import SiteDetail from './pages/SiteDetail';
import Sessions from './pages/Sessions';
import Performance from './pages/Performance';
import Replay from './pages/Replay';
import ShareReplay from './pages/ShareReplay';
import Feedback from './pages/Feedback';
import Logs from './pages/Logs';
import Settings from './pages/Settings';
import SystemHealth from './pages/SystemHealth';

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <Sites /> },
      { path: 'login', element: <Login /> },
      { path: 'sessions', element: <Sessions /> },
      { path: 'performance', element: <Performance /> },
      { path: 'site/:siteId', element: <SiteDetail /> },
      { path: 'feedback', element: <Feedback /> },
      { path: 'logs', element: <Logs /> },
      { path: 'replay/:sessionId', element: <Replay /> },
      { path: 'share/:token', element: <ShareReplay /> },
      { path: 'settings', element: <Settings /> },
      { path: 'system-health', element: <SystemHealth /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
