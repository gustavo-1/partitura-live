# Partitura Live 🎹

App gratuito e livre para **aprender a ler partituras e tocar teclado**. Ele **ouve você pelo microfone**, mostra na hora se a nota está certa e guia o estudo com uma trilha didática, um plano de estudo para cada música e treinos diários.

Funciona no navegador do celular, tablet ou computador, pode ser **instalado como app** (PWA) e funciona **offline**. Não precisa de cabo: o microfone basta. (Se o seu teclado tiver USB/MIDI, ele também é reconhecido.)

> Depois de publicado no GitHub Pages, o endereço será **https://gustavo-1.github.io/partitura-live/** (veja [Publicar](#publicar)).

---

## O que o app faz

| | |
|---|---|
| 🎤 **Ouve pelo microfone** | Detector polifônico próprio: reconhece notas e acordes do piano/teclado, inclusive notas repetidas. Nada é gravado nem enviado: tudo roda no aparelho. |
| 🎼 **Partitura com cursor** | Pauta dupla com clave de Sol/Fá, armadura, dedilhado, colcheias, ligaduras. A nota da vez fica destacada, acertos ficam verdes, e uma **nota fantasma vermelha** mostra na pauta a nota que você tocou por engano. |
| 🌧️ **Modo cascata** | Notas "caindo" até o teclado (como Synthesia), com cores por mão. Também dá para ver partitura e cascata juntas. |
| ⏸️ **Modo espera** | A música só avança quando você toca a nota certa. Ao errar: *"Você tocou Fá4 — procure Mi4 (← mais grave)"*. |
| ⏱️ **Modo no tempo** | Com contagem e metrônomo; mede adiantado/atrasado. |
| 👂 **Modo ouvir** | O app toca a música (som de piano real) enquanto o cursor acompanha a partitura. |
| ✋ **Mãos separadas** | Pratique só a direita, só a esquerda ou juntas — e o app pode tocar a outra mão. |
| 🔁 **Trechos em loop** | Toque em dois compassos para repetir só aquele trecho; opção de **acelerar aos poucos** (+5% a cada rodada com 90%+). |
| 🗺️ **Trilha de aprendizado** | 9 unidades e 36 lições: teclado → ritmo → clave de Sol → clave de Fá → duas mãos → colcheias → acidentes e armaduras → acordes → leitura à primeira vista. |
| 📋 **Plano de estudo por música** | Divide a música em trechos: ouvir → mão direita devagar → mão esquerda → mãos juntas → no tempo a 60% → música inteira a 75% → andamento original. |
| 🃏 **Treino de leitura** | Cartões com notas na pauta que se adaptam: as notas que você erra ou demora mais aparecem mais (repetição espaçada). Mapa de calor das notas. |
| ✨ **Leitura à primeira vista** | Exercícios novos gerados no seu nível, infinitos. |
| 🥁 **Treino de ritmo** | Leia e bata ritmos com o metrônomo (toque na tela, barra de espaço ou qualquer tecla do piano). |
| 📂 **Suas músicas** | Importe **MusicXML** (.musicxml/.mxl — ex.: exportado do MuseScore) ou **MIDI** (.mid, convertido em partitura automaticamente). |
| 📈 **Progresso** | Estrelas, XP, sequência de dias, meta diária, tempo de prática, melhores resultados. Backup/restauração em JSON. |
| ☁️ **Sincronização opcional** | Com o seu Firebase (plano gratuito): login com Google e progresso em todos os aparelhos. |

Sem teclado por perto? Use o **teclado na tela** ou o **teclado do computador** (`A W S E D F T G Y H U J K…`, `Z`/`X` mudam a oitava).

---

## Como o ensino foi pensado

A trilha segue práticas consagradas em métodos de piano (Faber, Alfred, Bastien) e em pesquisas sobre leitura musical:

