import { useStore } from '../lib/store';
import { social } from '../lib/social';
import { Avatar } from './Avatar';
import { Sheet } from './ui';

/** Folha para escolher um amigo (desafiar, enviar música…). */
export function FriendPicker({ open, title, onClose, onPick }: { open: boolean; title: string; onClose: () => void; onPick: (uid: string) => void }) {
  const soc = useStore(social);
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {soc.friendIds.length === 0 ? (
        <p className="muted">
          Você ainda não tem amigos no app. <a href="#/amigos">Adicione pelo código de amigo.</a>
        </p>
      ) : (
        <div>
          {soc.friendIds.map((uid) => {
            const f = soc.friends[uid];
            return (
              <button
                key={uid}
                className="person-row btn ghost"
                style={{ width: '100%', justifyContent: 'flex-start', borderRadius: 0 }}
                onClick={() => onPick(uid)}
              >
                <Avatar name={f?.name ?? '…'} photo={f?.photo} avatar={f?.avatar} seed={uid} size={36} />
                <span className="who" style={{ textAlign: 'left' }}>
                  <b>{f?.name ?? 'Carregando…'}</b>
                  <span className="small muted">{f ? `${f.xp} XP · ${f.lessonsDone} lições` : ''}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </Sheet>
  );
}
