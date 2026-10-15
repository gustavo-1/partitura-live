/**
 * Importação de MIDI com vários instrumentos (visitante, sem nuvem): escolha de trilhas, relatório de fidelidade,
 * comparação original × convertida, refazer com outras trilhas e andamento digitado no player.
 */
import { chromium } from 'playwright';
const BASE = process.env.BASE ?? 'http://localhost:5174/';
const FIX = new URL('../tests/fixtures/trilha-teste.mid', import.meta.url).pathname;
let failed = 0;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
await ctx.addInitScript(() => {
  if (!localStorage.getItem('pl.settings')) localStorage.setItem('pl.settings', JSON.stringify({ onboarded: true }));
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text());
});
const ok = (c, msg) => {
  if (!c) failed++;
  console.log((c ? '✓ ' : '✗ ') + msg);
};
await page.goto(BASE + '#/musicas');
await page.setInputFiles('input[type=file]', FIX);
await page.waitForSelector('.track-row', { timeout: 15000 });
const rows = await page.$$eval('.track-row', (rs) => rs.map((r) => ({ t: r.querySelector('b')?.textContent, on: r.classList.contains('on') })));
ok(rows.length === 5, 'picker lista 5 trilhas');
ok(
  rows
    .filter((r) => r.on)
    .map((r) => r.t)
    .join() === 'Piano',
  'sugestão: só o piano',
);
ok(await page.isVisible('.fidelity'), 'linha de fidelidade aparece');
console.log('fidelity:', (await page.textContent('.fidelity')).replace(/\s+/g, ' '));
// ouve a trilha "Melody", inclui a melodia como MD
await page.click('.track-row:has-text("Melody") button[aria-label^="Ouvir"]');
await page.waitForTimeout(600);
await page.click('.track-row:has-text("Melody") input[type=checkbox]');
await page.click('.track-row:has-text("Melody") .seg button:has-text("MD")');
await page.click('.track-row:has-text("Piano") .seg button:has-text("ME")');
await page.click('button:has-text("Original")');
await page.waitForTimeout(500);
await page.click('button:has-text("Como vai ficar")');
await page.waitForTimeout(500);
console.log('fidelity 2:', (await page.textContent('.fidelity')).replace(/\s+/g, ' '));
await page.click('.sheet button.btn.primary:has-text("Importar")');
await page.waitForSelector('h2:has-text("Conversão do arquivo")', { timeout: 15000 });
ok(true, 'página da música com a conversão');
console.log('chips:', await page.$$eval('.card .chip', (cs) => cs.map((c) => c.textContent).join(' | ')));
await page.click('button:has-text("Arquivo original")');
await page.waitForTimeout(700);
ok(await page.isVisible('button:has-text("Arquivo original") svg'), 'botão original tocando');
await page.click('button:has-text("Partitura convertida")');
await page.waitForTimeout(500);
// trilhas e mãos (reconverter)
await page.click('button:has-text("Trilhas e mãos")');
await page.waitForSelector('.track-row');
const rows2 = await page.$$eval('.track-row.on b', (bs) => bs.map((b) => b.textContent));
ok(rows2.join() === 'Piano,Melody', 'reabre com a escolha salva: ' + rows2.join());
await page.click('.track-row:has-text("Bass") input[type=checkbox]');
await page.click('.track-row:has-text("Bass") .seg button:has-text("ME")');
await page.click('.sheet button.btn.primary:has-text("Refazer partitura")');
await page.waitForSelector('text=Partitura refeita', { timeout: 10000 });
ok(true, 'partitura refeita');
console.log('fidelity 3:', (await page.textContent('.fidelity')).replace(/\s+/g, ' '));
// player: BPM digitado
const url = page.url().replace('#/musica/', '#/tocar/');
await page.goto(url);
await page.waitForSelector('.bpm-input input');
const v0 = await page.inputValue('.bpm-input input');
await page.click('.bpm-input input');
await page.fill('.bpm-input input', '77');
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
const v1 = await page.inputValue('.bpm-input input');
ok(v1 === '77', `BPM digitado: ${v0} → ${v1}`);
await page.click('.bpm-input input');
await page.fill('.bpm-input input', '1000');
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
ok((await page.inputValue('.bpm-input input')) === '300', 'limite 300: ' + (await page.inputValue('.bpm-input input')));
await page.click('button[aria-label="5 bpm mais devagar"]');
ok((await page.inputValue('.bpm-input input')) === '295', '−5 → ' + (await page.inputValue('.bpm-input input')));
// opções: aviso de que a música muda de andamento
await page.click('button[aria-label="Opções"]');
await page.waitForSelector('.sheet .field');
if (await page.isVisible('.sheet .field').catch(() => false))
  ok((await page.textContent('.sheet .field')).includes('muda de andamento'), 'opções avisam que o andamento varia');
ok(errors.length === 0, 'sem erros na página' + (errors.length ? ': ' + errors.join(' | ') : ''));
await browser.close();
process.exit(failed ? 1 : 0);
