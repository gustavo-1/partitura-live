import { useRef, useState } from 'react';
import { useStore } from '../lib/store';
import { defaultSettings, settings, type Settings } from '../state/settings';
import { emptyProgress, mergeProgress, progress, type Progress } from '../state/progress';
import { parseFirebaseConfig } from '../lib/firebase';
import { account } from '../lib/account';
import { Seg, Toggle } from '../components/ui';
import { Icon } from '../components/Icon';
import { initMidi, input } from '../audio/input';

export function SettingsScreen() {
  const s = useStore(settings);
  const acc = useStore(account);
  const [cfgDraft, setCfgDraft] = useState(s.firebaseConfig);
  const [midiMsg, setMidiMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (p: Partial<Settings>) => settings.set(p);

  const exportData = () => {
    const blob = new Blob([JSON.stringify({ app: 'partitura-live', version: 1, progress: progress.get(), settings: { ...settings.get(), firebaseConfig: '' } }, null, 2)], {
      type: 'application/json',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `partitura-live-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importData = async (f: File | undefined) => {
    if (!f) return;
    try {
      const data = JSON.parse(await f.text()) as { progress?: Progress; settings?: Partial<Settings> };
      if (data.progress) progress.replace(mergeProgress(progress.get(), { ...emptyProgress, ...data.progress }));
      if (data.settings) settings.set((cur) => ({ ...cur, ...data.settings, firebaseConfig: cur.firebaseConfig }));
      alert('Backup importado e mesclado com sucesso.');
    } catch (e) {
      alert('Arquivo inválido: ' + String(e));
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1>Configurações</h1>
      </div>

      <div className="card">
        <h3>Leitura</h3>
        <div className="field">
          <span className="label">Nomes das notas</span>
          <Seg
            value={s.naming}
            onChange={(v) => set({ naming: v })}
            options={[
              { value: 'solfege', label: 'Dó Ré Mi' },
              { value: 'letters', label: 'C D E' },
            ]}
          />
        </div>
        <Toggle
          label="Nomes das notas na partitura"
          hint="Ajuda no começo, mas tente desligar logo para treinar a leitura de verdade."
          checked={s.showNoteNames}
          onChange={(v) => set({ showNoteNames: v })}
        />
        <Toggle label="Destacar a tecla certa no teclado" checked={s.showKeyHints} onChange={(v) => set({ showKeyHints: v })} />
        <div className="field">
          <span className="label">Nomes no teclado</span>
          <Seg
            value={s.keyLabels}
            onChange={(v) => set({ keyLabels: v })}
            options={[
              { value: 'none', label: 'Nenhum' },
              { value: 'c', label: 'Só os Dós' },
              { value: 'all', label: 'Todos' },
            ]}
          />
        </div>
      </div>

      <div className="card">
        <h3>Seu teclado</h3>
        <div className="field">
          <span className="label">Número de teclas</span>
          <Seg<string>
            value={String(s.keyboardSize)}
            onChange={(v) => set({ keyboardSize: Number(v) as Settings['keyboardSize'] })}
            options={[
              { value: '49', label: '49' },
              { value: '61', label: '61' },
              { value: '76', label: '76' },
              { value: '88', label: '88' },
            ]}
          />
        </div>
        <div className="field">
          <span className="label">Sensibilidade do microfone: {Math.round(s.micSensitivity * 100)}%</span>
          <input type="range" min={0} max={1} step={0.05} value={s.micSensitivity} onChange={(e) => set({ micSensitivity: Number(e.target.value) })} />
          <span className="hint">
            Teste em <a href="#/treino/detector">Treino → Microfone e afinação</a>.
          </span>
        </div>
        <div className="field">
          <span className="label">Compensação de atraso do microfone: {s.latencyMs} ms</span>
          <input type="range" min={0} max={250} step={5} value={s.latencyMs} onChange={(e) => set({ latencyMs: Number(e.target.value) })} />
        </div>
        <div className="row">
          <button
            className="btn sm"
            onClick={async () => {
              const ok = await initMidi();
              setMidiMsg(ok ? `Conectado: ${input.midiNames.join(', ')}` : 'Nenhum teclado MIDI encontrado (ou o navegador não suporta Web MIDI).');
            }}
          >
            <Icon name="keys" /> Conectar teclado MIDI (USB)
          </button>
          {midiMsg && <span className="small muted">{midiMsg}</span>}
        </div>
        <Toggle
          label="Usar o teclado do computador como piano"
          hint="A W S E D F T G Y H U J K… (Z/X mudam a oitava)"
          checked={s.computerKeyboard}
          onChange={(v) => set({ computerKeyboard: v })}
        />
      </div>

      <div className="card">
        <h3>Som e aparência</h3>
        <div className="field">
          <span className="label">Volume do piano</span>
          <input type="range" min={0} max={1} step={0.05} value={s.pianoVolume} onChange={(e) => set({ pianoVolume: Number(e.target.value) })} />
        </div>
        <div className="field">
          <span className="label">Volume do metrônomo</span>
          <input type="range" min={0} max={1} step={0.05} value={s.metronomeVolume} onChange={(e) => set({ metronomeVolume: Number(e.target.value) })} />
        </div>
        <div className="field">
          <span className="label">Tema</span>
          <Seg
            value={s.theme}
            onChange={(v) => set({ theme: v })}
            options={[
              { value: 'system', label: 'Automático' },
              { value: 'light', label: 'Claro' },
              { value: 'dark', label: 'Escuro' },
            ]}
          />
        </div>
        <div className="field">
          <span className="label">Meta diária: {s.dailyGoalMin} minutos</span>
          <span className="tiny muted">Vale qualquer prática: lições, treinos, revisão e músicas. Cumprir a meta conta para as missões do dia.</span>
          <input type="range" min={5} max={60} step={5} value={s.dailyGoalMin} onChange={(e) => set({ dailyGoalMin: Number(e.target.value) })} />
        </div>
      </div>

      <div className="card">
        <h3>
          <Icon name="cloud" size={20} /> Conta e sincronização
        </h3>
        <p className="small muted">
          {acc.status === 'signed-in'
            ? `Conectado como ${acc.user?.email}. Seu progresso fica salvo na conta e aparece em todos os aparelhos.`
            : 'Sem login, seu progresso fica só neste aparelho. Entre para salvar na nuvem e praticar com amigos.'}
        </p>
        <a className="btn sm primary" href="#/perfil">
          {acc.status === 'signed-in' ? 'Ver conta' : 'Entrar / criar conta'}
        </a>
        <details style={{ marginTop: 12 }}>
          <summary className="small muted" style={{ cursor: 'pointer' }}>
            Avançado: usar outro projeto Firebase
          </summary>
          <p className="small muted">
            Este app já vem conectado ao projeto padrão. Para usar o seu próprio projeto, cole aqui o objeto firebaseConfig do app web (veja o README).
          </p>
          <textarea
            id="fbcfg"
            placeholder={'{\n  "apiKey": "...",\n  "authDomain": "seu-projeto.firebaseapp.com",\n  "projectId": "seu-projeto",\n  "appId": "..."\n}'}
            value={cfgDraft}
            onChange={(e) => setCfgDraft(e.target.value)}
          />
          <div className="row" style={{ marginTop: 6 }}>
            <button
              className="btn sm"
              onClick={() => {
                if (cfgDraft.trim() && !parseFirebaseConfig(cfgDraft)) {
                  alert('Não consegui ler essa configuração. Cole o objeto firebaseConfig do console do Firebase.');
                  return;
                }
                set({ firebaseConfig: cfgDraft });
              }}
            >
              Salvar
            </button>
            {s.firebaseConfig && (
              <button
                className="btn sm ghost danger"
                onClick={() => {
                  setCfgDraft('');
                  set({ firebaseConfig: '' });
                }}
              >
                Voltar ao projeto padrão
              </button>
            )}
          </div>
        </details>
      </div>

      <div className="card">
        <h3>Dados</h3>
        <div className="row">
          <button className="btn sm" onClick={exportData}>
            Exportar backup
          </button>
          <button className="btn sm" onClick={() => fileRef.current?.click()}>
            Importar backup
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => void importData(e.target.files?.[0])} />
          <button
            className="btn sm ghost danger"
            onClick={() => {
              if (!confirm('Apagar todo o progresso deste aparelho? (As músicas importadas continuam.)')) return;
              progress.replace({ ...emptyProgress, updatedAt: Date.now() });
            }}
          >
            Apagar progresso
          </button>
          <button
            className="btn sm ghost"
            onClick={() => {
              if (confirm('Restaurar as configurações padrão?')) settings.replace({ ...defaultSettings, firebaseConfig: s.firebaseConfig, onboarded: true });
            }}
          >
            Restaurar padrões
          </button>
        </div>
      </div>

      <div className="card flat">
        <h3>Sobre</h3>
        <p className="small muted" style={{ marginBottom: 4 }}>
          Partitura Live — app livre e gratuito para aprender a ler partituras e tocar teclado.{' '}
          <a href="#/metodo">Como o app ensina (e as pesquisas por trás)</a>.
        </p>
        <p className="tiny muted" style={{ margin: 0 }}>
          Partituras desenhadas com VexFlow (MIT). Som de piano: FluidR3_GM por Frank Wen, via midi-js-soundfonts (CC BY 3.0). Músicas
          embutidas são de domínio público.
        </p>
      </div>
    </div>
  );
}
