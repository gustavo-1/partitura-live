import { lazy, Suspense, useEffect } from 'react';
import { useRoute } from './lib/router';
import { useStore } from './lib/store';
import { settings } from './state/settings';
import { Icon, type IconName } from './components/Icon';
import { setComputerKeyboard } from './audio/input';
import { setPianoVolume } from './audio/piano';
import { setMetronomeVolume } from './audio/metronome';
import { mic } from './audio/mic';
import { Home } from './screens/Home';
import { PathScreen } from './screens/PathScreen';
import { Library } from './screens/Library';
import { PracticeHub } from './screens/PracticeHub';
import { ProfileScreen } from './screens/ProfileScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { startAccount } from './lib/account';
import { social } from './lib/social';
import { chats } from './lib/chat';
import { ChatToast } from './components/ChatToast';
import { Welcome } from './screens/Welcome';
import { CelebrationToast } from './components/Celebration';
import { startGamification } from './state/gamification';

const Player = lazy(() => import('./screens/Player'));
const LessonScreen = lazy(() => import('./screens/LessonScreen'));
const SongDetail = lazy(() => import('./screens/SongDetail'));
const NoteDrill = lazy(() => import('./screens/NoteDrill'));
const RhythmDrill = lazy(() => import('./screens/RhythmDrill'));
const DetectorScreen = lazy(() => import('./screens/DetectorScreen'));
const SightReading = lazy(() => import('./screens/SightReading'));
const FriendsScreen = lazy(() => import('./screens/FriendsScreen'));
const FriendProfile = lazy(() => import('./screens/FriendProfile'));
const ChatScreen = lazy(() => import('./screens/ChatScreen'));
const ReviewScreen = lazy(() => import('./screens/ReviewScreen'));
const EarTraining = lazy(() => import('./screens/EarTraining'));
const MethodScreen = lazy(() => import('./screens/MethodScreen'));

const NAV: { path: string; label: string; icon: IconName }[] = [
  { path: '/', label: 'Início', icon: 'home' },
  { path: '/trilha', label: 'Trilha', icon: 'path' },
  { path: '/musicas', label: 'Músicas', icon: 'music' },
  { path: '/treino', label: 'Treino', icon: 'target' },
  { path: '/amigos', label: 'Amigos', icon: 'users' },
];

export function App() {
  const route = useRoute();
  const s = useStore(settings);
  const soc = useStore(social);
  const ch = useStore(chats);
  const socialBadge = soc.incoming.length + soc.unread + ch.unreadTotal;

  useEffect(() => {
    const root = document.documentElement;
    if (s.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', s.theme);
  }, [s.theme]);

  useEffect(() => {
    setComputerKeyboard(s.computerKeyboard);
    setPianoVolume(s.pianoVolume);
    setMetronomeVolume(s.metronomeVolume);
    mic.setSensitivity(s.micSensitivity);
    mic.latency = s.latencyMs / 1000;
  }, [s.computerKeyboard, s.pianoVolume, s.metronomeVolume, s.micSensitivity, s.latencyMs]);

  useEffect(() => {
    void startAccount();
  }, [s.firebaseConfig]);

  useEffect(() => startGamification(social), []);

  const [first, second] = route.parts;
  let page: React.ReactNode;
  let full = false;
  // conversa: ocupa a tela toda no celular, mas mantém a barra lateral no computador
  let chatLayout = false;
  switch (first) {
    case undefined:
      page = <Home />;
      break;
    case 'trilha':
      page = <PathScreen />;
      break;
    case 'licao':
      page = <LessonScreen id={second} />;
      full = true;
      break;
    case 'musicas':
      page = <Library />;
      break;
    case 'musica':
      page = <SongDetail id={decodeURIComponent(second ?? '')} />;
      break;
    case 'tocar':
      page = <Player id={decodeURIComponent(second ?? '')} query={route.query} />;
      full = true;
      break;
    case 'treino':
      if (second === 'leitura') page = <NoteDrill query={route.query} />;
      else if (second === 'ritmo') page = <RhythmDrill />;
      else if (second === 'detector') page = <DetectorScreen />;
      else if (second === 'leitura-primeira-vista') page = <SightReading />;
      else if (second === 'ouvido') page = <EarTraining />;
      else if (second === 'revisao') {
        page = <ReviewScreen />;
        full = true;
      } else page = <PracticeHub />;
      break;
    case 'metodo':
      page = <MethodScreen />;
      break;
    case 'progresso':
    case 'perfil':
      page = <ProfileScreen />;
      break;
    case 'amigos':
      page = <FriendsScreen query={route.query} />;
      break;
    case 'amigo':
      page = <FriendProfile uid={second ?? ''} />;
      break;
    case 'chat':
      page = <ChatScreen key={second} uid={second ?? ''} />;
      chatLayout = true;
      break;
    case 'config':
      page = <SettingsScreen />;
      break;
    default:
      page = <Home />;
  }

  const activePath =
    '/' + (first === 'licao' ? 'trilha' : first === 'musica' ? 'musicas' : first === 'amigo' || first === 'chat' ? 'amigos' : first === 'progresso' ? 'perfil' : (first ?? ''));
  const navLinks = (
    <>
      {NAV.map((n) => (
        <a key={n.path} href={'#' + n.path} className={'nav-item' + (activePath === n.path ? ' active' : '')}>
          <Icon name={n.icon} />
          <span>{n.label}</span>
          {n.path === '/amigos' && socialBadge > 0 && <span className="nav-badge">{socialBadge}</span>}
        </a>
      ))}
    </>
  );

  return (
    <div className="app">
      {!full && (
        <nav className="sidebar" aria-label="Navegação">
          <a href="#/" className="brand">
            <span className="brand-logo">
              <Icon name="music" size={20} />
            </span>
            Partitura Live
          </a>
          {navLinks}
          <div className="spacer" />
          <a href="#/perfil" className={'nav-item' + (activePath === '/perfil' ? ' active' : '')}>
            <Icon name="user" />
            <span>Perfil e progresso</span>
          </a>
          <a href="#/config" className={'nav-item' + (first === 'config' ? ' active' : '')}>
            <Icon name="settings" />
            <span>Configurações</span>
          </a>
        </nav>
      )}
      <main className={'main' + (full ? ' full' : '') + (chatLayout ? ' chat-main' : '')}>
        <Suspense fallback={<div className="empty">Carregando…</div>}>{page}</Suspense>
      </main>
      {!s.onboarded && <Welcome />}
      <CelebrationToast />
      <ChatToast />
      {!full && !chatLayout && (
        <nav className="bottom-nav" aria-label="Navegação">
          {navLinks}
        </nav>
      )}
    </div>
  );
}
