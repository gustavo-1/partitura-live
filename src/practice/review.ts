/**
 * Revisão espaçada e intercalada.
 *
 *  - Notas: sistema de Leitner (caixas 0..4) com intervalos crescentes; a nota volta
 *    quando "vence" ou quando você erra.
 *  - Conceitos: perguntas das lições já concluídas, priorizando as mais antigas
 *    (prática de recuperação espaçada).
 *  - Tudo misturado na mesma sessão (prática intercalada).
 */
import { allLessons, type Activity } from '../data/curriculum';
import { pitchToVexKey, spellMidi } from '../music/theory';
import { today, type NoteStat, type Progress } from '../state/progress';

/** Intervalo (dias) até rever uma nota em cada caixa de Leitner. */
export const BOX_DAYS = [0, 1, 2, 4, 8];

export function isDue(s: NoteStat, now = Date.now()): boolean {
  const days = BOX_DAYS[Math.max(0, Math.min(4, s.box))];
  return now - s.last >= days * 86400000 * 0.85;
}

export function midiToken(m: number): string {
  const [n, o] = pitchToVexKey(spellMidi(m, 0)).split('/');
  return n[0].toUpperCase() + n.slice(1) + o;
}

/** Notas para revisar numa clave: vencidas primeiro, depois as mais fracas. */
export function dueNotes(p: Progress, clef: 'treble' | 'bass', max = 8): { pool: string[]; due: number } {
  const now = Date.now();
  const entries = Object.entries(p.noteStats)
    .filter(([k]) => k.startsWith(clef + ':'))
    .map(([k, s]) => ({ midi: Number(k.split(':')[1]), s }))
    .filter((x) => Number.isFinite(x.midi));
  const due = entries.filter((x) => isDue(x.s, now));
  const weak = entries
    .filter((x) => !isDue(x.s, now))
    .sort((a, b) => a.s.correct / Math.max(1, a.s.seen) - b.s.correct / Math.max(1, b.s.seen) || b.s.ms - a.s.ms);
  const pick = [...due.sort((a, b) => a.s.box - b.s.box || a.s.last - b.s.last), ...weak].slice(0, max).map((x) => midiToken(x.midi));
  return { pool: [...new Set(pick)], due: due.length };
}

/** Quantas notas estão vencidas (para mostrar na tela inicial). */
export function dueCount(p: Progress): number {
  const now = Date.now();
  return Object.values(p.noteStats).filter((s) => isDue(s, now)).length;
}

type Done = { lessonId: string; completedAt: number; stars: number; index: number };

function completedLessons(p: Progress, except?: string): Done[] {
  return allLessons()
    .filter((x) => x.lesson.id !== except && (p.lessons[x.lesson.id]?.stars ?? 0) > 0)
    .map((x) => ({ lessonId: x.lesson.id, completedAt: p.lessons[x.lesson.id]?.completedAt ?? 0, stars: p.lessons[x.lesson.id]?.stars ?? 0, index: x.index }));
}

function rng(seed: number) {
  let r = seed % 2147483647 || 1;
  return () => (r = (r * 16807) % 2147483647) / 2147483647;
}

/** Sorteia atividades de lições concluídas, dando mais peso às antigas e às com menos estrelas. */
function pickFrom(p: Progress, types: Activity['type'][], n: number, opts: { except?: string; before?: number; seed?: number } = {}): Activity[] {
  const rand = rng(opts.seed ?? Date.now());
  const lessons = allLessons();
  const pool: { a: Activity; w: number }[] = [];
  for (const d of completedLessons(p, opts.except)) {
    if (opts.before !== undefined && d.index >= opts.before) continue;
    const lesson = lessons[d.index].lesson;
    const ageDays = d.completedAt ? (Date.now() - d.completedAt) / 86400000 : 1;
    const w = 1 + Math.min(ageDays, 30) / 5 + (3 - d.stars);
    for (const a of lesson.activities) if (types.includes(a.type)) pool.push({ a, w });
  }
  const out: Activity[] = [];
  while (out.length < n && pool.length) {
    const total = pool.reduce((s, x) => s + x.w, 0);
    let r = rand() * total;
    let i = 0;
    for (; i < pool.length - 1; i++) {
      r -= pool[i].w;
      if (r <= 0) break;
    }
    out.push(pool[i].a);
    pool.splice(i, 1);
  }
  return out;
}

/** Aquecimento no começo de uma lição: 2 perguntas rápidas de lições anteriores. */
export function buildWarmup(lessonId: string, p: Progress): Activity[] {
  const idx = allLessons().findIndex((x) => x.lesson.id === lessonId);
  if (idx < 2) return [];
  const qs = pickFrom(p, ['quiz'], 2, { except: lessonId, before: idx, seed: hashStr(lessonId + today()) });
  if (qs.length < 2) return [];
  return [
    {
      type: 'info',
      title: 'Aquecimento',
      text: 'Antes do assunto novo, **2 perguntas rápidas** de lições anteriores. Tentar lembrar (sem olhar) é uma das formas mais eficazes de fixar o que você aprendeu.\n\nEssas perguntas não contam para as estrelas desta lição.',
    },
    ...qs,
  ];
}

function hashStr(s: string): number {
  let h = 7;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Revisão do dia: leitura de notas vencidas + conceitos + ritmo + ouvido, intercalados. */
export function buildReview(p: Progress): { acts: Activity[]; parts: string[] } {
  const parts: string[] = [];
  const treble = dueNotes(p, 'treble', 8);
  const bass = dueNotes(p, 'bass', 6);
  const reads: Activity[] = [];
  if (treble.pool.length >= 3) reads.push({ type: 'read', clef: 'treble', pool: treble.pool, count: Math.min(8, Math.max(5, treble.pool.length + 2)) });
  if (bass.pool.length >= 3) reads.push({ type: 'read', clef: 'bass', pool: bass.pool, count: Math.min(6, Math.max(4, bass.pool.length + 1)) });
  if (!reads.length) reads.push({ type: 'read', clef: 'treble', pool: ['C4', 'D4', 'E4', 'F4', 'G4'], count: 6 });
  parts.push('notas');
  const quizzes = pickFrom(p, ['quiz'], 3, { seed: hashStr('review' + today()) });
  if (quizzes.length) parts.push('conceitos');
  const rhythm = pickFrom(p, ['rhythm'], 1, { seed: hashStr('rhythm' + today()) });
  if (rhythm.length) parts.push('ritmo');
  const unit1Done = completedLessons(p).length >= 3;
  const echo: Activity[] = unit1Done ? [{ type: 'echo', pool: [60, 62, 64, 65, 67], length: 3, count: 1, intro: 'De ouvido: toque de volta a melodia.' }] : [];
  if (echo.length) parts.push('ouvido');

  // intercala: leitura, conceito, ritmo, leitura, conceito, ouvido, conceito
  const acts: Activity[] = [];
  const q = [...quizzes];
  acts.push(reads[0]);
  if (q.length) acts.push(q.shift()!);
  acts.push(...rhythm);
  if (reads[1]) acts.push(reads[1]);
  if (q.length) acts.push(q.shift()!);
  acts.push(...echo);
  acts.push(...q);
  return { acts, parts };
}
