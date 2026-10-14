import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// PWA: funciona offline e pode ser instalado no celular
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* sem service worker */
    });
  });
}

// depuração (somente em desenvolvimento)
if (import.meta.env.DEV) {
  void Promise.all([import('./audio/mic'), import('./audio/input')]).then(([m, i]) => {
    (window as unknown as Record<string, unknown>).__pl = { mic: m.mic, input: i.input };
  });
}
