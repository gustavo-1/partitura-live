import { handsInSong } from '../music/timeline';
import type { Hand, Song } from '../music/types';
import type { PracticeMode } from './engine';

/**
 * Plano de estudo de uma música, seguindo práticas consagradas de ensino:
 * dividir em trechos (chunking), mãos separadas antes de juntas, começar devagar
 * no modo "espera" (sem pressão de tempo) e aumentar o andamento gradualmente.
 */
export interface PlanStep {
  key: string;
  title: string;
  desc: string;
  hands: Hand[];
  mode: PracticeMode;
  tempo: number;
  loop: [number, number] | null;
  target: number; // precisão mínima para concluir
  section?: number;
}

export interface StudyPlan {
  sections: [number, number][];
  steps: PlanStep[];
}

export function sectionsFor(song: Song): [number, number][] {
  const n = song.measures.length;
  if (n <= 6) return [[0, n - 1]];
  const notesPerMeasure = song.notes.filter((x) => x.keys.length).length / n;
  const size = notesPerMeasure > 10 ? 2 : 4;
  const out: [number, number][] = [];
  for (let i = 0; i < n; i += size) {
    const end = Math.min(n - 1, i + size - 1);
    // evita trecho final de 1 compasso
    if (end - i < 1 && out.length) out[out.length - 1][1] = end;
    else out.push([i, end]);
  }
  return out;
}

export function handsKey(h: Hand[]): string {
  return h.length === 2 ? 'RL' : h[0];
}

export function studyPlan(song: Song): StudyPlan {
  const hands = handsInSong(song);
  const both = hands.length === 2;
  const sections = sectionsFor(song);
  const steps: PlanStep[] = [];
  const handLabel = (h: Hand) => (h === 'R' ? 'Mão direita' : 'Mão esquerda');

  sections.forEach(([a, b], si) => {
    const loop: [number, number] | null = sections.length > 1 ? [a, b] : null;
    const where = sections.length > 1 ? `compassos ${a + 1}–${b + 1}` : 'a música toda';
    steps.push({
      key: `s${si}-listen`,
      title: `Ouça ${sections.length > 1 ? 'o trecho ' + (si + 1) : 'a música'}`,
      desc: `Escute ${where} acompanhando a partitura com os olhos.`,
      hands,
      mode: 'listen',
      tempo: 0.85,
      loop,
      target: 0,
      section: si,
    });
    for (const h of hands) {
      steps.push({
        key: `s${si}-${h}-wait`,
        title: `${handLabel(h)}, sem pressa`,
        desc: `O app espera você achar cada nota (${where}). Leia a nota antes de olhar para as mãos.`,
        hands: [h],
        mode: 'wait',
        tempo: 0.7,
        loop,
        target: 0.8,
        section: si,
      });
    }
    if (both) {
      steps.push({
        key: `s${si}-RL-wait`,
        title: 'Mãos juntas, sem pressa',
        desc: `Junte as mãos devagar (${where}).`,
        hands,
        mode: 'wait',
        tempo: 0.7,
        loop,
        target: 0.8,
        section: si,
      });
    }
    steps.push({
      key: `s${si}-tempo60`,
      title: 'No tempo, devagar (60%)',
      desc: `Toque junto com o metrônomo a 60% do andamento (${where}).`,
      hands,
      mode: 'tempo',
      tempo: 0.6,
      loop,
      target: 0.8,
      section: si,
    });
  });

  if (sections.length > 1) {
    steps.push({
      key: 'full-wait',
      title: 'Música inteira, sem pressa',
      desc: 'Junte todos os trechos no modo espera.',
      hands,
      mode: 'wait',
      tempo: 0.8,
      loop: null,
      target: 0.85,
    });
  }
  steps.push({
    key: 'full-75',
    title: 'Música inteira a 75%',
    desc: 'Agora no tempo, um pouco mais devagar que o original.',
    hands,
    mode: 'tempo',
    tempo: 0.75,
    loop: null,
    target: 0.85,
  });
  steps.push({
    key: 'full-100',
    title: 'Andamento original',
    desc: 'O desafio final: a música inteira no andamento original.',
    hands,
    mode: 'tempo',
    tempo: 1,
    loop: null,
    target: 0.9,
  });
  return { sections, steps };
}

export function stepUrl(songId: string, st: PlanStep): string {
  const q = new URLSearchParams({
    mode: st.mode,
    hands: handsKey(st.hands),
    tempo: String(st.tempo),
    step: st.key,
  });
  if (st.loop) q.set('loop', `${st.loop[0]}-${st.loop[1]}`);
  return `/tocar/${encodeURIComponent(songId)}?${q.toString()}`;
}
