/**
 * Inicialização preguiçosa do Firebase (só carrega o SDK quando há configuração).
 *
 * Configuração: VITE_FIREBASE_CONFIG (build, .env.production) ou JSON colado em
 * Configurações → avançado. Para testes locais, VITE_FIREBASE_EMULATOR=1 conecta aos
 * emuladores de Auth (9099) e Firestore (8080).
 */
import type { FirebaseApp, FirebaseOptions } from 'firebase/app';
import type { Auth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import { settings } from '../state/settings';

export interface FB {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  authMod: typeof import('firebase/auth');
  fs: typeof import('firebase/firestore');
}

export function parseFirebaseConfig(raw: string): FirebaseOptions | null {
  if (!raw || !raw.trim()) return null;
  try {
    // aceita JSON puro ou o trecho "const firebaseConfig = {...};" copiado do console
    let txt = raw.trim();
    const start = txt.indexOf('{');
    const end = txt.lastIndexOf('}');
    if (start >= 0 && end > start) txt = txt.slice(start, end + 1);
    txt = txt.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":').replace(/'/g, '"').replace(/,\s*}/g, '}');
    const obj = JSON.parse(txt) as FirebaseOptions;
    if (!obj.apiKey || !obj.projectId) return null;
    return obj;
  } catch {
    return null;
  }
}

export function buildConfigRaw(): string {
  return ((import.meta.env.VITE_FIREBASE_CONFIG as string | undefined) ?? '').trim();
}

/** Configuração ativa: a colada nas configurações (avançado) tem prioridade sobre a do build. */
export function activeConfig(): FirebaseOptions | null {
  return parseFirebaseConfig(settings.get().firebaseConfig) ?? parseFirebaseConfig(buildConfigRaw());
}

export function useEmulator(): boolean {
  if (import.meta.env.VITE_FIREBASE_EMULATOR === '1') return true;
  try {
    return import.meta.env.DEV && localStorage.getItem('pl.emulator') === '1';
  } catch {
    return false;
  }
}

let current: { key: string; promise: Promise<FB | null> } | null = null;

export function getFirebase(): Promise<FB | null> {
  const cfg = activeConfig();
  if (!cfg) return Promise.resolve(null);
  const key = JSON.stringify(cfg);
  if (current?.key === key) return current.promise;
  const promise = (async (): Promise<FB | null> => {
    const [appMod, authMod, fs] = await Promise.all([import('firebase/app'), import('firebase/auth'), import('firebase/firestore')]);
    for (const a of appMod.getApps()) await appMod.deleteApp(a);
    const app = appMod.initializeApp(cfg);
    const auth = authMod.getAuth(app);
    auth.languageCode = 'pt-BR';
    let db: Firestore;
    try {
      // cache local persistente: os dados da conta continuam disponíveis offline
      db = fs.initializeFirestore(app, {
        ignoreUndefinedProperties: true,
        localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
      });
    } catch {
      db = fs.initializeFirestore(app, { ignoreUndefinedProperties: true });
    }
    if (useEmulator()) {
      authMod.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
      fs.connectFirestoreEmulator(db, '127.0.0.1', 8080);
    }
    return { app, auth, db, authMod, fs };
  })().catch((e) => {
    console.error('Firebase', e);
    return null;
  });
  current = { key, promise };
  return promise;
}
