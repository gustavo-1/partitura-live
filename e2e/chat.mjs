// Chat em tempo real entre dois amigos (emuladores): digitando, entrega, visto, reações,
// lista de conversas com não lidas, aviso de mensagem nova e desafio pelo chat.
import { chromium } from 'playwright';
const BASE = process.env.BASE ?? 'http://localhost:5174/';
const SHOTS = process.env.SHOTS ?? '';
const stamp = Date.now().toString(36);
const browser = await chromium.launch();
const log = (...a) => console.log(...a);
const errors = [];
let ok = true;
const check = (cond, msg) => {
  log((cond ? '✓ ' : '✗ ') + msg);
  if (!cond) ok = false;
};
async function user(name, viewport = { width: 390, height: 844 }) {
  const ctx = await browser.newContext({ viewport, hasTouch: false });
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
  return (await u.page.textContent('.code-box')).trim();
}
const shot = async (u, name) => SHOTS && u.page.screenshot({ path: `${SHOTS}/${name}.png` });

const ana = await user('Ana Clara');
const beto = await user('Beto', { width: 1280, height: 820 });
const codeA = await signUp(ana, `ana-${stamp}@teste.com`);
await signUp(beto, `beto-${stamp}@teste.com`);

// amizade
await beto.page.goto(BASE + '#/amigos?aba=friends');
await beto.page.fill('input[aria-label="Código do amigo"]', codeA);
await beto.page.click('button:has-text("Adicionar")');
await beto.page.waitForSelector('text=Pedido enviado', { timeout: 10000 });
await ana.page.goto(BASE + '#/amigos');
await ana.page.waitForSelector('text=quer ser seu amigo', { timeout: 15000 });
await ana.page.click('button:has-text("Aceitar")');
await ana.page.click('button[role=tab]:has-text("Conversas")');
await ana.page.waitForSelector('.conv-row:has-text("Beto")', { timeout: 15000 });
await shot(ana, 'm-conversas-vazia');

// os dois abrem a conversa
await ana.page.click('.conv-row:has-text("Beto")');
await ana.page.waitForSelector('.chat-composer textarea', { timeout: 10000 });
check(!!(await ana.page.waitForSelector('text=Diga oi para Beto', { timeout: 8000 }).catch(() => null)), 'conversa nova mostra o convite para dizer oi');
await beto.page.goto(BASE + '#/amigos?aba=conversas');
await beto.page.click('.conv-row:has-text("Ana")');
await beto.page.waitForSelector('.chat-composer textarea', { timeout: 10000 });
await beto.page.waitForTimeout(800);

// presença e digitando
await ana.page.waitForSelector('.online-text', { timeout: 10000 }).catch(() => null);
check(await ana.page.isVisible('.online-text'), 'Ana vê que Beto está na conversa agora');
await ana.page.fill('.chat-composer textarea', 'Oi Beto! Bora praticar hoje?');
await beto.page.waitForSelector('.typing-bubble', { timeout: 8000 }).catch(() => null);
check(await beto.page.isVisible('.typing-bubble'), 'Beto vê "digitando…" em tempo real');
const t0 = Date.now();
await ana.page.keyboard.press('Enter');
await beto.page.waitForSelector('.bubble-row.theirs .bubble:has-text("Bora praticar")', { timeout: 8000 });
check(true, `mensagem chegou para o Beto em ${Date.now() - t0} ms`);
check(!(await beto.page.isVisible('.typing-bubble')), '"digitando…" some quando a mensagem chega');
check((await ana.page.inputValue('.chat-composer textarea')) === '', 'caixa de texto limpa depois de enviar');

// visto
await ana.page.waitForSelector('.tick.seen', { timeout: 8000 }).catch(() => null);
check(await ana.page.isVisible('.tick.seen'), 'Ana vê ✓✓ (visto) porque Beto está com a conversa aberta');
check(await ana.page.isVisible('.chat-seen'), 'aparece "Visto às …" sob a última mensagem');

