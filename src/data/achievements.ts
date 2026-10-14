import type { Progress } from '../state/progress';
import { CURRICULUM } from './curriculum';

/** Conquistas (medalhas). São calculadas a partir do progresso e ficam visíveis para os amigos. */
export interface Achievement {
  id: string;
  icon: string;
  title: string;
  desc: string;
  check: (p: Progress) => boolean;
}

const lessonsDone = (p: Progress) => Object.values(p.lessons).filter((l) => l.stars > 0).length;
const totalLessons = CURRICULUM.reduce((a, u) => a + u.lessons.length, 0);
const unitDone = (p: Progress, i: number) => CURRICULUM[i].lessons.every((l) => (p.lessons[l.id]?.stars ?? 0) > 0);
const cards = (p: Progress) => Object.values(p.noteStats).reduce((a, s) => a + s.seen, 0);
const songsAbove = (p: Progress, acc: number) => Object.values(p.songs).filter((s) => s.best >= acc).length;
const total = (p: Progress, k: string) => (p.totals ?? {})[k] ?? 0;

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'primeira-licao', icon: '🎹', title: 'Primeiros passos', desc: 'Concluiu a primeira lição.', check: (p) => lessonsDone(p) >= 1 },
  { id: 'unidade-teclado', icon: '🗺️', title: 'Explorador do teclado', desc: 'Concluiu a unidade "Conhecendo o teclado".', check: (p) => unitDone(p, 0) },
  { id: 'unidade-ritmo', icon: '🥁', title: 'Pulso firme', desc: 'Concluiu a unidade de ritmo.', check: (p) => unitDone(p, 1) },
  { id: 'unidade-sol', icon: '🎼', title: 'Leitor da clave de Sol', desc: 'Concluiu a unidade da clave de Sol.', check: (p) => unitDone(p, 2) },
  { id: 'unidade-fa', icon: '🎶', title: 'Leitor da clave de Fá', desc: 'Concluiu a unidade da clave de Fá.', check: (p) => unitDone(p, 3) },
  { id: 'duas-maos', icon: '🙌', title: 'Duas mãos', desc: 'Concluiu a unidade "Duas mãos".', check: (p) => unitDone(p, 4) },
  { id: 'metade-trilha', icon: '⛰️', title: 'Meio caminho', desc: 'Concluiu metade da trilha.', check: (p) => lessonsDone(p) >= Math.ceil(totalLessons / 2) },
  { id: 'trilha-completa', icon: '🏆', title: 'Trilha completa', desc: 'Concluiu todas as lições.', check: (p) => lessonsDone(p) >= totalLessons },
  { id: 'perfeccionista', icon: '⭐', title: 'Perfeccionista', desc: '10 lições com 3 estrelas.', check: (p) => Object.values(p.lessons).filter((l) => l.stars >= 3).length >= 10 },
  { id: 'primeira-musica', icon: '🎵', title: 'Primeira música', desc: 'Tocou uma música inteira com 80% ou mais.', check: (p) => songsAbove(p, 0.8) >= 1 },
  { id: 'repertorio', icon: '📚', title: 'Repertório', desc: '5 músicas com 90% ou mais.', check: (p) => songsAbove(p, 0.9) >= 5 },
  { id: 'impecavel', icon: '💎', title: 'Impecável', desc: 'Uma música inteira sem nenhum erro.', check: (p) => songsAbove(p, 0.995) >= 1 },
  { id: 'andamento', icon: '🚀', title: 'No andamento', desc: 'Tocou uma música no andamento original com 80%+.', check: (p) => Object.values(p.songs).some((s) => (s.bestTempo ?? 0) >= 100) },
  { id: 'sequencia-3', icon: '🔥', title: 'Aquecendo', desc: 'Praticou 3 dias seguidos.', check: (p) => p.streak.best >= 3 },
  { id: 'sequencia-7', icon: '📅', title: 'Uma semana', desc: 'Praticou 7 dias seguidos.', check: (p) => p.streak.best >= 7 },
  { id: 'sequencia-30', icon: '🌟', title: 'Hábito formado', desc: 'Praticou 30 dias seguidos.', check: (p) => p.streak.best >= 30 },
  { id: 'maratona', icon: '⏱️', title: 'Maratona', desc: '60 minutos de prática num só dia.', check: (p) => Object.values(p.practice).some((s) => s >= 3600) },
  { id: 'leitor-100', icon: '👀', title: 'Olhos atentos', desc: '100 cartões de leitura respondidos.', check: (p) => cards(p) >= 100 },
  { id: 'leitor-1000', icon: '🧠', title: 'Leitura afiada', desc: '1.000 cartões de leitura respondidos.', check: (p) => cards(p) >= 1000 },
  {
    id: 'leitura-rapida',
    icon: '⚡',
    title: 'Leitura relâmpago',
    desc: '15 notas reconhecidas em menos de 1,5 s, com 90% de acerto.',
    check: (p) => Object.values(p.noteStats).filter((s) => s.seen >= 3 && s.correct / s.seen >= 0.9 && s.ms > 0 && s.ms < 1500).length >= 15,
  },
  { id: 'xp-1000', icon: '💪', title: 'Dedicação', desc: 'Juntou 1.000 XP.', check: (p) => p.xp >= 1000 },
  { id: 'amizade', icon: '🤝', title: 'Em boa companhia', desc: 'Adicionou o primeiro amigo.', check: (p) => !!p.flags?.friend },
  { id: 'desafiante', icon: '⚔️', title: 'Desafiante', desc: 'Desafiou um amigo numa música.', check: (p) => !!p.flags?.challenge },
  { id: 'banda-unida', icon: '🎺', title: 'Banda unida', desc: 'O grupo de amigos bateu a meta coletiva da semana.', check: (p) => !!p.flags?.group },
  { id: 'nivel-5', icon: '🎓', title: 'Leitor(a) de pauta', desc: 'Chegou ao nível 5.', check: (p) => p.xp >= 500 },
  { id: 'nivel-10', icon: '👑', title: 'Pianista de verdade', desc: 'Chegou ao nível 10.', check: (p) => p.xp >= 2250 },
  { id: 'missoes-1', icon: '🎁', title: 'Dia completo', desc: 'Cumpriu todas as missões de um dia.', check: (p) => (p.questDays ?? 0) >= 1 },
  { id: 'missoes-7', icon: '🗓️', title: 'Semana de missões', desc: 'Cumpriu todas as missões em 7 dias.', check: (p) => (p.questDays ?? 0) >= 7 },
  { id: 'revisao-10', icon: '🧠', title: 'Memória de elefante', desc: 'Fez 10 revisões do dia.', check: (p) => total(p, 'reviews') >= 10 },
  { id: 'ouvido-20', icon: '👂', title: 'Ouvido afiado', desc: 'Tocou 20 melodias de ouvido.', check: (p) => total(p, 'echo') >= 20 },
  { id: 'trecho-10', icon: '🎯', title: 'Prática deliberada', desc: 'Firmou 10 trechos difíceis (3 rodadas seguidas sem erro).', check: (p) => total(p, 'focus') >= 10 },
  { id: 'primeira-vista-20', icon: '📖', title: 'Leitor(a) corajoso(a)', desc: 'Leu 20 melodias à primeira vista.', check: (p) => total(p, 'sight') >= 20 },
];

export function achievementById(id: string): Achievement | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
}
