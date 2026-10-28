// Phone layout check for WebKit (iPhone) and Chromium (Android widths).
//
//   npm install playwright && npx playwright install webkit chromium
//   node scripts/phone-layout.mjs
//
// iPhone runs simulate a home-screen safe area (Dynamic Island + home
// indicator) by overriding the CSS variables that are normally
// env(safe-area-inset-*). Android runs leave those at 0.
// Screenshots are written to ./phone-shots.

import { chromium, webkit, devices } from 'playwright';
import fs from 'fs';
import path from 'path';

const out = path.resolve('phone-shots');
fs.mkdirSync(out, { recursive: true });

const iphoneUA = devices['iPhone 15'].userAgent;
const deck = {
  cur: 'd1',
  decks: {
    d1: {
      name: 'Phone Deck',
      leader: 'OP18-001',
      cards: { 'OP18-003': 2, 'OP18-010': 1, 'EB05-001': 1 },
      notes: 'keep',
      matches: [{ r: 'W', o: 'Kaido', t: 1 }],
      updated: 1,
    },
  },
};

function seed(insets) {
  const json = JSON.stringify(JSON.stringify(deck));
  const insetJs = insets
    ? `const applyInsets = () => {
        const el = document.documentElement;
        if (!el) return;
        el.style.setProperty('--sat', '${insets.top}px');
        el.style.setProperty('--sab', '${insets.bottom}px');
        el.style.setProperty('--sal', '${insets.left}px');
        el.style.setProperty('--sar', '${insets.right}px');
      };
      applyInsets();
      document.addEventListener('DOMContentLoaded', applyInsets);`
    : '';
  return `${insetJs}
  try {
    localStorage.setItem('optcg_cards_v2', JSON.stringify({ t: Date.now(), d: [{ id: 'OP01-001', name: 'Stub', text: 'x', set: 'Romance Dawn', setId: 'OP-01', rarity: 'C', color: 'Red', type: 'Character', life: null, cost: 1, power: 1000, subs: '', counter: 1000, attr: 'Strike', img: '' }] }));
    localStorage.setItem('optcg_decks_v2', ${json});
  } catch (e) {}`;
}

const fails = [];
function check(cond, msg, extra) {
  if (!cond) fails.push(msg + (extra ? ' ' + JSON.stringify(extra) : ''));
}

async function layout(page) {
  return page.evaluate(() => {
    const iw = innerWidth, ih = innerHeight;
    const cs = getComputedStyle(document.documentElement);
    const sat = parseFloat(cs.getPropertyValue('--sat')) || 0;
    const sab = parseFloat(cs.getPropertyValue('--sab')) || 0;
    const search = document.getElementById('search').getBoundingClientRect();
    const news = document.getElementById('btnNews').getBoundingClientRect();
    const refresh = document.getElementById('btnRefresh').getBoundingClientRect();
    const sort = document.getElementById('sort').getBoundingClientRect();
    const filters = document.getElementById('btnFilters').getBoundingClientRect();
    const deckBtn = document.getElementById('btnDeckPanel').getBoundingClientRect();
    const bar = document.getElementById('topbar');
    const barPad = parseFloat(getComputedStyle(bar).paddingTop);
    const gridPad = parseFloat(getComputedStyle(document.getElementById('grid')).paddingBottom);
    const kids = [search, news, refresh, sort, filters, deckBtn];
    return {
      iw, ih, sat, sab, barPad, gridPad,
      searchTop: Math.round(search.top),
      searchFont: getComputedStyle(document.getElementById('search')).fontSize,
      sortFont: getComputedStyle(document.getElementById('sort')).fontSize,
      taFont: getComputedStyle(document.getElementById('exptext')).fontSize,
      newsTop: Math.round(news.top),
      refreshTop: Math.round(refresh.top),
      sameRow: Math.abs(news.top - refresh.top) < 4 && Math.abs(news.top - sort.top) < 8,
      inside: kids.every(r => r.left >= -1 && r.right <= iw + 1 && r.bottom <= ih + 1),
      overflowX: document.documentElement.scrollWidth > iw + 1,
      capable: document.querySelector('meta[name="apple-mobile-web-app-capable"]')?.content,
      statusBar: document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.content,
      viewport: document.querySelector('meta[name="viewport"]')?.content,
    };
  });
}

