import { chromium } from 'playwright';
const BASE = 'http://localhost:5174/';
const FIX = new URL('../tests/fixtures/simple.musicxml', import.meta.url).pathname;
const browser = await chromium.launch();
const log = (...a) => console.log(...a);
const errors = [];
async function user(name) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  await ctx.addInitScript(() => { if (!localStorage.getItem('pl.settings')) localStorage.setItem('pl.settings', JSON.stringify({ onboarded: true })); });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (e) => errors.push(`[${name}] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${name} console] ${m.text()}`); });
  return { ctx, page, name };
}
async function login(u, email, pass = 'segredo123') {
  await u.page.goto(BASE + '#/perfil');
  await u.page.click('text=Entrar com e-mail');
  await u.page.fill('input[type=email]', email);
  await u.page.fill('input[type=password]', pass);
  await u.page.click('form button.btn.primary');
  await u.page.waitForSelector('.code-box', { timeout: 20000 });
  return (await u.page.textContent('.code-box')).trim();
}
// 1) Carol como visitante: importa uma partitura e pratica
const carol = await user('Carol');
await carol.page.goto(BASE + '#/musicas');
await carol.page.setInputFiles('input[type=file]', FIX);
await carol.page.waitForSelector('h1:has-text("Teste Duas Pautas")', { timeout: 15000 });
log('Carol (visitante) importou a partitura');
await carol.page.goto(BASE + '#/');
const banner = await carol.page.isVisible('text=Seu progresso está só neste aparelho').catch(() => false);
// cria a conta
await carol.page.goto(BASE + '#/perfil');
await carol.page.click('text=Entrar com e-mail');
await carol.page.click('text=Não tenho conta — criar');
await carol.page.fill('input[placeholder="Seu nome"]', 'Carol');
await carol.page.fill('input[type=email]', 'carol@teste.com');
await carol.page.fill('input[type=password]', 'segredo123');
await carol.page.click('button:has-text("Criar conta")');
await carol.page.waitForSelector('.code-box', { timeout: 20000 });
await carol.page.waitForTimeout(3000);
log('Carol criou conta; aviso "só neste aparelho" antes do login:', banner);

// 2) Outro aparelho da Carol: a música vem da nuvem
const carol2 = await user('Carol-2');
await login(carol2, 'carol@teste.com');
await carol2.page.goto(BASE + '#/musicas');
await carol2.page.waitForSelector('.song-card h3:has-text("Teste Duas Pautas")', { timeout: 20000 });
log('Outro aparelho da Carol: música importada chegou pela nuvem ✓');

// 3) Alice (já existente) vira amiga da Carol e recebe a música
const alice = await user('Alice');
const codeA = await login(alice, 'alice@teste.com');
await carol.page.goto(BASE + '#/amigos');
await carol.page.fill('input[aria-label="Código do amigo"]', codeA);
await carol.page.click('button:has-text("Adicionar")');
await carol.page.waitForSelector('text=Pedido enviado', { timeout: 10000 });
await alice.page.goto(BASE + '#/amigos');
await alice.page.waitForSelector('text=quer ser seu amigo', { timeout: 15000 });
await alice.page.click('.person-row:has-text("Carol") button:has-text("Aceitar")');
log('Alice aceitou Carol');
// Carol envia a música
await carol.page.goto(BASE + '#/musicas');
await carol.page.click('.song-card:has-text("Teste Duas Pautas")');
await carol.page.waitForSelector('button:has-text("Enviar esta música")', { timeout: 20000 });
await carol.page.waitForFunction(() => !document.querySelector('button.btn.sm.ghost:disabled'), null, { timeout: 15000 }).catch(() => {});
await carol.page.click('button:has-text("Enviar esta música")');
await carol.page.click('.sheet .person-row:has-text("Alice")');
await carol.page.waitForSelector('text=Música enviada', { timeout: 15000 });
log('Carol enviou a música para Alice');
await alice.page.goto(BASE + '#/amigos?aba=msgs');
await alice.page.waitForSelector('button:has-text("Adicionar às minhas músicas")', { timeout: 15000 });
await alice.page.click('button:has-text("Adicionar às minhas músicas")');
await alice.page.waitForSelector('text=Adicionada às suas músicas', { timeout: 10000 });
await alice.page.goto(BASE + '#/musicas');
await alice.page.waitForSelector('.song-card h3:has-text("Teste Duas Pautas")', { timeout: 15000 });
log('Alice tem a música na biblioteca ✓');
log(errors.length ? 'ERROS:\n' + errors.join('\n') : 'sem erros no console');
await browser.close();
