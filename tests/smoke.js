// Testes de fumo: correm no GitHub antes de publicar.
// Uso: node tests/smoke.js http://localhost:8000/avaliador-albuns-v2.html
const { chromium } = require('playwright');

const url = process.argv[2] || 'http://localhost:8000/avaliador-albuns-v2.html';
let failed = 0;
const ok = (name) => console.log('ok   ', name);
const fail = (name, why) => { failed++; console.log('FAIL ', name, '-', why); };

(async () => {
  const browser = await chromium.launch();
  for (const vp of [{ name: 'telemóvel', width: 390, height: 844 }, { name: 'computador', width: 1280, height: 860 }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    await ctx.addInitScript(() => { try { localStorage.setItem('music-tracker-terms', '1'); } catch (e) {} });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    // Sem rede externa: os pedidos ao iTunes e ao MusicBrainz são bloqueados de propósito.
    await page.route('**/*', (r) => (r.request().url().startsWith(new URL(url).origin) ? r.continue() : r.abort()));

    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    await page.evaluate(() => { window.authGate = false; closeModal(); });

    const ovf = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    ovf === 0 ? ok(`${vp.name}: sem scroll horizontal`) : fail(`${vp.name}: scroll horizontal`, `${ovf}px`);

    errors.length === 0 ? ok(`${vp.name}: sem erros de JavaScript`) : fail(`${vp.name}: erros`, errors.join(' | '));

    for (const view of ['view-library', 'view-profile', 'view-catalog']) {
      await page.evaluate((v) => document.querySelectorAll('section[id^=view-]').forEach((s) => s.classList.toggle('hidden', s.id !== v)), view);
      await page.waitForTimeout(150);
      const o = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      o === 0 ? ok(`${vp.name}: ${view} sem scroll horizontal`) : fail(`${vp.name}: ${view}`, `${o}px`);
    }
    await ctx.close();
  }
  await browser.close();
  if (failed) { console.log(`\n${failed} falha(s)`); process.exit(1); }
  console.log('\nTudo ok');
})().catch((e) => { console.error(e); process.exit(1); });
