/**
 * Conta do usuário (Firebase Authentication) e armazenamento dos dados.
 *
 * Onde os dados ficam:
 *  - Sem login: só neste aparelho (localStorage + IndexedDB do navegador).
 *  - Com login: na sua conta (Firestore, documento users/{uid}); o aparelho guarda uma
 *    cópia para funcionar offline e sincroniza sozinho quando há internet.
 *    O progresso feito antes do login é somado à conta no primeiro login.
 *  - Ao sair da conta, os dados são removidos deste aparelho (continuam na nuvem).
 */
import type { User, Unsubscribe } from 'firebase/auth';
import { createStore } from './store';
import { getFirebase, activeConfig, type FB } from './firebase';
import { emptyProgress, mergeProgress, progress, checkBadges, type Progress } from '../state/progress';
import { settings, type Settings } from '../state/settings';
import { startSocial, stopSocial, publishProfileSoon, setSocialIdentity } from './social';
import { startCloudSongs, stopCloudSongs, clearLocalSongs } from './cloudSongs';
import { expectRemote } from '../data/library';

export interface AccountUser {
  uid: string;
  name: string;
  email: string;
  photo?: string;
  provider: string;
}

export interface AccountState {
  status: 'disabled' | 'loading' | 'signed-out' | 'signed-in';
  user?: AccountUser;
  sync: 'idle' | 'syncing' | 'synced' | 'offline' | 'error';
  lastSync?: number;
  message?: string;
  /** o progresso deste aparelho foi somado à conta no login */
  mergedGuest?: boolean;
}

export const account = createStore<AccountState>(null, { status: activeConfig() ? 'loading' : 'disabled', sync: 'idle' });

let fb: FB | null = null;
let authUnsub: Unsubscribe | null = null;
let stopFns: (() => void)[] = [];
let pushTimer: number | null = null;
let applyingRemote = false;
let startedKey = '';

export function currentFB(): FB | null {
  return fb;
}

export function currentUid(): string | null {
  return account.get().user?.uid ?? null;
}

const OWNER_KEY = 'pl.owner';
function owner(): string {
  try {
    return localStorage.getItem(OWNER_KEY) ?? 'guest';
  } catch {
    return 'guest';
  }
}
function setOwner(v: string) {
  try {
    localStorage.setItem(OWNER_KEY, v);
  } catch {
    /* ignora */
  }
}

/** Inicia o Firebase e acompanha o estado de login. Pode ser chamado várias vezes. */
export async function startAccount(): Promise<void> {
  const cfg = activeConfig();
  const key = cfg ? JSON.stringify(cfg) : '';
  if (key === startedKey) return;
  startedKey = key;
  authUnsub?.();
  await teardown();
  if (!cfg) {
    fb = null;
    account.replace({ status: 'disabled', sync: 'idle' });
    expectRemote(false);
    return;
  }
  account.set({ status: 'loading' });
  expectRemote(true);
  fb = await getFirebase();
  if (!fb) {
    account.replace({ status: 'disabled', sync: 'error', message: 'Não foi possível iniciar o Firebase.' });
    expectRemote(false);
    return;
  }
  const { authMod, auth } = fb;
  // conclui um login por redirecionamento, se houver
  authMod.getRedirectResult(auth).catch((e) => account.set({ message: friendlyError(e) }));
  authUnsub = authMod.onAuthStateChanged(auth, (u) => {
    if (u) void onSignedIn(u);
    else {
      void teardown();
      account.set({ status: 'signed-out', user: undefined, sync: 'idle', mergedGuest: false });
      expectRemote(false);
    }
  });
}

function userInfo(u: User): AccountUser {
  return {
    uid: u.uid,
    name: u.displayName || (u.email ? u.email.split('@')[0] : 'Pianista'),
    email: u.email ?? '',
    photo: u.photoURL ?? undefined,
    provider: u.providerData[0]?.providerId ?? 'password',
  };
}

async function teardown() {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = null;
  stopFns.forEach((f) => f());
  stopFns = [];
  stopSocial();
  stopCloudSongs();
}

interface RemoteDoc {
  progress?: Progress;
  settings?: Partial<Settings>;
  updatedAt?: number;
}

/** Campos das configurações que viajam com a conta (os do aparelho ficam locais). */
function shareableSettings(s: Settings): Partial<Settings> {
  const { firebaseConfig: _f, latencyMs: _l, micSensitivity: _m, keyboardSize: _k, computerKeyboard: _c, onboarded: _o, ...rest } = s;
  void [_f, _l, _m, _k, _c, _o];
  return rest;
}

/** JSON com chaves ordenadas (para comparar conteúdo). */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(stableJson).join(',') + ']';
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return (
      '{' +
      Object.keys(o)
        .filter((k) => o[k] !== undefined)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + stableJson(o[k]))
        .join(',') +
      '}'
    );
  }
  return JSON.stringify(v ?? null);
}

