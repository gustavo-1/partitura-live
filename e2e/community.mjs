// Biblioteca compartilhada: o que uma pessoa importa aparece para todos com conta (mesmo sem serem amigos).
import { chromium } from 'playwright';
const BASE = process.env.BASE ?? 'http://localhost:5174/';
const SHOTS = process.env.SHOTS ?? '';
const FIX = new URL('../tests/fixtures/simple.musicxml', import.meta.url).pathname;
const stamp = Date.now().toString(36);
const browser = await chromium.launch();
const log = (...a) => console.log(...a);
const errors = [];
let ok = true;
const check = (cond, msg) => {
  log((cond ? '✓ ' : '✗ ') + msg);
  if (!cond) ok = false;
};
async function user(name) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  await ctx.addInitScript(() => {
    if (!localStorage.getItem('pl.settings')) localStorage.setItem('pl.settings', JSON.stringify({ onboarded: true }));
  });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (e) => errors.push(`[${name}] ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('favicon')) errors.push(`[${name} console] ${m.text()}`);
  });
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
}

// visitante: vê o convite para entrar
const guest = await user('Visitante');
await guest.page.goto(BASE + '#/musicas');
check(!!(await guest.page.waitForSelector('text=Entre na sua conta para ver e tocar', { timeout: 10000 }).catch(() => null)), 'visitante vê o convite para entrar na seção da comunidade');

// nomes únicos por execução (o emulador pode guardar dados de rodadas anteriores)
const EVA = `Eva ${stamp.slice(-4)}`;
const eva = await user(EVA);
const davi = await user('Davi');
await signUp(eva, `eva-${stamp}@teste.com`);
await signUp(davi, `davi-${stamp}@teste.com`);

// Eva importa: vai para a biblioteca de todos
await eva.page.goto(BASE + '#/musicas');
await eva.page.waitForSelector('text=Compartilhar com todos', { timeout: 10000 });
await eva.page.setInputFiles('input[type=file]', FIX);
await eva.page.waitForSelector('h1:has-text("Teste Duas Pautas")', { timeout: 15000 });
check(true, 'Eva importou a partitura');

// Davi (que nem é amigo da Eva) vê e abre
await davi.page.goto(BASE + '#/musicas');
const CARD = `.lib-item:has-text("Teste Duas Pautas"):has-text("${EVA}")`;
const card = await davi.page.waitForSelector(CARD, { timeout: 15000 }).catch(() => null);
check(!!card, 'Davi vê a música na seção “Da comunidade”');
check(await davi.page.isVisible(`${CARD} >> text=Adicionada por`), 'mostra quem adicionou');
check(!(await davi.page.isVisible(`${CARD} .lib-action`)), 'Davi não pode remover a música da Eva');
if (SHOTS) {
  await davi.page.click('.chip-btn:has-text("Da comunidade")');
  await davi.page.screenshot({ path: `${SHOTS}/m-comunidade.png`, fullPage: true });
  await davi.page.click('.chip-btn:has-text("Todas")');
}
await davi.page.click(`${CARD} .song-card`);
await davi.page.waitForSelector('h1:has-text("Teste Duas Pautas")', { timeout: 15000 });
check(true, 'Davi abre a página da música (plano de estudo)');
await davi.page.goto(BASE + '#/tocar/' + encodeURIComponent((await davi.page.evaluate(() => decodeURIComponent(location.hash.split('/')[2] ?? '')))) + '?mode=wait');
check(!!(await davi.page.waitForSelector('.score svg', { timeout: 20000 }).catch(() => null)), 'Davi abre a partitura para praticar');

// link direto (recarregando a página) também funciona
await davi.page.reload();
check(!!(await davi.page.waitForSelector('.score svg', { timeout: 20000 }).catch(() => null)), 'link direto para a música da comunidade funciona após recarregar');

// filtro e busca
await davi.page.goto(BASE + '#/musicas');
await davi.page.click('.chip-btn:has-text("Da comunidade")');
await davi.page.fill('input[aria-label="Buscar música"]', EVA.toLowerCase());
check(await davi.page.isVisible(CARD), 'busca pelo nome de quem adicionou');

// Eva tira da comunidade: some para o Davi em tempo real
await eva.page.goto(BASE + '#/musicas');
await eva.page.click('.chip-btn:has-text("Da comunidade")');
await eva.page.click('.lib-item:has-text("Teste Duas Pautas") .lib-action');
await davi.page.waitForSelector(CARD, { state: 'detached', timeout: 10000 }).catch(() => null);
check(!(await davi.page.isVisible(CARD)), 'quando a Eva tira a música, ela some para o Davi');
await eva.page.click('.chip-btn:has-text("Todas")');
check(await eva.page.isVisible('.lib-status button:has-text("Compartilhar com todos")'), 'continua nas músicas importadas da Eva, com o botão para compartilhar de novo');
await eva.page.click('.lib-status button:has-text("Compartilhar com todos")');
await davi.page.fill('input[aria-label="Buscar música"]', '');
await davi.page.waitForSelector(CARD, { timeout: 10000 }).catch(() => null);
check(await davi.page.isVisible(CARD), 'compartilhar de novo pelo botão funciona');

log(errors.length ? 'ERROS:\n' + errors.join('\n') : 'sem erros no console');
await browser.close();
process.exit(ok && !errors.length ? 0 : 1);
