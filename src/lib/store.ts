import { useSyncExternalStore } from 'react';

export interface Store<T> {
  get(): T;
  set(next: Partial<T> | ((prev: T) => T)): void;
  replace(next: T): void;
  subscribe(fn: () => void): () => void;
}

function safeRead<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function safeWrite(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* armazenamento indisponível (modo privado etc.) */
  }
}

/** Store simples persistido no localStorage. */
export function createStore<T extends object>(key: string, initial: T): Store<T> {
  let state: T = { ...initial, ...(safeRead<Partial<T>>(key) ?? {}) };
  const listeners = new Set<() => void>();
  let timer: number | null = null;
  const persist = () => {
    if (timer !== null) return;
    timer = window.setTimeout(() => {
      timer = null;
      safeWrite(key, state);
    }, 250);
  };
  const emit = () => listeners.forEach((fn) => fn());
  return {
    get: () => state,
    set(next) {
      state = typeof next === 'function' ? (next as (p: T) => T)(state) : { ...state, ...next };
      persist();
      emit();
    },
    replace(next) {
      state = next;
      persist();
      emit();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export function useStore<T extends object>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