function hasContent(p: Progress): boolean {
  return p.xp > 0 || Object.keys(p.lessons).length > 0 || Object.keys(p.songs).length > 0 || Object.keys(p.noteStats).length > 0;
}

async function onSignedIn(u: User) {
  if (!fb) return;
  await teardown();
  const info = userInfo(u);
  account.set({ status: 'signed-in', user: info, sync: 'syncing', message: undefined });
  const { fs, db } = fb;
  const ref = fs.doc(db, 'users', u.uid);
  try {
    let remote: RemoteDoc | undefined;
    try {
      const snap = await fs.getDoc(ref);
      remote = snap.exists() ? (snap.data() as RemoteDoc) : undefined;
    } catch {
      remote = undefined; // offline: segue com o cache local
    }
    const local = progress.get();
    const prevOwner = owner();
    let merged: Progress;
    let mergedGuest = false;
    if (prevOwner === u.uid || prevOwner === 'guest') {
      merged = remote?.progress ? mergeProgress(local, { ...emptyProgress, ...remote.progress }) : local;
      mergedGuest = prevOwner === 'guest' && hasContent(local) && !!remote?.progress;
    } else {
      // dados de outra conta neste aparelho: não misturar
      merged = remote?.progress ? { ...emptyProgress, ...remote.progress } : { ...emptyProgress };
    }
    applyingRemote = true;
    progress.replace(merged);
    if (remote?.settings) settings.set((s) => ({ ...s, ...remote!.settings }));
    applyingRemote = false;
    setOwner(u.uid);
    await push(u.uid);
    account.set({ sync: 'synced', lastSync: Date.now(), mergedGuest });
  } catch (e) {
    applyingRemote = false;
    account.set({ sync: 'error', message: friendlyError(e) });
  }

  // mudanças vindas de outros aparelhos
  stopFns.push(
    fs.onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists() || snap.metadata.hasPendingWrites) return;
        const remote = snap.data() as RemoteDoc;
        if (!remote.progress) return;
        const local = progress.get();
        const merged = mergeProgress(local, { ...emptyProgress, ...remote.progress });
        if (stableJson(merged) !== stableJson(local)) {
          applyingRemote = true;
          progress.replace(merged);
          applyingRemote = false;
        }
        if (stableJson(merged) !== stableJson({ ...emptyProgress, ...remote.progress })) schedulePush();
        account.set({ sync: 'synced', lastSync: Date.now() });
      },
      () => account.set({ sync: 'offline' }),
    ),
  );
  // mudanças locais -> nuvem
  stopFns.push(
    progress.subscribe(() => {
      if (!applyingRemote) schedulePush();
      publishProfileSoon();
    }),
  );
  stopFns.push(settings.subscribe(() => schedulePush()));
  const flush = () => {
    if (document.visibilityState === 'hidden') void flushPush();
  };
  document.addEventListener('visibilitychange', flush);
  stopFns.push(() => document.removeEventListener('visibilitychange', flush));

  checkBadges();
  // o nome pode ter sido definido logo após criar a conta (cadastro por e-mail)
  const fresh = fb.auth.currentUser ? userInfo(fb.auth.currentUser) : info;
  if (fresh.name !== info.name) account.set({ user: fresh });
  startSocial(fb, fresh);
  startCloudSongs(fb, u.uid);
}

function schedulePush() {
  const uid = currentUid();
  if (!uid) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => {
    pushTimer = null;
    void push(uid).catch(() => account.set({ sync: 'offline' }));
  }, 6000);
}

async function flushPush() {
  const uid = currentUid();
  if (!uid || !pushTimer) return;
  clearTimeout(pushTimer);
  pushTimer = null;
  await push(uid).catch(() => undefined);
}

async function push(uid: string) {
  if (!fb) return;
  const { fs, db } = fb;
  account.set({ sync: 'syncing' });
  const body = JSON.parse(JSON.stringify({ progress: progress.get(), settings: shareableSettings(settings.get()), updatedAt: Date.now() }));
  await fs.setDoc(fs.doc(db, 'users', uid), body);
  account.set({ sync: 'synced', lastSync: Date.now() });
}

export async function syncNow(): Promise<void> {
  const uid = currentUid();
  if (!uid || !fb) return;
  try {
    const snap = await fb.fs.getDocFromServer(fb.fs.doc(fb.db, 'users', uid));
    if (snap.exists()) {
      const r = snap.data() as RemoteDoc;
      if (r.progress) {
        applyingRemote = true;
        progress.replace(mergeProgress(progress.get(), { ...emptyProgress, ...r.progress }));
        applyingRemote = false;
      }
    }
    await push(uid);
  } catch (e) {
    account.set({ sync: 'error', message: friendlyError(e) });
  }
}

// ---------- login / logout ----------