async function run(browserType, label, contextOpts, insets, shots) {
  const browser = await browserType.launch();
  const context = await browser.newContext(contextOpts);
  await context.addInitScript(seed(insets));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('#newsList .newsrow').length > 50, { timeout: 20000 });

  const sat = insets ? insets.top : 0;
  const sab = insets ? insets.bottom : 0;

  const newsBox = await page.evaluate(() => {
    const box = document.getElementById('newsbox').getBoundingClientRect();
    const close = document.getElementById('newsClose').getBoundingClientRect();
    const pad = parseFloat(getComputedStyle(document.getElementById('newsbox')).paddingBottom);
    let expected = 0;
    const used = new Set();
    const batches = Array.isArray(window.CARD_NEWS) ? window.CARD_NEWS.slice().reverse() : [];
    for (const b of batches) {
      for (const id of b.ids || []) {
        if (typeof id === 'string' && !used.has(id) && byId.has(id)) { used.add(id); expected++; }
      }
    }
    return {
      closeTop: Math.round(close.top),
      closeIn: close.bottom <= innerHeight + 1 && close.right <= innerWidth + 1 && close.height >= 44,
      boxIn: box.left >= -1 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1,
      pad,
      n: document.querySelectorAll('.newsrow').length,
      expected,
    };
  });
  check(newsBox.n === newsBox.expected && newsBox.n > 0 && newsBox.boxIn && newsBox.closeIn && newsBox.closeTop >= sat - 1 && newsBox.pad + 0.5 >= sab, `${label} announcement clears safe area`, newsBox);
  if (shots.news) await page.screenshot({ path: path.join(out, shots.news) });

  await page.click('#newsClose');
  const main = await layout(page);
  check(!errors.length, `${label} page errors`, errors);
  check(main.capable === 'yes' && main.statusBar === 'black-translucent', `${label} standalone meta`, main);
  check(main.viewport.includes('viewport-fit=cover'), `${label} viewport-fit`, main.viewport);
  check(!main.overflowX && main.inside && main.sameRow, `${label} top bar`, main);
  check(main.searchTop >= sat - 1 && main.barPad + 0.5 >= Math.max(8, sat), `${label} search below status bar`, main);
  check(main.gridPad + 0.5 >= Math.max(8, sab), `${label} grid above home indicator`, main);
  check(parseFloat(main.searchFont) >= 16 && parseFloat(main.sortFont) >= 16 && parseFloat(main.taFont) >= 16, `${label} inputs at least 16px`, main);
  if (shots.main) await page.screenshot({ path: path.join(out, shots.main) });
  console.log(label, 'searchTop', main.searchTop, 'barPad', main.barPad, 'gridPad', main.gridPad, 'fonts', main.searchFont);

  await page.click('#btnNews');
  await page.waitForSelector('#newsList .newsrow');
  await page.evaluate(() => document.querySelector('#newsList .newsrow').click());
  await page.waitForFunction(() => {
    const img = document.querySelector('#modalbox img');
    return img && img.complete && img.naturalWidth > 0;
  });
  const card = await page.evaluate(() => {
    const box = document.getElementById('modalbox').getBoundingClientRect();
    const img = document.querySelector('#modalbox img');
    const ir = img.getBoundingClientRect();
    const close = document.querySelector('.modalclose').getBoundingClientRect();
    return {
      boxIn: box.left >= -1 && box.top >= -1 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1,
      closeTop: Math.round(close.top),
      closeH: Math.round(close.height),
      imgIn: ir.bottom <= box.bottom + 1 && ir.right <= box.right + 1 && ir.height + 20 < img.naturalHeight,
    };
  });
  check(card.boxIn && card.imgIn && card.closeH >= 44 && card.closeTop >= sat - 1, `${label} card dialog`, card);
  if (shots.card) await page.screenshot({ path: path.join(out, shots.card) });
  await page.click('.modalclose');
  await page.click('#newsClose');

  await page.evaluate(() => {
    const row = [...document.querySelectorAll('#decklist .drow')].find(r => r.querySelector('.dname')?.textContent.includes('Chopper'));
    row.click();
  });
  await page.waitForSelector('.decknav-row');
  const swipe = await page.evaluate(() => {
    const prev = document.querySelector('.deckprev').getBoundingClientRect();
    const close = document.querySelector('.modalclose').getBoundingClientRect();
    return { prevTop: Math.round(prev.top), prevH: Math.round(prev.height), closeTop: Math.round(close.top), id: document.getElementById('modalbox').dataset.cardId };
  });
  check(swipe.prevTop >= sat - 1 && swipe.prevH >= 44 && swipe.closeTop >= sat - 1, `${label} deck arrows below status bar`, swipe);
  await page.click('.modalclose');

  await page.click('#btnDeckPanel');
  await page.waitForTimeout(280);
  const drawer = await page.evaluate(() => {
    const back = document.getElementById('btnDeckClose');
    const label = back.querySelector('.panelback-arrow').getBoundingClientRect();
    const foot = document.getElementById('deckfoot').getBoundingClientRect();
    const panel = document.getElementById('deckpanel').getBoundingClientRect();
    const footPad = parseFloat(getComputedStyle(document.getElementById('deckfoot')).paddingBottom);
    return {
      open: panel.left < innerWidth - 20 && panel.right <= innerWidth + 1,
      labelTop: Math.round(label.top),
      footBottom: Math.round(foot.bottom),
      footPad,
      ih: innerHeight,
    };
  });
  check(drawer.open && drawer.labelTop >= sat - 1 && drawer.footBottom <= drawer.ih + 1 && drawer.footPad + 0.5 >= Math.max(10, sab), `${label} deck drawer`, drawer);
  if (shots.deck) await page.screenshot({ path: path.join(out, shots.deck) });
  await page.click('#btnDeckClose');
  await page.waitForTimeout(250);

  await page.click('#btnFilters');
  await page.waitForTimeout(280);
  const filters = await page.evaluate(() => {
    const h = document.querySelector('#sidebar h1').getBoundingClientRect();
    const side = document.getElementById('sidebar').getBoundingClientRect();
    return { top: Math.round(h.top), left: Math.round(side.left), bottomPad: parseFloat(getComputedStyle(document.getElementById('sidebar')).paddingBottom) };
  });
  check(filters.left >= -1 && filters.top >= sat - 1 && filters.bottomPad + 0.5 >= Math.max(14, sab), `${label} filter drawer`, filters);
  await page.evaluate(() => document.getElementById('scrim').click());

  const banner = await page.evaluate(() => {
    const b = document.getElementById('updateBanner');
    b.hidden = false;
    const r = b.getBoundingClientRect();
    const info = { top: Math.round(r.top), bottom: Math.round(r.bottom), ih: innerHeight, iw: innerWidth, right: Math.round(r.right) };
    b.hidden = true;
    return info;
  });
  check(banner.top >= sat - 1 && banner.bottom <= banner.ih - sab + 1 && banner.right <= banner.iw + 1, `${label} update banner`, banner);

  const decks = await page.evaluate(() => localStorage.getItem('optcg_decks_v2'));
  check(decks === JSON.stringify(deck), `${label} decks untouched`);

  await browser.close();
}

const iphone = (w, h, dsf) => ({
  userAgent: iphoneUA,
  viewport: { width: w, height: h },
  deviceScaleFactor: dsf,
  isMobile: true,
  hasTouch: true,
});
const island = { top: 59, bottom: 34, left: 0, right: 0 };

await run(webkit, 'webkit-iphone16', iphone(393, 852, 3), island, {
  news: 'webkit-iphone16-news.png',
  main: 'webkit-iphone16-main.png',
  card: 'webkit-iphone16-card.png',
  deck: 'webkit-iphone16-deck.png',
});
await run(webkit, 'webkit-iphone15', { ...devices['iPhone 15'] }, island, {});
await run(webkit, 'webkit-se', iphone(375, 667, 2), { top: 20, bottom: 0, left: 0, right: 0 }, {});
await run(webkit, 'webkit-promax', iphone(430, 932, 3), island, {});
const android = (w, h) => ({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await run(chromium, 'chromium-360', android(360, 740), null, {});
await run(chromium, 'chromium-390', android(390, 844), null, { main: 'chromium-390-main.png' });
await run(chromium, 'chromium-412', android(412, 915), null, {});

console.log('FAILS', fails.length);
fails.forEach(f => console.log(' -', f));
if (fails.length) process.exit(1);
