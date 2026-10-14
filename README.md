# Partitura Live 🎹

App gratuito e livre para **aprender a ler partituras e tocar teclado**. Ele **ouve você pelo microfone**, mostra na hora se a nota está certa e guia o estudo com uma trilha didática, um plano de estudo para cada música e treinos diários.

Funciona no navegador do celular, tablet ou computador, pode ser **instalado como app** (PWA) e funciona **offline**. Não precisa de cabo: o microfone basta. (Se o seu teclado tiver USB/MIDI, ele também é reconhecido.)

> **App publicado:** https://partitura-live-2jo.web.app (Firebase Hosting, projeto `partitura-live-2jo`).

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
| 👤 **Conta** | Login com Google ou e-mail e senha. A sessão fica guardada no aparelho; o progresso vai para a nuvem e aparece em qualquer aparelho (funciona offline e sincroniza depois). |
| 👥 **Amigos** | Código de amigo e link de convite, ranking semanal de XP, feed de atividades com aplausos 👏, mensagens, desafios ⚔️ ("supere meu recorde nesta música") e envio das músicas que você importou. |
| 🏅 **Medalhas** | 23 conquistas (sequências, lições, músicas perfeitas, leitura rápida…), visíveis para os amigos. |

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
npm run test:rules # testes das regras de segurança (emulador do Firestore; requer Java)
npm run build      # gera a versão de produção em dist/
npm run preview    # serve a versão de produção localmente
```

---

## Publicar

O app está hospedado no **Firebase Hosting** (projeto `partitura-live-2jo`, configurado em `.firebaserc`). Para publicar uma nova versão:

```bash
npm install -g firebase-tools
firebase login
npm run deploy      # gera o build e publica site + regras do Firestore
```

Endereços: https://partitura-live-2jo.web.app e https://partitura-live-2jo.firebaseapp.com

**Alternativa — GitHub Pages:** o workflow `.github/workflows/deploy.yml` (execução manual em *Actions → Deploy (GitHub Pages) → Run workflow*) publica em `https://gustavo-1.github.io/partitura-live/`. Antes, ative *Settings → Pages → Source: GitHub Actions* e adicione `gustavo-1.github.io` aos domínios autorizados do Firebase Authentication.

---

## Conta, dados e amigos

### Onde ficam os seus dados

| Situação | Onde fica | O que acontece |
|---|---|---|
| **Sem login** | Só no navegador deste aparelho (localStorage + IndexedDB) | Funciona 100% offline. Se limpar os dados do navegador ou trocar de aparelho, perde. |
| **Com login** | Na sua conta no Firestore (`users/{uid}`) + cópia no aparelho | Tudo sincroniza sozinho entre aparelhos e funciona offline (envia quando voltar a internet). O que você fez antes do login é **somado** à conta. |
| **Ao sair da conta** | Continua na nuvem | A cópia deste aparelho é apagada (bom para aparelhos compartilhados). Ao entrar de novo, tudo volta. |
| **Excluir conta** | — | Apaga progresso, músicas, amizades, mensagens e o login (Perfil → Excluir conta). |

O que vai para a conta: lições e estrelas, músicas praticadas e etapas do plano de estudo, estatísticas de leitura, tempo de prática, XP, medalhas, preferências e as **músicas importadas** (compactadas em `users/{uid}/songs`).

**O que os amigos veem** (`profiles/{uid}`): nome, avatar, XP, sequência, lições concluídas, medalhas, recordes por música e atividades recentes. E-mail e progresso detalhado nunca são compartilhados.

### Estrutura no Firestore

```
users/{uid}                 progresso + preferências (só o dono)
users/{uid}/songs/{id}      músicas importadas, gzip (só o dono)
users/{uid}/inbox/{id}      mensagens: aplauso, texto, desafio, música (amigos criam; dono lê/apaga)
profiles/{uid}              resumo público (usuário logado lê um por vez; ninguém lista)
friendCodes/{CODIGO}        código de amigo → uid (consulta exata; ninguém lista)
friendRequests/{de_para}    pedidos de amizade
friendships/{a_b}           amizades (só quem recebeu o pedido pode aceitar)
```

As regras estão em [`firestore.rules`](firestore.rules) e têm testes automáticos (`npm run test:rules`, usa o emulador).

### Projeto Firebase

Projeto `partitura-live-2jo`, já com app web registrado (configuração pública em `.env.production`) e Firestore em `southamerica-east1` (São Paulo).

**Ative os métodos de login** em https://console.firebase.google.com/project/partitura-live-2jo/authentication/providers :

1. **Google** → Ativar → e-mail de suporte → Salvar.
2. **E-mail/senha** → Ativar → Salvar.

> A `apiKey` do Firebase para web não é secreta — quem protege os dados são as regras do Firestore. Para usar outro projeto, troque `.firebaserc` e `.env.production` (ou cole a configuração em *Configurações → Avançado*).

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
  lib/         roteador, store, IndexedDB, Firebase (conta, sincronização, amigos, músicas na nuvem)
public/        ícones, manifesto PWA, service worker, amostras de piano
tests/         testes (notação, importadores, currículo, mesclagem, detector)
```

As músicas e exercícios embutidos usam uma notação textual compacta (`src/music/notation.ts`), por exemplo:

```
rh: 'E4q@3 E4 F4@4 G4@5 | G4 F4 E4 D4 | C4 C4 D4 E4 | E4q. D4e D4h'
lh: 'C3w@5 | G3w@1 | (C3 E3 G3)w | ...'
```

`q`/`h`/`w`/`e`/`s` = semínima/mínima/semibreve/colcheia/semicolcheia, `.` = ponto, `@3` = dedo, `~` = ligadura, `(…)` = acorde, `rq` = pausa, `R` = compasso de pausa.

### Testes ponta a ponta

Veja [`e2e/README.md`](e2e/README.md): simulam duas pessoas usando o app (contas, amizade, ranking, desafios, músicas na nuvem) com os emuladores do Firebase.

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
