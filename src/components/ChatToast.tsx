import { useEffect, useState } from 'react';
import { chats, onIncomingMessage } from '../lib/chat';
import { social } from '../lib/social';
import { navigate } from '../lib/router';
import { useStore } from '../lib/store';
import { Avatar } from './Avatar';

interface Item {
  key: number;
  other: string;
  name: string;
  photo?: string;
  avatar?: string;
  text: string;
}

/**
 * Avisos de mensagem nova: um cartão no topo (app aberto), uma notificação do sistema
 * (app em segundo plano, se a pessoa permitiu) e o total de não lidas no título da aba.
 */
export function ChatToast() {
  const [items, setItems] = useState<Item[]>([]);
  const ch = useStore(chats);
  const soc = useStore(social);

  useEffect(
    () =>
      onIncomingMessage((other, last) => {
        const visible = document.visibilityState === 'visible';
        if (visible && chats.get().open === other) return;
        const f = social.get().friends[other];
        const name = f?.name ?? 'Amigo';
        if (!visible && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          try {
            const n = new Notification(name, { body: last.text, tag: 'chat-' + other, icon: 'icons/icon-192.png' });
            n.onclick = () => {
              window.focus();
              navigate('/chat/' + other);
              n.close();
            };
          } catch {
            /* alguns navegadores só notificam pelo service worker */
          }
        }
        const item: Item = { key: Date.now() + Math.random(), other, name, photo: f?.photo, avatar: f?.avatar, text: last.text };
        setItems((xs) => [...xs.filter((x) => x.other !== other), item].slice(-3));
        setTimeout(() => setItems((xs) => xs.filter((x) => x.key !== item.key)), 5500);
      }),
    [],
  );

  const total = ch.unreadTotal + soc.unread + soc.incoming.length;
  useEffect(() => {
    document.title = total ? `(${total}) Partitura Live` : 'Partitura Live';
  }, [total]);

  if (!items.length) return null;
  return (
    <div className="chat-toasts" role="status" aria-live="polite">
      {items.map((it) => (
        <button
          key={it.key}
          className="chat-toast"
          onClick={() => {
            setItems((xs) => xs.filter((x) => x.key !== it.key));
            navigate('/chat/' + it.other);
          }}
        >
          <Avatar name={it.name} photo={it.photo} avatar={it.avatar} seed={it.other} size={36} />
          <span className="who">
            <b>{it.name}</b>
            <span className="small">{it.text}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
