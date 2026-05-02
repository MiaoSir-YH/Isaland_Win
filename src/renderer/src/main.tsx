import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { createBrowserPreviewApi } from './browserPreviewApi';

if (!window.vibeIsland) {
  window.vibeIsland = createBrowserPreviewApi();
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
