import { useStore } from '../lib/store';
import { settings, type Settings } from '../state/settings';
import { Seg, Sheet } from '../components/ui';
import { Icon } from '../components/Icon';
import { mic } from '../audio/mic';
import { SignInBox } from '../components/AccountCard';
import { account } from '../lib/account';

/** Boas-vindas na primeira abertura: preferências básicas e microfone. */
export function Welcome() {
  const s = useStore(settings);
  const acc = useStore(account);
  const close = () => settings.set({ onboarded: true });
  return (
    <Sheet open onClose={close}>
      <div className="center" style={{ marginBottom: 8 }}>
        <span className="brand-logo" style={{ width: 54, height: 54, margin: '0 auto', borderRadius: 16 }}>
          <Icon name="music" size={30} />
        </span>
      </div>
      <h2 className="center">Bem-vindo(a) ao Partitura Live</h2>
      <p className="muted center small">Aprenda a ler partituras e tocar teclado, com o app ouvindo você tocar.</p>
      <div className="welcome-step">
        <span className="num">1</span>
        <div style={{ flex: 1 }}>
          <b>Como você prefere os nomes das notas?</b>
          <div style={{ marginTop: 6 }}>
            <Seg
              value={s.naming}
              onChange={(v) => settings.set({ naming: v })}
              options={[
                { value: 'solfege', label: 'Dó Ré Mi' },
                { value: 'letters', label: 'C D E' },
              ]}
            />
          </div>
        </div>
      </div>
      <div className="welcome-step">
        <span className="num">2</span>
        <div style={{ flex: 1 }}>
          <b>Quantas teclas tem o seu teclado?</b>
          <div style={{ marginTop: 6 }}>
            <Seg<string>
              value={String(s.keyboardSize)}
              onChange={(v) => settings.set({ keyboardSize: Number(v) as Settings['keyboardSize'] })}
              options={[
                { value: '49', label: '49' },
                { value: '61', label: '61' },
                { value: '76', label: '76' },
                { value: '88', label: '88' },
              ]}
            />
          </div>
        </div>
      </div>
      <div className="welcome-step">
        <span className="num">3</span>
        <div style={{ flex: 1 }}>
          <b>Quanto tempo por dia você quer praticar?</b>
          <div style={{ marginTop: 6 }}>
            <Seg<string>
              value={String(s.dailyGoalMin)}
              onChange={(v) => settings.set({ dailyGoalMin: Number(v) })}
              options={[
                { value: '5', label: '5 min' },
                { value: '10', label: '10 min' },
                { value: '15', label: '15 min' },
                { value: '30', label: '30 min' },
              ]}
            />
          </div>
          <p className="tiny muted" style={{ margin: '4px 0 0' }}>
            Pouco todo dia rende mais do que muito de vez em quando. Dá para mudar depois nas configurações.
          </p>
        </div>
      </div>
      <div className="welcome-step">
        <span className="num">4</span>
        <div style={{ flex: 1 }}>
          <b>Deixe o app ouvir seu teclado</b>
          <p className="small muted" style={{ margin: '4px 0 6px' }}>
            Coloque o aparelho perto do teclado, num lugar silencioso, e permita o microfone. Nada é gravado nem enviado: o som é analisado só no
            seu aparelho.
          </p>
          <button className="btn sm" onClick={() => void mic.start()}>
            <Icon name="mic" /> Permitir microfone
          </button>
        </div>
      </div>
      {acc.status !== 'disabled' && (
        <div className="welcome-step">
          <span className="num">5</span>
          <div style={{ flex: 1 }}>
            <b>Salvar na nuvem (opcional)</b>
            <p className="small muted" style={{ margin: '4px 0 6px' }}>
              {acc.status === 'signed-in'
                ? `Pronto! Conectado como ${acc.user?.name}. Seu progresso fica salvo na conta.`
                : 'Sem conta, o progresso fica só neste aparelho. Com conta, ele vai para a nuvem, aparece em qualquer aparelho e você pode praticar com amigos.'}
            </p>
            {acc.status !== 'signed-in' && <SignInBox compact />}
          </div>
        </div>
      )}
      <button className="btn primary lg block" style={{ marginTop: 10 }} onClick={close}>
        Começar
      </button>
    </Sheet>
  );
}
