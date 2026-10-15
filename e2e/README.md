# Testes ponta a ponta (navegador)

Simulam pessoas usando o app num Chromium real, com login e banco de dados nos **emuladores do Firebase** (nada toca o projeto de produção).

```bash
npm i -D playwright && npx playwright install chromium   # uma vez
firebase emulators:start --only auth,firestore --project demo-partitura   # terminal 1
VITE_FIREBASE_EMULATOR=1 VITE_FIREBASE_CONFIG='{"apiKey":"demo-key","authDomain":"demo-partitura.firebaseapp.com","projectId":"demo-partitura","appId":"1:1:web:demo"}' npx vite --port 5174   # terminal 2
node e2e/social.mjs        # Alice e Bob: contas, amizade, liga, feed, aplauso, desafio, sair/entrar
node e2e/chat.mjs          # Ana (celular) e Beto (computador): chat em tempo real, digitando, visto, reações, avisos, desafio pelo chat
node e2e/community.mjs     # Eva importa uma partitura; Davi (sem ser amigo) vê, abre e pratica; Eva tira e compartilha de novo
node e2e/cloud-songs.mjs   # visitante importa partitura, cria conta, música chega em outro aparelho e é enviada a uma amiga
```

Os scripts criam contas com e-mails novos a cada execução. `e2e/chat.mjs` termina com código 1 se alguma verificação falhar; defina `SHOTS=pasta` para salvar capturas de tela.
