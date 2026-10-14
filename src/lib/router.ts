import { useSyncExternalStore } from 'react';

/** Roteador por hash (#/caminho?x=1) — funciona em qualquer hospedagem estática. */
export interface Route {
  path: string;
  parts: string[];
  query: URLSearchParams;
}

function parse(): Route {
  const raw = window.location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  return { path, parts: path.split('/').filter(Boolean), query: new URLSearchParams(qs ?? '') };
}

let current = parse();
const listeners = new Set<() => void>();
window.addEventListener('hashchange', () => {
  current = parse();
  listeners.forEach((fn) => fn());
  window.scrollTo(0, 0);
});

export function useRoute(): Route {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => current,
  );
}

export function navigate(to: string, replace = false) {
  const hash = '#' + (to.startsWith('/') ? to : '/' + to);
  if (replace) {
    history.replaceState(null, '', hash);
    current = parse();
    listeners.forEach((fn) => fn());
  } else window.location.hash = hash;
}

export function back(fallback = '/') {
  if (history.length > 1) history.back();
  else navigate(fallback);
}
