# Testes ponta a ponta (navegador)

Simulam pessoas usando o app num Chromium real, com login e banco de dados nos **emuladores do Firebase** (nada toca o projeto de produção).

```bash
npm i -D playwright && npx playwright install chromium   # uma vez
firebase emulators:start --only auth,firestore --project demo-partitura   # terminal 1
VITE_FIREBASE_EMULATOR=1 VITE_FIREBASE_CONFIG='{"apiKey":"demo-key","authDomain":"demo-partitura.firebaseapp.com","projectId":"demo-partitura","appId":"1:1:web:demo"}' npx vite --port 5174   # terminal 2
node e2e/social.mjs        # Alice e Bob: contas, amizade, ranking, feed, aplauso, desafio, sair/entrar
node e2e/cloud-songs.mjs   # visitante importa partitura, cria conta, música chega em outro aparelho e é enviada a uma amiga
```

Entre execuções, limpe os emuladores (ou reinicie-os), pois as contas de teste são criadas com e-mails fixos.
