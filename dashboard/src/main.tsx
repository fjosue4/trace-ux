import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import App from './App';
import Login from './pages/Login';
import Sites from './pages/Sites';
import Sessions from './pages/Sessions';
import Replay from './pages/Replay';
import './styles.css';

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <Sites /> },
      { path: 'login', element: <Login /> },
      { path: 'site/:siteId', element: <Sessions /> },
      { path: 'replay/:sessionId', element: <Replay /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