- **Geografia do teclado pelos grupos de 2 e 3 teclas pretas** — nunca contar teclas.
- **Notas-guia (landmarks)**: Dó central, Sol da clave de Sol, Fá da clave de Fá, Dó5, Sol2…
- **Leitura por intervalos** (passo/salto, direção) em vez de decorar cada nota ou usar frases mnemônicas.
- **Ritmo separado da altura**, com pulsação e contagem em voz alta.
- **Prática em partes (chunking), mãos separadas, devagar primeiro** e andamento crescente.
- **Feedback imediato** e **repetição espaçada** nas notas difíceis.
- **Leitura à primeira vista frequente** com material novo — o que mais desenvolve fluência.

---

## Rodar no seu computador

Requer [Node.js](https://nodejs.org/) 20 ou mais novo.

```bash
npm install
npm run dev        # abre em http://localhost:5173
```

O microfone só funciona em **https** ou em **localhost**. Para testar no celular na mesma rede, publique (abaixo) ou use `npm run dev -- --host` com um túnel https.

Outros comandos:

```bash
npm test           # testes automatizados
npm run build      # gera a versão de produção em dist/
npm run preview    # serve a versão de produção localmente
```

---

## Publicar

### Opção A — GitHub Pages (grátis, automático)

1. No GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Faça merge na branch `main`. O workflow `.github/workflows/deploy.yml` testa, gera e publica.
3. O app fica em `https://gustavo-1.github.io/partitura-live/`.

### Opção B — Firebase Hosting (grátis)

```bash
npm install -g firebase-tools
firebase login
npm run build
firebase deploy --only hosting --project SEU-PROJETO
```

---

## Conectar ao seu Firebase (opcional)

Sem Firebase, o progresso fica salvo no próprio aparelho (e você pode exportar um backup). Com Firebase, ele sincroniza entre celular e computador. Tudo cabe no plano gratuito **Spark**.

1. Acesse <https://console.firebase.google.com> → **Adicionar projeto** (pode desativar o Analytics).
2. **Authentication → Começar → Sign-in method → Google → Ativar**.
3. **Authentication → Settings → Authorized domains**: adicione `gustavo-1.github.io` (e o domínio onde você publicar).
4. **Firestore Database → Criar banco de dados** (modo produção, região `southamerica-east1` por exemplo).
5. **Firestore → Regras**: cole o conteúdo de [`firestore.rules`](firestore.rules) e publique (cada usuário só acessa os próprios dados).
6. **Configurações do projeto → Seus apps → Web (`</>`)** → registre o app e copie o objeto `firebaseConfig`.
7. Escolha uma forma de usar a configuração:
   - **No app**: Configurações → Sincronização → cole o `firebaseConfig` → *Salvar* → *Entrar com Google*; ou
   - **No build** (vale para todos): GitHub → **Settings → Secrets and variables → Actions → Variables → New variable** `FIREBASE_CONFIG` com o JSON em uma linha. Localmente, crie `.env.local` como em [`.env.example`](.env.example).

> A `apiKey` do Firebase para web não é secreta — quem protege os dados são as regras do Firestore.

O que é sincronizado: lições, estrelas, músicas praticadas, estatísticas de leitura, tempo de prática e preferências. A mesclagem nunca perde progresso (fica sempre com o melhor resultado de cada aparelho). Músicas importadas ficam só no aparelho onde foram importadas.

---

## Onde achar partituras

- **MuseScore** (musescore.com / MuseScore Studio, gratuito): abra a partitura e use *Exportar → MusicXML*.
- **IMSLP** e **Mutopia Project**: domínio público, muitas com MIDI/MusicXML.
- **OpenScore**: partituras clássicas digitadas, licença livre.
- Prefira arranjos "piano fácil" / "beginner" no começo.

---

## Como funciona a detecção pelo microfone

`src/audio/detector.ts` analisa o som ~60 vezes por segundo:

1. FFT de 8192 pontos (≈170 ms) e normalização por **contraste local** (independe do volume e do microfone).
2. **Soma de harmônicos** para cada uma das notas do piano, considerando a **inarmonicidade** das cordas (harmônicos "esticados") e penalizando harmônicos ausentes.
3. **Estimativa iterativa com cancelamento** (inspirada em Klapuri, 2006): acha a nota mais forte, remove seus harmônicos respeitando a "suavidade espectral" e procura a próxima — assim reconhece acordes.
4. **Detecção de ataque por nota** (mediana da subida de energia nos primeiros harmônicos) para reconhecer a **mesma tecla tocada de novo**, sem confundir com batimentos ou com o ataque de outra nota.
5. O motor de prática conhece as notas esperadas e trata como "inseparáveis" notas em oitava dentro do mesmo acorde (limitação física de qualquer microfone).

O clique do metrônomo é um ruído filtrado (sem altura definida) justamente para não ser confundido com uma nota.

Avaliação com gravações reais de piano (FluidR3, 48 kHz): 60 de 61 teclas reconhecidas na faixa de um teclado de 61 teclas, melodias e notas repetidas 100%, acordes 37/39, nenhum falso positivo com ruído. Teste ponta a ponta no Chromium com microfone simulado: 100% em "Maria tinha um carneirinho" (modo espera), "Ode à Alegria" a duas mãos (espera e no tempo), e notas erradas propositais detectadas corretamente.

Dicas: aparelho a menos de 1 m do teclado, som de piano acústico, ambiente silencioso. Ajuste a sensibilidade em **Treino → Microfone e afinação**.

---

## Estrutura do código

```
src/
  audio/       detector de notas, microfone, piano amostrado, metrônomo, entrada (mic/MIDI/tela/teclado)
  music/       modelo musical, notação textual, teoria, importadores MusicXML/MIDI, gerador de exercícios
  practice/    motor de prática (espera/tempo/ouvir) e plano de estudo
  components/  partitura (VexFlow), teclado, cascata, mini-player, UI
  screens/     telas (início, trilha, lição, músicas, player, treinos, progresso, configurações)
  data/        músicas embutidas e currículo
  state/       configurações e progresso (localStorage)
  lib/         roteador, store, IndexedDB, sincronização Firebase
public/        ícones, manifesto PWA, service worker, amostras de piano
tests/         testes (notação, importadores, currículo, mesclagem, detector)
```

As músicas e exercícios embutidos usam uma notação textual compacta (`src/music/notation.ts`), por exemplo:

```
rh: 'E4q@3 E4 F4@4 G4@5 | G4 F4 E4 D4 | C4 C4 D4 E4 | E4q. D4e D4h'
lh: 'C3w@5 | G3w@1 | (C3 E3 G3)w | ...'
```

`q`/`h`/`w`/`e`/`s` = semínima/mínima/semibreve/colcheia/semicolcheia, `.` = ponto, `@3` = dedo, `~` = ligadura, `(…)` = acorde, `rq` = pausa, `R` = compasso de pausa.

### Testes do detector com áudio real

O teste `tests/detector.bench.test.ts` usa amostras reais de piano e só roda se você apontar para elas:

```bash
# baixe as 88 amostras FluidR3 (mp3) de github.com/gleitz/midi-js-soundfonts e converta:
for f in *.mp3; do ffmpeg -i "$f" -ac 1 -ar 48000 -f f32le "raw/${f%.mp3}.f32"; done
SAMPLES_RAW=/caminho/raw npx vitest run tests/detector.bench.test.ts
```

---

## Créditos e licenças

- Partituras desenhadas com [VexFlow](https://github.com/0xfe/vexflow) (MIT) e fonte Bravura (SIL OFL).
- Som de piano: **FluidR3_GM** (Frank Wen), via [midi-js-soundfonts](https://github.com/gleitz/midi-js-soundfonts) — Creative Commons Attribution 3.0.
- Leitura de MIDI: [@tonejs/midi](https://github.com/Tonejs/Midi) (MIT). Descompactação .mxl: [fflate](https://github.com/101arrowz/fflate) (MIT).
- Músicas embutidas: domínio público / tradicionais, em arranjos simplificados.
