import { useState } from 'react';
import { useStore } from '../lib/store';
import { account, deleteAccount, resetPassword, signInEmail, signInGoogle, signOutAccount, signUpEmail, syncNow, updateDisplayName } from '../lib/account';
import { social, inviteLink, publishProfileSoon } from '../lib/social';
import { settings } from '../state/settings';
import { Avatar, AVATARS } from './Avatar';
import { Icon } from './Icon';

/** Explica, sem jargão, onde ficam os dados do usuário. */
export function StorageInfo({ signedIn }: { signedIn: boolean }) {
  return (
    <div className="storage-info">
      <div className={signedIn ? '' : 'on'}>
        <b>📱 {signedIn ? 'Cópia neste aparelho' : 'Agora: só neste aparelho'}</b>
        <div className="muted" style={{ marginTop: 4 }}>
          {signedIn
            ? 'O aparelho guarda uma cópia para o app funcionar sem internet. Ao sair da conta, ela é apagada daqui.'
            : 'Progresso, músicas importadas e preferências ficam guardados no navegador deste aparelho. Se você limpar os dados do navegador ou trocar de aparelho, eles se perdem.'}
        </div>
      </div>
      <div className={signedIn ? 'on' : ''}>
        <b>☁️ {signedIn ? 'Agora: salvo na sua conta' : 'Com login: na sua conta'}</b>
        <div className="muted" style={{ marginTop: 4 }}>
          {signedIn
            ? 'Lições, estrelas, músicas, estatísticas de leitura, preferências e músicas importadas ficam na sua conta e aparecem em qualquer aparelho em que você entrar.'
            : 'Entrando, tudo vai para a sua conta (Firebase/Google) e aparece em qualquer aparelho. O que você já fez aqui é somado à conta. Também libera amigos, ranking e desafios.'}
        </div>
      </div>
      <div>
        <b>👥 Visível para amigos</b>
        <div className="muted" style={{ marginTop: 4 }}>
          Só um resumo: nome, avatar, XP, sequência, lições concluídas, medalhas e recordes nas músicas. Seu e-mail e o progresso detalhado nunca são
          compartilhados.
        </div>
      </div>
    </div>
  );
}

export function SignInBox({ compact }: { compact?: boolean }) {
  const acc = useStore(account);
  const [mode, setMode] = useState<'choose' | 'login' | 'signup' | 'reset'>('choose');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);

  if (acc.status === 'disabled')
    return <p className="small muted">O login não está configurado nesta instalação. Seus dados ficam salvos neste aparelho.</p>;
  if (acc.status === 'loading') return <p className="small muted">Conectando…</p>;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setInfo(null);
    account.set({ message: undefined });
    try {
      await fn();
    } catch {
      /* mensagem já exibida */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack" style={{ gap: 10 }}>
      {mode === 'choose' && (
        <div className={compact ? 'row' : 'stack'} style={{ gap: 8 }}>
          <button className="btn primary" disabled={busy} onClick={() => void run(signInGoogle)}>
            <GoogleG /> Entrar com Google
          </button>
          <button className="btn" disabled={busy} onClick={() => setMode('login')}>
            Entrar com e-mail
          </button>
        </div>
      )}
      {(mode === 'login' || mode === 'signup') && (
        <form
          className="stack"
          style={{ gap: 8 }}
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => (mode === 'login' ? signInEmail(email, pass) : signUpEmail(name, email, pass)));
          }}
        >
          {mode === 'signup' && <input placeholder="Seu nome" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required maxLength={40} />}
          <input type="email" placeholder="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          <input
            type="password"
            placeholder="Senha (mín. 6 caracteres)"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
            minLength={6}
          />
          <button className="btn primary" disabled={busy}>
            {mode === 'login' ? 'Entrar' : 'Criar conta'}
          </button>
          <div className="row small" style={{ justifyContent: 'space-between' }}>
            <a href="#" onClick={(e) => (e.preventDefault(), setMode(mode === 'login' ? 'signup' : 'login'))}>
              {mode === 'login' ? 'Não tenho conta — criar' : 'Já tenho conta — entrar'}
            </a>
            {mode === 'login' && (
              <a href="#" onClick={(e) => (e.preventDefault(), setMode('reset'))}>
                Esqueci a senha
              </a>
            )}
            <a href="#" onClick={(e) => (e.preventDefault(), setMode('choose'))}>
              Voltar
            </a>
          </div>
        </form>
      )}
      {mode === 'reset' && (
        <form
          className="stack"
          style={{ gap: 8 }}
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await resetPassword(email);
              setInfo('Enviamos um e-mail com o link para criar uma nova senha.');
            });
          }}
        >
          <input type="email" placeholder="E-mail da conta" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <button className="btn primary" disabled={busy}>
            Enviar link
          </button>
          <a href="#" className="small" onClick={(e) => (e.preventDefault(), setMode('login'))}>
            Voltar
          </a>
        </form>
      )}
      {info && <p className="small" style={{ color: 'var(--ok)', margin: 0 }}>{info}</p>}
      {acc.message && <p className="small" style={{ color: 'var(--bad)', margin: 0 }}>{acc.message}</p>}
    </div>
  );
}

