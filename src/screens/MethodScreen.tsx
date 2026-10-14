import { back } from '../lib/router';
import { Icon } from '../components/Icon';

interface Principle {
  icon: string;
  title: string;
  evidence: string;
  inApp: string[];
  refs: number[];
}

const PRINCIPLES: Principle[] = [
  {
    icon: '🎯',
    title: 'Prática deliberada: o “como” importa mais que o “quanto”',
    evidence:
      'Uma meta-análise com 13 estudos encontrou relação forte entre prática deliberada e desempenho musical (r ≈ 0,61). Num estudo com pianistas, o tempo de prática não previu a qualidade no dia seguinte: o que fez diferença foi identificar o erro, isolar o trecho, ajustar o andamento e repetir até ficar estável — e tocar errado muitas vezes piorou o resultado.',
    inApp: [
      'Plano de estudo por trechos, mãos separadas antes de juntas, começando devagar.',
      'Depois de cada execução, o app aponta os compassos com mais erros.',
      'Prática focada: repetir o trecho até sair 3 vezes seguidas sem erro, e só então acelerar.',
    ],
    refs: [1, 2, 3],
  },
  {
    icon: '🧠',
    title: 'Lembrar (sem olhar) e espaçar no tempo',
    evidence:
      'Tentar lembrar uma informação fixa mais do que reler (efeito de testagem), e revisões espaçadas em dias diferentes fazem a memória durar muito mais do que estudar tudo de uma vez.',
    inApp: [
      'Revisão do dia: leitura das notas no ponto de revisar (sistema de caixas de Leitner), conceitos, ritmo e ouvido.',
      'Cada lição começa com um aquecimento de 2 perguntas de lições anteriores.',
      'Notas que você erra ou demora para ler voltam antes; as que você domina voltam depois de mais dias.',
    ],
    refs: [4, 5],
  },
  {
    icon: '🔀',
    title: 'Misturar assuntos (prática intercalada)',
    evidence:
      'Em clarinetistas, praticar trechos intercalados (em vez de um bloco de cada) levou a execuções mais bem avaliadas no dia seguinte, mesmo parecendo mais difícil na hora. Os resultados em música ainda são mistos, por isso o app mistura na revisão e mantém blocos no aprendizado de algo novo.',
    inApp: ['A revisão do dia alterna leitura, conceitos, ritmo e ouvido.', 'Leitura com as duas claves misturadas no treino de notas.'],
    refs: [6],
  },
  {
    icon: '👂',
    title: 'Som antes do símbolo',
    evidence:
      'Kodály, Gordon (Music Learning Theory) e outros defendem ouvir e cantar antes de ler. Estudos com iniciantes associam estratégias de “som antes do símbolo” e tocar de ouvido a melhor ritmo e leitura à primeira vista — evidência promissora, mas ainda com estudos pequenos.',
    inApp: [
      'Atividades “ouça e toque de volta” na trilha e no treino “Tocar de ouvido”.',
      'Depois de acertar de ouvido, você vê como a melodia se escreve na pauta.',
      'Toda música começa pela etapa “Ouça”, acompanhando a partitura com os olhos.',
    ],
    refs: [7, 8, 9],
  },
  {
    icon: '📖',
    title: 'Ler por padrões, não nota por nota',
    evidence:
      'Bons leitores olham à frente do que tocam (a “distância olho-mão”) e reconhecem grupos de notas — intervalos, acordes, escalas — com menos fixações. Prática específica de leitura explica boa parte da diferença entre leitores, e a memória de trabalho também conta.',
    inApp: [
      'Leitura por intervalos (passo/salto, direção) e notas-guia (Dó central, Sol, Fá).',
      'Leitura à primeira vista com melodias novas geradas no seu nível, todos os dias.',
      'Nas etapas finais de cada música, as dicas no teclado somem: você lê a partitura de verdade.',
    ],
    refs: [10, 11, 12],
  },
  {
    icon: '🔁',
    title: 'Feedback na medida certa',
    evidence:
      'Feedback imediato acelera o começo, mas ajuda demais pode virar muleta (hipótese da orientação). A evidência é mista: em vez de esconder o feedback, o app retira as dicas visuais aos poucos e mantém o aviso de certo/errado.',
    inApp: ['Modo “espera”: o app aguarda cada nota, sem pressão de tempo.', 'Dicas no teclado ligadas no início e desligadas nas etapas finais do plano.'],
    refs: [13, 14],
  },
  {
    icon: '🌱',
    title: 'Motivação que dura: metas próximas, autonomia e companhia',
    evidence:
      'Metas próximas e alcançáveis aumentam a confiança e o interesse (Bandura & Schunk). Uma meta-análise sobre gamificação no ensino encontrou efeitos pequenos a moderados e melhores resultados quando competição vem junto com colaboração. A Teoria da Autodeterminação destaca competência, autonomia e vínculo.',
    inApp: [
      'Meta diária em minutos que você escolhe, missões do dia focadas em prática de qualidade.',
      'Proteção de sequência (ganha cumprindo as missões): um dia sem prática não apaga seu esforço.',
      'Liga semanal que recomeça para todos na segunda + uma meta coletiva do grupo de amigos.',
    ],
    refs: [15, 16, 17],
  },
];