export async function signInGoogle(): Promise<void> {
  const f = fb ?? (await getFirebase());
  if (!f) throw new Error('Firebase não configurado.');
  const provider = new f.authMod.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await f.authMod.signInWithPopup(f.auth, provider);
  } catch (e) {
    const code = (e as { code?: string }).code ?? '';
    if (code.includes('popup-blocked') || code.includes('operation-not-supported-in-this-environment')) {
      await f.authMod.signInWithRedirect(f.auth, provider);
      return;
    }
    if (code.includes('popup-closed-by-user') || code.includes('cancelled-popup-request')) return;
    account.set({ message: friendlyError(e) });
    throw e;
  }
}

export async function signInEmail(email: string, password: string): Promise<void> {
  const f = fb ?? (await getFirebase());
  if (!f) throw new Error('Firebase não configurado.');
  try {
    await f.authMod.signInWithEmailAndPassword(f.auth, email.trim(), password);
  } catch (e) {
    account.set({ message: friendlyError(e) });
    throw e;
  }
}

export async function signUpEmail(name: string, email: string, password: string): Promise<void> {
  const f = fb ?? (await getFirebase());
  if (!f) throw new Error('Firebase não configurado.');
  try {
    const cred = await f.authMod.createUserWithEmailAndPassword(f.auth, email.trim(), password);
    if (name.trim()) {
      await f.authMod.updateProfile(cred.user, { displayName: name.trim().slice(0, 40) });
      const info = userInfo(cred.user);
      account.set({ user: info });
      setSocialIdentity(info.name, info.photo);
    }
  } catch (e) {
    account.set({ message: friendlyError(e) });
    throw e;
  }
}

export async function resetPassword(email: string): Promise<void> {
  const f = fb ?? (await getFirebase());
  if (!f) throw new Error('Firebase não configurado.');
  try {
    await f.authMod.sendPasswordResetEmail(f.auth, email.trim());
  } catch (e) {
    account.set({ message: friendlyError(e) });
    throw e;
  }
}

export async function updateDisplayName(name: string): Promise<void> {
  if (!fb?.auth.currentUser) return;
  const n = name.trim().slice(0, 40);
  if (!n) return;
  await fb.authMod.updateProfile(fb.auth.currentUser, { displayName: n });
  const info = userInfo(fb.auth.currentUser);
  account.set({ user: info });
  setSocialIdentity(info.name, info.photo);
}

/** Sai da conta: envia o que falta, apaga os dados deste aparelho (ficam na nuvem). */
export async function signOutAccount(): Promise<void> {
  if (!fb) return;
  await flushPush();
  await teardown();
  await fb.authMod.signOut(fb.auth);
  applyingRemote = true;
  progress.replace({ ...emptyProgress });
  applyingRemote = false;
  await clearLocalSongs();
  setOwner('guest');
}

/** Apaga os dados da nuvem e a conta. */
export async function deleteAccount(): Promise<void> {
  const f = fb;
  const u = f?.auth.currentUser;
  if (!f || !u) return;
  const { deleteSocialData } = await import('./social');
  const { deleteCloudSongs } = await import('./cloudSongs');
  await teardown();
  await deleteSocialData(f, u.uid);
  await deleteCloudSongs(f, u.uid);
  await f.fs.deleteDoc(f.fs.doc(f.db, 'users', u.uid));
  try {
    await f.authMod.deleteUser(u);
  } catch (e) {
    const code = (e as { code?: string }).code ?? '';
    if (code.includes('requires-recent-login')) {
      await f.authMod.signOut(f.auth);
      account.set({ message: 'Seus dados foram apagados. Para excluir também o login, entre de novo e repita a exclusão.' });
    } else throw e;
  }
  progress.replace({ ...emptyProgress });
  await clearLocalSongs();
  setOwner('guest');
}

export function friendlyError(e: unknown): string {
  const code = (e as { code?: string })?.code ?? '';
  const proj = activeConfig()?.projectId ?? '';
  const console = proj ? `https://console.firebase.google.com/project/${proj}/authentication/providers` : 'o console do Firebase';
  if (code.includes('operation-not-allowed') || code.includes('configuration-not-found'))
    return `Este tipo de login ainda não está ativado no Firebase. Ative-o em ${console}.`;
  if (code.includes('unauthorized-domain')) return 'Este endereço não está autorizado no Firebase (Authentication → Settings → Authorized domains).';
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found') || code.includes('invalid-login'))
    return 'E-mail ou senha incorretos.';
  if (code.includes('email-already-in-use')) return 'Já existe uma conta com este e-mail. Use "Entrar".';
  if (code.includes('weak-password')) return 'A senha precisa ter pelo menos 6 caracteres.';
  if (code.includes('invalid-email')) return 'E-mail inválido.';
  if (code.includes('too-many-requests')) return 'Muitas tentativas. Espere alguns minutos e tente de novo.';
  if (code.includes('network-request-failed') || code.includes('unavailable')) return 'Sem conexão com a internet. Seus dados continuam salvos e serão enviados depois.';
  if (code.includes('permission-denied')) return 'Sem permissão no banco de dados (verifique as regras do Firestore).';
  if (code.includes('popup-blocked')) return 'O navegador bloqueou a janela de login. Permita pop-ups para este site.';
  return String((e as Error)?.message ?? e);
}