export function AccountCard() {
  const acc = useStore(account);
  const soc = useStore(social);
  const st = useStore(settings);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [picking, setPicking] = useState(false);
  const [copied, setCopied] = useState(false);
  const signedIn = acc.status === 'signed-in' && !!acc.user;
  const u = acc.user;
  const code = soc.me?.code;

  const share = async () => {
    if (!code) return;
    const link = inviteLink(code);
    const text = `Vamos aprender teclado juntos no Partitura Live! Meu código de amigo: ${code}`;
    try {
      if (navigator.share) await navigator.share({ title: 'Partitura Live', text, url: link });
      else {
        await navigator.clipboard.writeText(`${text}\n${link}`);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      /* cancelado */
    }
  };

  return (
    <div className="card">
      {signedIn && u ? (
        <>
          <div className="row nowrap" style={{ alignItems: 'center' }}>
            <button className="btn ghost" style={{ padding: 0, minHeight: 0 }} onClick={() => setPicking((x) => !x)} title="Trocar avatar">
              <Avatar name={u.name} photo={u.photo} avatar={st.avatar} seed={u.uid} size={56} />
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              {editing ? (
                <form
                  className="row nowrap"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void updateDisplayName(name).then(() => setEditing(false));
                  }}
                >
                  <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoFocus style={{ flex: 1, minWidth: 0 }} />
                  <button className="btn sm primary">OK</button>
                </form>
              ) : (
                <h2 style={{ margin: 0 }}>
                  {u.name}{' '}
                  <button
                    className="btn ghost sm icon"
                    aria-label="Editar nome"
                    onClick={() => {
                      setName(u.name);
                      setEditing(true);
                    }}
                  >
                    ✏️
                  </button>
                </h2>
              )}
              <div className="small muted">{u.email}</div>
            </div>
          </div>
          {picking && (
            <div style={{ marginTop: 10 }}>
              <div className="small muted" style={{ marginBottom: 6 }}>
                Escolha um avatar (aparece para seus amigos):
              </div>
              <div className="avatar-picker">
                <button className={!st.avatar ? 'on' : ''} onClick={() => (settings.set({ avatar: '' }), publishProfileSoon(true))} title="Foto/iniciais">
                  {u.photo ? <img src={u.photo} alt="" style={{ width: 28, height: 28, borderRadius: '50%' }} referrerPolicy="no-referrer" /> : 'Aa'}
                </button>
                {AVATARS.map((a) => (
                  <button key={a} className={st.avatar === a ? 'on' : ''} onClick={() => (settings.set({ avatar: a }), publishProfileSoon(true))}>
                    {a}
                  </button>
                ))}
              </div>
            </div>
          )}
          {acc.mergedGuest && (
            <div className="banner small" style={{ marginTop: 12 }}>
              <Icon name="check" size={18} />
              <div>O progresso que você já tinha feito neste aparelho foi somado à sua conta.</div>
            </div>
          )}
          {code && (
            <div className="row" style={{ marginTop: 14 }}>
              <span className="small muted">Seu código de amigo:</span>
              <span className="code-box">{code}</span>
              <button className="btn sm" onClick={() => void share()}>
                <Icon name="upload" /> {copied ? 'Copiado!' : 'Convidar'}
              </button>
            </div>
          )}
          <StorageInfo signedIn />
          <div className="row" style={{ marginTop: 12 }}>
            <span className={'chip ' + (acc.sync === 'synced' ? 'ok' : acc.sync === 'error' ? 'bad' : '')}>
              {acc.sync === 'syncing'
                ? 'Sincronizando…'
                : acc.sync === 'synced'
                  ? `☁️ Salvo na conta${acc.lastSync ? ' às ' + new Date(acc.lastSync).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''}`
                  : acc.sync === 'offline'
                    ? 'Sem internet — salvando no aparelho'
                    : acc.sync === 'error'
                      ? 'Erro ao sincronizar'
                      : '—'}
            </span>
            <button className="btn sm ghost" onClick={() => void syncNow()}>
              Sincronizar agora
            </button>
            <div className="spacer" />
            <button
              className="btn sm"
              onClick={() => {
                if (confirm('Sair da conta? Seu progresso continua salvo na nuvem e será removido deste aparelho.')) void signOutAccount();
              }}
            >
              Sair
            </button>
          </div>
          {acc.message && <p className="small" style={{ color: 'var(--bad)' }}>{acc.message}</p>}
          <details style={{ marginTop: 10 }}>
            <summary className="small muted" style={{ cursor: 'pointer' }}>
              Excluir conta
            </summary>
            <p className="small muted">Apaga da nuvem todo o seu progresso, músicas, amizades e mensagens, e remove o login. Não dá para desfazer.</p>
            <button
              className="btn sm danger"
              onClick={() => {
                if (confirm('Excluir a conta e TODOS os dados da nuvem? Isso não pode ser desfeito.')) void deleteAccount().catch((e) => alert(String(e)));
              }}
            >
              Excluir minha conta
            </button>
          </details>
        </>
      ) : (
        <>
          <h2 style={{ marginTop: 0 }}>Sua conta</h2>
          <p className="muted small">
            Entre para guardar seu progresso na nuvem, continuar em qualquer aparelho e praticar com amigos (ranking, desafios e aplausos).
          </p>
          <SignInBox />
          <StorageInfo signedIn={false} />
        </>
      )}
    </div>
  );
}

function GoogleG() {
  return (
    <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
