/**
 * Sincronização opcional com Firebase (plano gratuito "Spark"):
 * login com Google + um documento por usuário no Firestore (users/{uid}).
 *
 * O app funciona 100% offline sem isso; o Firebase só serve para levar o
 * progresso entre aparelhos. A configuração vem de:
 *  1. variável de build VITE_FIREBASE_CONFIG (JSON), ou
 *  2. JSON colado em Configurações → Sincronização.
 */
import type { FirebaseApp, FirebaseOptions } from 'firebase/app';
import type { Auth, User } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import { createStore } from './store';
import { emptyProgress, mergeProgress, progress, type Progress } from '../state/progress';
import { settings, type Settings } from '../state/settings';

export interface SyncState {
  status: 'off' | 'ready' | 'signed-in' | 'syncing' | 'error';
  user?: { name: string; email: string; photo?: string };
  message?: string;
  lastSync?: number;
}

export const syncState = createStore<SyncState>('pl.syncState.v1', { status: 'off' });

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;
let currentConfigKey = '';
let unsubLocal: (() => void) | null = null;
let pushTimer: number | null = null;
let applyingRemote = false;

export function parseFirebaseConfig(raw: string): FirebaseOptions | null {
  if (!raw.trim()) return null;
  try {
    // aceita tanto JSON puro quanto o trecho "const firebaseConfig = {...};" do console
    let txt = raw.trim();
    const start = txt.indexOf('{');
    const end = txt.lastIndexOf('}');
    if (start >= 0 && end > start) txt = txt.slice(start, end + 1);
    // chaves sem aspas -> JSON
    txt = txt.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":').replace(/'/g, '"').replace(/,\s*}/g, '}');
    const obj = JSON.parse(txt) as FirebaseOptions;
    if (!obj.apiKey || !obj.projectId) return null;
    return obj;
  } catch {
    return null;
  }
}

function configRaw(): string {
  const env = import.meta.env.VITE_FIREBASE_CONFIG as string | undefined;
  return env && env.trim() ? env : settings.get().firebaseConfig;
}

export function hasBuildConfig(): boolean {
  const env = import.meta.env.VITE_FIREBASE_CONFIG as string | undefined;
  return !!(env && env.trim());
}

export async function startSync(): Promise<void> {
  const raw = configRaw();
  const cfg = parseFirebaseConfig(raw);
  if (!cfg) {
    syncState.set({ status: 'off', user: undefined, message: raw.trim() ? 'Configuração do Firebase inválida.' : undefined });
    return;
  }
  const key = JSON.stringify(cfg);
  if (key === currentConfigKey && app) return;
  currentConfigKey = key;
  try {
    const [{ initializeApp, getApps, deleteApp }, authMod, fsMod] = await Promise.all([
      import('firebase/app'),
      import('firebase/auth'),
      import('firebase/firestore'),
    ]);
    for (const a of getApps()) await deleteApp(a);
    app = initializeApp(cfg);
    auth = authMod.getAuth(app);
    db = fsMod.getFirestore(app);
    syncState.set({ status: 'ready', message: undefined });
    authMod.onAuthStateChanged(auth, (u) => {
      if (u) void onSignedIn(u);
      else {
        unsubLocal?.();
        unsubLocal = null;
        syncState.set({ status: 'ready', user: undefined });
      }
    });
  } catch (e) {
    syncState.set({ status: 'error', message: String(e) });
  }
}

export async function signIn(): Promise<void> {
  if (!auth) await startSync();
  if (!auth) throw new Error('Firebase não configurado.');
  const { GoogleAuthProvider, signInWithPopup, signInWithRedirect } = await import('firebase/auth');
  const provider = new GoogleAuthProvider();
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    const code = (e as { code?: string }).code ?? '';
    if (code.includes('popup-blocked') || code.includes('operation-not-supported')) await signInWithRedirect(auth, provider);
    else {
      syncState.set({ status: 'error', message: friendlyError(code, e) });
      throw e;
    }
  }
}

export async function signOutSync(): Promise<void> {
  if (!auth) return;
  const { signOut } = await import('firebase/auth');
  await signOut(auth);
}

function friendlyError(code: string, e: unknown): string {
  if (code.includes('unauthorized-domain'))
    return 'Este domínio não está autorizado no Firebase. Adicione-o em Authentication → Settings → Authorized domains.';
  if (code.includes('operation-not-allowed')) return 'Ative o provedor "Google" em Authentication → Sign-in method.';
  if (code.includes('permission-denied')) return 'Sem permissão no Firestore. Publique as regras do arquivo firestore.rules.';
  return String((e as Error)?.message ?? e);
}

type Remote = { progress?: Progress; settings?: Partial<Settings>; updatedAt?: number };

function shareableSettings(s: Settings): Partial<Settings> {
  // a configuração do Firebase e preferências do aparelho ficam só localmente
  const { firebaseConfig: _f, latencyMs: _l, micSensitivity: _m, ...rest } = s;
  void _f;
  void _l;
  void _m;
  return rest;
}

async function onSignedIn(u: User) {
  syncState.set({
    status: 'syncing',
    user: { name: u.displayName ?? 'Usuário', email: u.email ?? '', photo: u.photoURL ?? undefined },
    message: undefined,
  });
  try {
    await pullAndMerge(u.uid);
    await push(u.uid);
    syncState.set({ status: 'signed-in', lastSync: Date.now() });
  } catch (e) {
    syncState.set({ status: 'error', message: friendlyError((e as { code?: string }).code ?? '', e) });
    return;
  }
  unsubLocal?.();
  unsubLocal = progress.subscribe(() => {
    if (applyingRemote) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = window.setTimeout(() => void push(u.uid).catch(() => undefined), 4000);
  });
  const onVis = () => {
    if (document.visibilityState === 'visible') void pullAndMerge(u.uid).catch(() => undefined);
  };
  document.addEventListener('visibilitychange', onVis);
  const prev = unsubLocal;
  unsubLocal = () => {
    prev();
    document.removeEventListener('visibilitychange', onVis);
  };
}

async function pullAndMerge(uid: string) {
  if (!db) return;
  const { doc, getDoc } = await import('firebase/firestore');
  const snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists()) return;
  const remote = snap.data() as Remote;
  applyingRemote = true;
  try {
    if (remote.progress) progress.replace(mergeProgress(progress.get(), { ...emptyProgress, ...remote.progress }));
    if (remote.settings && (remote.updatedAt ?? 0) > (progress.get().updatedAt ?? 0) - 1) {
      settings.set((s) => ({ ...s, ...remote.settings, firebaseConfig: s.firebaseConfig }));
    }
  } finally {
    applyingRemote = false;
  }
}

async function push(uid: string) {
  if (!db) return;
  const { doc, setDoc } = await import('firebase/firestore');
  // Firestore não aceita undefined
  const clean = JSON.parse(JSON.stringify({ progress: progress.get(), settings: shareableSettings(settings.get()), updatedAt: Date.now() }));
  await setDoc(doc(db, 'users', uid), clean);
  syncState.set({ lastSync: Date.now() });
}

export async function syncNow(): Promise<void> {
  const u = auth?.currentUser;
  if (!u) return;
  syncState.set({ status: 'syncing' });
  try {
    await pullAndMerge(u.uid);
    await push(u.uid);
    syncState.set({ status: 'signed-in', lastSync: Date.now(), message: undefined });
  } catch (e) {
    syncState.set({ status: 'error', message: friendlyError((e as { code?: string }).code ?? '', e) });
  }
}
