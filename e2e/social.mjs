import { chromium } from 'playwright';
const BASE = 'http://localhost:5174/';
const browser = await chromium.launch();
const log = (...a) => console.log(...a);
const errors = [];
async function user(name) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  await ctx.addInitScript(() => { if (!localStorage.getItem('pl.settings')) localStorage.setItem('pl.settings', JSON.stringify({ onboarded: true })); });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (e) => errors.push(`[${name}] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('favicon')) errors.push(`[${name} console] ${m.text()}`); });
  return { ctx, page, name };
}
async function signUp(u, email) {
  await u.page.goto(BASE + '#/perfil');
  await u.page.click('text=Entrar com e-mail');
  await u.page.click('text=Não tenho conta — criar');
  await u.page.fill('input[placeholder="Seu nome"]', u.name);
  await u.page.fill('input[type=email]', email);
  await u.page.fill('input[type=password]', 'segredo123');
  await u.page.click('button:has-text("Criar conta")');
  await u.page.waitForSelector('.code-box', { timeout: 20000 });
  return (await u.page.textContent('.code-box')).trim();
}
const alice = await user('Alice');
const bob = await user('Bob');

// 1) contas
const stamp = Date.now().toString(36);
const codeA = await signUp(alice, `alice-${stamp}@teste.com`);
const codeB = await signUp(bob, `bob-${stamp}@teste.com`);
log('códigos', codeA, codeB);

// 2) Alice toca uma música antes (gera atividade/medalha) usando o teclado do computador
await alice.page.goto(BASE + '#/tocar/maria-carneirinho?mode=wait');
await alice.page.waitForSelector('.score svg', { timeout: 20000 });
const seq = 'D S A S D D D S S S D G G D S A S D D D D S S D S A';
for (const k of seq.split(' ')) { await alice.page.keyboard.press('Key' + k); await alice.page.waitForTimeout(140); }
await alice.page.waitForSelector('.result-hero', { timeout: 15000 });
log('Alice resultado:', (await alice.page.textContent('.result-hero .big')).trim());

// 3) Bob adiciona Alice pelo código
await bob.page.goto(BASE + '#/amigos?aba=friends');
await bob.page.fill('input[aria-label="Código do amigo"]', codeA);
await bob.page.click('button:has-text("Adicionar")');
await bob.page.waitForSelector('text=Pedido enviado', { timeout: 10000 });
log('Bob: pedido enviado');

// 4) Alice aceita
await alice.page.goto(BASE + '#/amigos');
await alice.page.waitForSelector('text=quer ser seu amigo', { timeout: 15000 });
const badge = await alice.page.textContent('.bottom-nav .nav-badge').catch(() => null);
log('Alice: selo no menu =', badge);
await alice.page.click('button:has-text("Aceitar")');
await alice.page.click('button[role=tab]:has-text("Amigos")');
await alice.page.waitForSelector('.person-row b:has-text("Bob")', { timeout: 15000 });
log('Alice vê Bob na lista de amigos');

// 5) Bob vê o ranking e a atividade da Alice e aplaude
await bob.page.click('button[role=tab]:has-text("Liga da semana")');
await bob.page.waitForSelector('.person-row b:has-text("Alice")', { timeout: 25000 }); await bob.page.waitForTimeout(5000);
const ranking = await bob.page.$$eval('.league-head + .card .person-row', (rows) => rows.map((r) => r.innerText.replace(/\n+/g, ' | ')));
log('Ranking visto pelo Bob:', ranking);
await bob.page.click('button[role=tab]:has-text("Atividade")');
await bob.page.waitForSelector('.feed-item', { timeout: 25000 });
const feed = await bob.page.$$eval('.feed-item .txt', (els) => els.map((e) => e.innerText.replace(/\n+/g, ' | ')));
log('Feed do Bob:', feed);
await bob.page.click('.feed-item button:has-text("👏")');

// 6) Alice desafia Bob na música
await alice.page.goto(BASE + '#/musica/maria-carneirinho');
await alice.page.waitForSelector('text=Com amigos', { timeout: 15000 });
await alice.page.click('button:has-text("Desafiar um amigo")');
await alice.page.click('.sheet .person-row:has-text("Bob")');
await alice.page.waitForSelector('text=Desafio enviado', { timeout: 10000 });
log('Alice: desafio enviado');

// 7) Alice recebeu o aplauso na conversa com o Bob
await alice.page.goto(BASE + '#/amigos?aba=conversas');
await alice.page.waitForSelector('.conv-row:has-text("Bob")', { timeout: 15000 });
await alice.page.click('.conv-row:has-text("Bob")');
await alice.page.waitForSelector('.bubble', { timeout: 15000 });
log('Conversa da Alice:', await alice.page.$$eval('.bubble', (els) => els.map((e) => e.innerText.replace(/\n+/g, ' | '))));

// 8) Bob aceita o desafio pela conversa
await bob.page.goto(BASE + '#/amigos?aba=conversas');
await bob.page.click('.conv-row:has-text("Alice")');
await bob.page.waitForSelector('button:has-text("Aceitar desafio")', { timeout: 15000 });
await bob.page.click('button:has-text("Aceitar desafio")');
await bob.page.waitForSelector('.challenge-banner', { timeout: 15000 });
log('Bob no desafio:', (await bob.page.textContent('.challenge-banner')).trim());

// 9) sessão persiste após recarregar; sair limpa o aparelho; entrar recupera
await alice.page.goto(BASE + '#/perfil');
await alice.page.reload();
await alice.page.waitForSelector('.code-box', { timeout: 20000 });
const xpBefore = await alice.page.$eval('.level-card .tiny', (b) => b.textContent.split(' XP')[0]);
log('Alice continua logada após recarregar; XP:', xpBefore);
await alice.page.click('button:has-text("Sair")');
await alice.page.waitForSelector('text=Entrar com Google', { timeout: 15000 });
const xpOut = await alice.page.$eval('.level-card .tiny', (b) => b.textContent.split(' XP')[0]);
await alice.page.click('text=Entrar com e-mail');
await alice.page.fill('input[type=email]', `alice-${stamp}@teste.com`);
await alice.page.fill('input[type=password]', 'segredo123');
await alice.page.click('form button.btn.primary');
await alice.page.waitForSelector('.code-box', { timeout: 20000 });
await alice.page.waitForTimeout(1500);
const xpIn = await alice.page.$eval('.level-card .tiny', (b) => b.textContent.split(' XP')[0]);
log(`XP: antes de sair=${xpBefore}, depois de sair=${xpOut}, ao entrar de novo=${xpIn}`);

await bob.page.goto(BASE + '#/amigos');
await bob.page.waitForTimeout(1200);

log(errors.length ? 'ERROS:\n' + errors.join('\n') : 'sem erros no console');
await browser.close();