const REFS: { n: number; text: string; url?: string }[] = [
  { n: 1, text: 'Platz, F. et al. (2014). The influence of deliberate practice on musical achievement: a meta-analysis. Frontiers in Psychology, 5, 646.', url: 'https://doi.org/10.3389/fpsyg.2014.00646' },
  { n: 2, text: "Duke, R. A., Simmons, A. L., & Cash, C. D. (2009). It's not how much; it's how. Journal of Research in Music Education, 56(4), 310–321.", url: 'https://doi.org/10.1177/0022429408328851' },
  { n: 3, text: 'Ericsson, K. A., Krampe, R. T., & Tesch-Römer, C. (1993). The role of deliberate practice in the acquisition of expert performance. Psychological Review, 100(3), 363–406.' },
  { n: 4, text: 'Roediger, H. L., & Karpicke, J. D. (2006). Test-enhanced learning. Psychological Science, 17(3), 249–255.' },
  { n: 5, text: 'Cepeda, N. J. et al. (2006). Distributed practice in verbal recall tasks: a review and quantitative synthesis. Psychological Bulletin, 132(3), 354–380.' },
  { n: 6, text: 'Carter, C. E., & Grahn, J. A. (2016). Optimizing music learning: exploring how blocked and interleaved practice schedules affect advanced performance. Frontiers in Psychology, 7, 1251.', url: 'https://doi.org/10.3389/fpsyg.2016.01251' },
  { n: 7, text: 'Gordon, E. E. (2012). Learning Sequences in Music: A Contemporary Music Learning Theory. GIA.' },
  { n: 8, text: 'McPherson, G. E., Bailey, M., & Sinclair, K. E. (1997). Path analysis of a theoretical model to describe the relationship among five types of musical performance. Journal of Research in Music Education, 45(1).' },
  { n: 9, text: 'Mills, J., & McPherson, G. E. (2006). Musical literacy. In McPherson (Ed.), The Child as Musician. Oxford University Press.' },
  { n: 10, text: 'Perra, J. et al. (2021). Review on eye-hand span in sight-reading of music. Journal of Eye Movement Research, 14(4).', url: 'https://doi.org/10.16910/jemr.14.4.4' },
  { n: 11, text: 'Meinz, E. J., & Hambrick, D. Z. (2010). Deliberate practice is necessary but not sufficient to explain individual differences in piano sight-reading skill. Psychological Science, 21(7), 914–919.' },
  { n: 12, text: 'Zhukov, K., Viney, L., Riddle, G., Teniswood-Harvey, A., & Fujimura, K. (2016). Improving sight-reading skills in advanced pianists: a hybrid approach. Psychology of Music, 44(2).' },
  { n: 13, text: 'Salmoni, A. W., Schmidt, R. A., & Walter, C. B. (1984). Knowledge of results and motor learning: a review and critical reappraisal. Psychological Bulletin, 95(3), 355–386.' },
  { n: 14, text: 'Wulf, G., & Shea, C. H. (2004). Understanding the role of augmented feedback. In Skill Acquisition in Sport. Routledge.' },
  { n: 15, text: 'Bandura, A., & Schunk, D. H. (1981). Cultivating competence, self-efficacy, and intrinsic interest through proximal self-motivation. Journal of Personality and Social Psychology, 41(3), 586–598.' },
  { n: 16, text: 'Sailer, M., & Homner, L. (2020). The gamification of learning: a meta-analysis. Educational Psychology Review, 32, 77–112.', url: 'https://doi.org/10.1007/s10648-019-09498-w' },
  { n: 17, text: 'Ryan, R. M., & Deci, E. L. (2000). Self-determination theory and the facilitation of intrinsic motivation, social development, and well-being. American Psychologist, 55(1), 68–78.' },
];

export default function MethodScreen() {
  return (
    <div className="method">
      <div className="page-header">
        <button className="btn ghost icon" onClick={() => back('/')} aria-label="Voltar">
          <Icon name="back" />
        </button>
        <h1 style={{ flex: 1 }}>Como o app ensina</h1>
      </div>
      <p className="muted">
        O Partitura Live junta métodos clássicos de piano (Faber, Alfred, Bastien, Kodály) com o que a pesquisa em aprendizagem e em educação
        musical mostra que funciona. Aqui está o resumo — com as fontes.
      </p>

      <div className="card routine">
        <h3>
          <Icon name="calendar" size={18} /> Uma boa rotina de 15 minutos
        </h3>
        <ol>
          <li>
            <b>3 min · Revisão do dia</b> — relembrar o que já viu (notas, conceitos, ritmo).
          </li>
          <li>
            <b>7 min · Algo novo</b> — a próxima lição ou a próxima etapa da sua música, devagar.
          </li>
          <li>
            <b>3 min · Primeira vista</b> — ler uma melodia nova sem parar.
          </li>
          <li>
            <b>2 min · Por prazer</b> — tocar de ouvido ou uma música que você já sabe.
          </li>
        </ol>
        <p className="small muted" style={{ marginBottom: 0 }}>
          Praticar um pouco todo dia rende mais do que uma sessão longa por semana. As missões do dia seguem essa ordem.
        </p>
      </div>

      {PRINCIPLES.map((p) => (
        <div key={p.title} className="card principle">
          <h3>
            <span className="p-ic">{p.icon}</span> {p.title}
          </h3>
          <p className="small">{p.evidence}</p>
          <div className="tiny muted upper">No app</div>
          <ul className="small">
            {p.inApp.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
          <div className="tiny muted">Fontes: {p.refs.map((n) => `[${n}]`).join(' ')}</div>
        </div>
      ))}

      <div className="card">
        <h3>Referências</h3>
        <ol className="refs small">
          {REFS.map((r) => (
            <li key={r.n} value={r.n}>
              {r.text}{' '}
              {r.url && (
                <a href={r.url} target="_blank" rel="noopener noreferrer">
                  link
                </a>
              )}
            </li>
          ))}
        </ol>
        <p className="tiny muted" style={{ marginBottom: 0 }}>
          Onde a evidência é mista ou vem de estudos pequenos (prática intercalada em música, “som antes do símbolo”, frequência de feedback), o
          app usa a ideia com moderação e dá a você o controle.
        </p>
      </div>
    </div>
  );
}
