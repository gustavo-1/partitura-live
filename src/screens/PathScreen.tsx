import { allLessons, CURRICULUM } from '../data/curriculum';
import { useStore } from '../lib/store';
import { progress, type Progress } from '../state/progress';
import { navigate } from '../lib/router';
import { Icon, Stars, type IconName } from '../components/Icon';
import { ProgressBar } from '../components/ui';
import type { Activity } from '../data/curriculum';

function lessonIcon(acts: Activity[]): IconName {
  const types = new Set(acts.map((a) => a.type));
  if (types.has('rhythm')) return 'metronome';
  if (types.has('read')) return 'eye';
  if (types.has('find')) return 'keys';
  if (types.has('sight')) return 'sparkle';
  if (types.has('play')) return 'music';
  return 'book';
}

export function nextLessonId(p: Progress): string | null {
  const all = allLessons();
  const n = all.find((x) => !(p.lessons[x.lesson.id]?.stars > 0));
  return n ? n.lesson.id : null;
}

export function PathScreen() {
  const p = useStore(progress);
  const all = allLessons();
  const nextId = nextLessonId(p);
  const nextIndex = all.findIndex((x) => x.lesson.id === nextId);
  const done = all.filter((x) => p.lessons[x.lesson.id]?.stars > 0).length;

  return (
    <div>
      <div className="page-header">
        <h1>Trilha de aprendizado</h1>
      </div>
      <p className="muted">
        Lições curtas, em ordem: do primeiro contato com o teclado até ler e tocar músicas com as duas mãos. Cada lição mistura explicação,
        leitura, ritmo e prática no instrumento.
      </p>
      <div className="card flat" style={{ marginBottom: 22 }}>
        <div className="row between">
          <b>
            {done} de {all.length} lições
          </b>
          <span className="muted small">{Math.round((done / all.length) * 100)}%</span>
        </div>
        <div style={{ marginTop: 8 }}>
          <ProgressBar value={done / all.length} />
        </div>
      </div>

      {CURRICULUM.map((u, ui) => {
        const uDone = u.lessons.filter((l) => p.lessons[l.id]?.stars > 0).length;
        return (
          <section key={u.id} className="unit">
            <div className="unit-head">
              <div className="unit-badge" style={{ background: u.color }}>
                {ui + 1}
              </div>
              <div style={{ flex: 1 }}>
                <h2 style={{ margin: 0 }}>{u.title}</h2>
                <div className="small muted">{u.description}</div>
              </div>
              <span className="chip">
                {uDone}/{u.lessons.length}
              </span>
            </div>
            <div className="lesson-list">
              {u.lessons.map((l) => {
                const lp = p.lessons[l.id];
                const idx = all.findIndex((x) => x.lesson.id === l.id);
                const isNext = l.id === nextId;
                const locked = !lp && nextIndex >= 0 && idx > nextIndex;
                return (
                  <button
                    key={l.id}
                    className={'lesson-item' + (lp?.stars ? ' done' : '') + (isNext ? ' next' : '') + (locked ? ' locked' : '')}
                    onClick={() => {
                      if (locked && !confirm('Esta lição vem mais adiante na trilha. Quer abrir mesmo assim?')) return;
                      navigate('/licao/' + l.id);
                    }}
                  >
                    <span className="lesson-icon" style={isNext ? { background: u.color, color: 'white' } : undefined}>
                      <Icon name={lp?.stars ? 'check' : locked ? 'lock' : lessonIcon(l.activities)} />
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <b>{l.title}</b>
                      <div className="small muted">{l.summary}</div>
                    </span>
                    {lp ? <Stars n={lp.stars} /> : isNext ? <span className="chip accent">Próxima</span> : null}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