// resposta e reação
await beto.page.fill('.chat-composer textarea', 'Bora! Vou fazer a revisão do dia agora 🎹');
await beto.page.click('.send-btn');
await ana.page.waitForSelector('.bubble-row.theirs .bubble:has-text("revisão do dia")', { timeout: 8000 });
check(true, 'Ana recebe a resposta');
await ana.page.click('.bubble-row.theirs .bubble:has-text("revisão do dia")');
await ana.page.click('.react-bar button[aria-label="Reagir com 🔥"]');
await beto.page.waitForSelector('.bubble-reacts:has-text("🔥")', { timeout: 8000 });
check(true, 'Beto vê a reação 🔥 da Ana');
await shot(ana, 'm-chat');
await shot(beto, 'd-chat');

// Beto sai da conversa: mensagem nova vira não lida + aviso
await beto.page.goto(BASE + '#/');
await beto.page.waitForTimeout(600);
await ana.page.fill('.chat-composer textarea', 'Te mandei um desafio!');
await ana.page.keyboard.press('Enter');
await beto.page.waitForSelector('.chat-toast:has-text("Te mandei")', { timeout: 8000 }).catch(() => null);
check(await beto.page.isVisible('.chat-toast'), 'Beto recebe o aviso de mensagem nova fora da conversa');
await shot(beto, 'd-toast');
const badge = await beto.page.textContent('.sidebar .nav-badge').catch(() => null);
check(badge === '1', `selo de não lidas no menu = ${badge}`);
const title = await beto.page.title();
check(title.startsWith('(1)'), `título da aba mostra não lidas: "${title}"`);
await beto.page.goto(BASE + '#/amigos?aba=conversas');
await beto.page.waitForSelector('.conv-row.unread .count-badge', { timeout: 8000 });
check((await beto.page.textContent('.conv-row.unread .count-badge')).trim() === '1', 'lista de conversas mostra 1 não lida');
await shot(beto, 'd-conversas');
await beto.page.click('.conv-row:has-text("Ana")');
await beto.page.waitForSelector('.bubble:has-text("Te mandei um desafio")', { timeout: 8000 });
await beto.page.waitForTimeout(800);
const badge2 = await beto.page.textContent('.sidebar .nav-badge').catch(() => null);
check(!badge2, 'abrir a conversa zera as não lidas');

// Ana toca uma música e desafia o Beto pelo chat
await ana.page.goto(BASE + '#/tocar/maria-carneirinho?mode=wait');
await ana.page.waitForSelector('.score svg', { timeout: 20000 });
for (const k of 'D S A S D D D S S S D G G D S A S D D D D S S D S A'.split(' ')) {
  await ana.page.keyboard.press('Key' + k);
  await ana.page.waitForTimeout(120);
}
await ana.page.waitForSelector('.result-hero', { timeout: 15000 });
await ana.page.goto(BASE + '#/amigos?aba=conversas');
await ana.page.click('.conv-row:has-text("Beto")');
await ana.page.click('.chip-btn:has-text("Desafiar")');
await ana.page.click('.sheet .pick-row:has-text("Maria")');
await beto.page.waitForSelector('.bubble.challenge button:has-text("Aceitar desafio")', { timeout: 8000 });
check(true, 'Beto recebe o cartão de desafio na conversa');
await beto.page.click('.bubble.challenge button:has-text("Aceitar desafio")');
await beto.page.waitForSelector('.challenge-banner', { timeout: 15000 });
check(true, 'aceitar o desafio abre a música com a meta da Ana');

// mensagens continuam depois de recarregar
await ana.page.reload();
await ana.page.waitForSelector('.bubble:has-text("Bora praticar")', { timeout: 15000 });
check(true, 'histórico continua após recarregar');

log(errors.length ? 'ERROS:\n' + errors.join('\n') : 'sem erros no console');
await browser.close();
process.exit(ok && !errors.length ? 0 : 1);
