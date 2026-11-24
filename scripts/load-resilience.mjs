// Startup resilience: a hung or failed optcgapi.com must not spin forever,
// a stale card cache must still open the app, and corrupt saved data must
// not brick the page or be overwritten. Blocked image hosts fall back to
// static.dotgg.gg, and a tile with no art still shows its name, id, and cost.
// With no usable cache, cards-fallback.json opens the app and a short notice
// says the list is offline. Saved decks are left as they were.
//
//   NODE_PATH=/tmp/playwright-run/node_modules node scripts/load-resilience.mjs
//
// Serves the repo on 127.0.0.1:8765 if nothing is already listening.

import { chromium, webkit } from 'playwright';
import { spawn } from 'child_process';
import net from 'net';
import fs from 'fs';
import path from 'path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const shots = '/opt/cursor/artifacts';
fs.mkdirSync(shots, { recursive: true });

const fails = [];
function check(cond, msg, extra) {
  if (!cond) {
    const line = msg + (extra !== undefined ? ' ' + JSON.stringify(extra) : '');
    fails.push(line);
    console.log('FAIL', line);
  } else {
    console.log('ok', msg);
  }
}

const HERO = {
  id: 'ZZ-CACHE', name: 'Cached Hero', text: 'keep', set: 'Romance Dawn', setId: 'OP-01',
  rarity: 'C', color: 'Red', type: 'Character', life: null, cost: 1, power: 1000,
  subs: 'Straw Hat Crew', counter: 1000, attr: 'Strike', img: '',
};
const DECK = JSON.stringify({
  cur: 'd1',
  decks: {
    d1: {
      name: 'Keep Deck',
      leader: 'OP01-001',
      cards: { 'OP01-001': 2, 'OP01-002': 1 },
      notes: 'keep notes',
      matches: [{ opp: 'Kaido', win: true, t: 5 }],
      updated: 5,
    },
  },
});
const SCENARIO = JSON.stringify([{ id: 's1', name: 'Keep line', deckId: 'd1', handIds: ['OP01-001'], donField: 1, donRested: 0 }]);
const NEWS = JSON.stringify(['2026-10-eb05-op18']);

function cacheRaw(ageMs, card) {
  return JSON.stringify({ t: Date.now() - ageMs, d: [card || HERO] });
}
function init(entries, extra) {
  const lines = ['try {'];
  for (const [key, value] of Object.entries(entries)) {
    lines.push(`localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)});`);
  }
  lines.push('} catch (e) {}');
  if (extra) lines.push(extra);
  return lines.join('\n');
}
function hangRoute(route) {
  // API calls stay open so the page's own timeout has to fire.
  // Image requests are aborted; a pending route per tile stalls the browser.
  const url = route.request().url();
  if (url.includes('/api/')) return new Promise(() => {});
  return route.abort();
}
function failRoute(route) {
  return route.fulfill({ status: 500, contentType: 'text/plain', body: 'nope' });
}
function blockBundle(route) {
  return route.fulfill({ status: 500, contentType: 'text/plain', body: 'no' });
}
const ZORO = {
  id: 'OP01-001', name: 'Roronoa Zoro', text: 'leader', set: 'Romance Dawn', setId: 'OP-01',
  rarity: 'L', color: 'Red', type: 'Leader', life: 5, cost: null, power: 5000,
  subs: 'Straw Hat Crew', counter: null, attr: 'Slash',
  img: 'https://optcgapi.com/media/static/Card_Images/OP01-001.jpg',
};
const GAP = {
  id: 'OP01-077', name: 'Image Gap', text: 'gap', set: 'Romance Dawn', setId: 'OP-01',
  rarity: 'C', color: 'Red', type: 'Character', life: null, cost: 2, power: 3000,
  subs: '', counter: null, attr: 'Special', img: '',
};
const PLACE = {
  id: 'ZZ-PLACE', name: 'Placeholder Pia', text: 'none', set: 'Test', setId: 'ZZ',
  rarity: 'C', color: 'Red', type: 'Character', life: null, cost: 3, power: 1000,
  subs: '', counter: 1000, attr: 'Strike',
  img: 'https://optcgapi.com/media/static/Card_Images/ZZ-PLACE.jpg',
};
function apiBody(id, name) {
  return {
    card_set_id: id, card_name: name, card_text: 'Hello', set_name: 'Romance Dawn', set_id: 'OP-01',
    rarity: 'C', card_color: 'Red', card_type: 'Character', life: null, card_cost: '2', card_power: '3000',
    sub_types: 'Straw Hat Crew', counter_amount: 1000, attribute: 'Strike', card_image: '', card_image_id: id,
    market_price: 1.25, inventory_price: 1,
  };
}

let server = null;
async function ensureServer() {
  const up = await new Promise(resolve => {
    const sock = net.connect(8765, '127.0.0.1', () => { sock.end(); resolve(true); });
    sock.on('error', () => resolve(false));
  });
  if (up) return;
  server = spawn('python3', ['-m', 'http.server', '8765', '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
  for (let i = 0; i < 40; i++) {
    const ready = await new Promise(resolve => {
      const sock = net.connect(8765, '127.0.0.1', () => { sock.end(); resolve(true); });
      sock.on('error', () => resolve(false));
    });
    if (ready) return;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('local server did not start');
}

async function open(browser, { script, route, routes, width, height, ua }) {
  const context = await browser.newContext({
    viewport: { width: width || 390, height: height || 844 },
    isMobile: true,
    hasTouch: true,
    userAgent: ua,
  });
  if (script) await context.addInitScript(script);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', err => errors.push(String(err)));
  if (route) await page.route(/optcgapi\.com/, route);
  if (routes) {
    for (const [re, handler] of routes) await page.route(re, handler);
  }
  const hits = [];
  page.on('request', req => { if (req.url().includes('optcgapi.com')) hits.push(req.url()); });
  await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'domcontentloaded' });
  return { context, page, errors, hits };
}
function hideNews(page) {
  return page.evaluate(() => {
    const news = document.getElementById('news');
    if (news) news.hidden = true;
  });
}

async function ready(page, ms) {
  const deadline = Date.now() + (ms || 5000);
  let last = null;
  while (Date.now() < deadline) {
    try {
      if (await page.evaluate(() => window.__optcgReady === true)) return;
    } catch (e) {
      last = String(e);
    }
    await page.waitForTimeout(40);
  }
  try {
    last = await page.evaluate(() => ({
      ready: window.__optcgReady === true,
      text: (document.getElementById('loadState') || {}).innerText || '',
      notice: (document.getElementById('dataNotice') || {}).innerText || '',
      cards: document.querySelectorAll('#grid .card').length,
    }));
  } catch (e) {
    last = String(e);
  }
  throw new Error('not ready ' + JSON.stringify(last));
}
async function poll(page, read, ms) {
  const deadline = Date.now() + (ms || 5000);
  while (Date.now() < deadline) {
    try {
      if (await read()) return;
    } catch (e) {}
    await page.waitForTimeout(50);
  }
  throw new Error('timed out');
}
async function seeHero(page) {
  await page.evaluate(() => {
    const news = document.getElementById('news');
    if (news) news.hidden = true;
  });
  await page.fill('#search', 'Cached Hero');
  await poll(page, () => page.evaluate(() => {
    const ids = [...document.querySelectorAll('#grid .card')].map(el => el.dataset.id);
    return ids.length === 1 && ids[0] === 'ZZ-CACHE';
  }), 4000);
}
function storage(page) {
  return page.evaluate(() => ({
    deck: localStorage.getItem('optcg_decks_v2'),
    news: localStorage.getItem('optcg_seen_card_news'),
    scenarios: localStorage.getItem('optcg_don_scenarios_v1'),
    cache: localStorage.getItem('optcg_cards_v2'),
  }));
}

async function runSuite(browser, label) {
  const ua = label.startsWith('webkit')
    ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
    : 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

  // Fresh cache: do not hit the network, and do not rewrite saved decks.
  {
    let hits = 0;
    const route = route => { hits++; return route.abort(); };
    const { context, page, errors } = await open(browser, {
      ua,
      script: init({
        optcg_cards_v2: cacheRaw(0),
        optcg_decks_v2: DECK,
        optcg_don_scenarios_v1: SCENARIO,
        optcg_seen_card_news: NEWS,
      }),
      route,
    });
    await ready(page, 4000);
    await seeHero(page);
    const saved = await storage(page);
    check(hits === 0, `${label} fresh cache does not fetch`, { hits });
    check(saved.deck === DECK && saved.news === NEWS && saved.scenarios === SCENARIO, `${label} fresh cache leaves saved data`, saved);
    check(!errors.length, `${label} fresh cache has no page errors`, errors);
    await context.close();
  }

  // Stale cache + hung API: the app opens from the cache without waiting out the timeout.
  {
    const started = Date.now();
    const { context, page, errors } = await open(browser, {
      ua,
      script: init({ optcg_cards_v2: cacheRaw(48 * 3600 * 1000), optcg_decks_v2: DECK }),
      route: hangRoute,
    });
    await ready(page, 4000);
    await seeHero(page);
    const elapsed = Date.now() - started;
    check(elapsed < 4000, `${label} stale cache opens while the API hangs`, { elapsed });
    await page.waitForTimeout(1500);
    const still = await page.evaluate(() => {
      const el = document.getElementById('loadState');
      const ids = [...document.querySelectorAll('#grid .card')].map(n => n.dataset.id);
      return { loading: !!(el && el.textContent.includes('Loading card database')), ids };
    });
    check(!still.loading && still.ids[0] === 'ZZ-CACHE', `${label} hung refresh does not bring the spinner back`, still);
    const saved = await storage(page);
    check(saved.deck === DECK, `${label} stale cache does not rewrite decks`);
    check(!errors.length, `${label} stale hang has no page errors`, errors);
    if (label === 'chromium') {
      await page.screenshot({ path: path.join(shots, 'stale-cache-while-api-hangs.png') });
    }
    await context.close();
  }

  // Stale cache + HTTP 500.
  {
    const { context, page, errors } = await open(browser, {
      ua,
      width: 360,
      height: 740,
      script: init({ optcg_cards_v2: cacheRaw(48 * 3600 * 1000), optcg_decks_v2: DECK }),
      route: failRoute,
    });
    await ready(page, 5000);
    await seeHero(page);
    const saved = await storage(page);
    check(saved.deck === DECK, `${label} failed refresh keeps decks`);
    check(!errors.length, `${label} failed refresh has no page errors`, errors);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    check(!wide, `${label} stale fallback does not scroll sideways`);
    await context.close();
  }

  // No cache + HTTP 500: the bundled list opens the app. Try again does not clear storage.
  {
    const { context, page, errors } = await open(browser, {
      ua,
      width: 360,
      height: 740,
      script: init({ optcg_decks_v2: DECK }),
      route: failRoute,
    });
    await ready(page, 8000);
    await poll(page, () => page.evaluate(() => {
      const el = document.getElementById('dataNotice');
      const t = el ? el.innerText : '';
      return t.indexOf("Couldn't reach optcgapi.com") !== -1 && t.indexOf('included with this version') !== -1 && t.indexOf('were not changed') !== -1;
    }), 4000);
    const saved = await storage(page);
    check(saved.deck === DECK, `${label} failed load keeps decks`);
    await hideNews(page);
    await page.evaluate(() => localStorage.setItem('optcg_sentinel', 'keep-me'));
    await page.click('#btnRetryData');
    await poll(page, () => page.evaluate(() => {
      const btn = document.getElementById('btnRetryData');
      return !!(btn && !btn.disabled);
    }), 8000);
    const after = await page.evaluate(() => ({
      sentinel: localStorage.getItem('optcg_sentinel'),
      deck: localStorage.getItem('optcg_decks_v2'),
      wide: document.documentElement.scrollWidth > innerWidth + 1,
    }));
    check(after.sentinel === 'keep-me' && after.deck === DECK, `${label} Try again does not clear storage`, after);
    check(!after.wide, `${label} offline notice does not scroll sideways`);
    check(!errors.length, `${label} bundled fallback has no page errors`, errors);
    await context.close();
  }

  // No cache, no bundled list, HTTP 500, then Retry. Saved decks stay.
  {
    const { context, page, errors } = await open(browser, {
      ua,
      width: 360,
      height: 740,
      script: init({ optcg_decks_v2: DECK }),
      route: failRoute,
      routes: [[/cards-fallback\.json/, blockBundle]],
    });
    await poll(page, () => page.evaluate(() => {
      const el = document.getElementById('loadState');
      const t = el ? el.innerText : '';
      return t.indexOf('Failed to load') !== -1 && t.indexOf('Retry') !== -1 && t.indexOf('not changed') !== -1;
    }), 8000);
    const saved = await storage(page);
    check(saved.deck === DECK, `${label} failed load keeps decks`);
    await page.evaluate(() => localStorage.setItem('optcg_sentinel', 'keep-me'));
    await Promise.all([
      page.waitForEvent('load'),
      page.getByRole('button', { name: 'Retry' }).click(),
    ]);
    await poll(page, () => page.evaluate(() => {
      const el = document.getElementById('loadState');
      return !!(el && el.textContent.indexOf('Failed to load') !== -1);
    }), 8000);
    const after = await page.evaluate(() => localStorage.getItem('optcg_sentinel'));
    check(after === 'keep-me', `${label} Retry does not clear storage`, { after });
    const wide = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    check(!wide, `${label} error screen does not scroll sideways`);
    if (label === 'chromium') await page.screenshot({ path: path.join(shots, 'load-error-retry.png') });
    check(!errors.length, `${label} failed load has no page errors`, errors);
    await context.close();
  }

  // No cache + hung API: the bundled list opens without waiting out the timeout.
  {
    const started = Date.now();
    const { context, page, errors } = await open(browser, {
      ua,
      script: init({ optcg_decks_v2: DECK }),
      route: hangRoute,
    });
    await ready(page, 10000);
    const noticeOn = await page.evaluate(() => (document.getElementById('dataNotice') && document.getElementById('dataNotice').innerText) || '');
    check(noticeOn.includes("Couldn't reach optcgapi.com"), `${label} hung fetch explains the offline list`, noticeOn);
    const elapsed = Date.now() - started;
    check(elapsed < 10000, `${label} hung fetch opens the bundled list`, { elapsed });
    const saved = await storage(page);
    check(saved.deck === DECK, `${label} hung fetch keeps decks`);
    check(!errors.length, `${label} hung fetch has no page errors`, errors);
    await context.close();
  }

  // No cache, no bundled list, hung API: the spinner must become the error before the watchdog.
  {
    const started = Date.now();
    const { context, page, errors } = await open(browser, {
      ua,
      script: init({ optcg_decks_v2: DECK }),
      route: hangRoute,
      routes: [[/cards-fallback\.json/, blockBundle]],
    });
    await poll(page, () => page.evaluate(() => {
      const el = document.getElementById('loadState');
      const t = el ? el.innerText : '';
      return t.indexOf('timed out') !== -1 && t.indexOf('Retry') !== -1;
    }), 26000);
    const elapsed = Date.now() - started;
    check(elapsed < 24000, `${label} hung fetch shows the timeout error`, { elapsed });
    const saved = await storage(page);
    check(saved.deck === DECK, `${label} timed-out load keeps decks`);
    check(!errors.length, `${label} hung fetch has no page errors`, errors);
    if (label === 'chromium') await page.screenshot({ path: path.join(shots, 'load-error-hang.png') });
    await context.close();
  }

  // Unreadable card cache + failed network. The bundled list opens and the bad bytes stay.
  {
    const { context, page, errors } = await open(browser, {
      ua,
      script: init({ optcg_cards_v2: '{', optcg_decks_v2: DECK }),
      route: failRoute,
    });
    await ready(page, 8000);
    const saved = await storage(page);
    const notice = await page.evaluate(() => document.getElementById('dataNotice')?.innerText || '');
    check(saved.deck === DECK && saved.cache === '{' && notice.includes("Couldn't reach optcgapi.com"), `${label} corrupt card cache is not required to boot and decks stay`, { cache: saved.cache, deckOk: saved.deck === DECK, notice });
    check(!errors.length, `${label} corrupt card cache has no page errors`, errors);
    await context.close();
  }

  // Poison fields in a fresh cache must not throw or spin.
  {
    const poison = { id: 'ZZ-CACHE', name: 'Cached Hero', color: null, subs: 12, text: null, type: 'Character' };
    const { context, page, errors } = await open(browser, {
      ua,
      script: init({ optcg_cards_v2: cacheRaw(0, poison), optcg_decks_v2: DECK }),
      route: route => route.abort(),
    });
    await ready(page, 4000);
    await seeHero(page);
    check(!errors.length, `${label} poison card fields do not throw`, errors);
    const saved = await storage(page);
    check(saved.deck === DECK, `${label} poison card cache does not rewrite decks`);
    await context.close();
  }

  // Corrupt decks, news, and DON scenarios. The app opens and does not overwrite them.
  {
    const badDeck = '{"cur":"d1","decks":{"d1":{"name":"Keep me","cards":"nope","notes":{"a":1},"matches":"zz"}}}';
    const badNews = '{';
    const badScenarios = '{"x":1}';
    const { context, page, errors } = await open(browser, {
      ua,
      script: init({
        optcg_cards_v2: cacheRaw(0),
        optcg_decks_v2: badDeck,
        optcg_seen_card_news: badNews,
        optcg_don_scenarios_v1: badScenarios,
      }),
      route: route => route.abort(),
    });
    await ready(page, 4000);
    await seeHero(page);
    const warn = await page.evaluate(() => {
      const el = document.getElementById('bootWarn');
      const r = el.getBoundingClientRect();
      return {
        hidden: el.hidden,
        text: el.textContent,
        top: r.top,
        height: r.height,
        wide: document.documentElement.scrollWidth > innerWidth + 1,
        newsOpen: !document.getElementById('news').hidden,
      };
    });
    check(!warn.hidden && warn.height > 10 && warn.top >= -1 && !warn.wide && !warn.newsOpen, `${label} corrupt data warning is visible`, warn);
    check(warn.text.includes('Saved decks') && warn.text.includes('not deleted') && warn.text.includes('Saved news') && warn.text.includes('DON scenarios'), `${label} warning names the unreadable saves`, warn.text);
    await page.evaluate(() => addCard('ZZ-CACHE'));
    const wrote = await page.evaluate(() => {
      try { writeScenarios([{ id: 's2', deckId: 'd1', handIds: [] }]); return 'wrote'; }
      catch (e) { return 'threw'; }
    });
    await page.evaluate(() => {
      document.getElementById('news').dataset.batches = 'batch-1';
      dismissCardNews();
    });
    const saved = await storage(page);
    check(saved.deck === badDeck && saved.news === badNews && saved.scenarios === badScenarios && wrote === 'threw', `${label} corrupt saves are not overwritten`, { wrote, deckOk: saved.deck === badDeck, newsOk: saved.news === badNews, scenariosOk: saved.scenarios === badScenarios });
    check(!errors.length, `${label} corrupt saves do not throw`, errors);
    if (label === 'chromium') await page.screenshot({ path: path.join(shots, 'corrupt-decks-warning.png') });
    await context.close();
  }

  // Storage pressure: a full localStorage must not block a saved card list.
  {
    const extra = `
      try {
        var chunk = new Array(100001).join('x');
        for (var i = 0; i < 40; i++) localStorage.setItem('optcg_pad_' + i, chunk);
        localStorage.setItem('optcg_pad_hit', 'filled');
      } catch (e) {
        localStorage.setItem('optcg_pad_hit', 'quota');
      }`;
    const { context, page, errors } = await open(browser, {
      ua,
      script: init({ optcg_cards_v2: cacheRaw(48 * 3600 * 1000), optcg_decks_v2: DECK }, extra),
      route: hangRoute,
    });
    await ready(page, 5000);
    await seeHero(page);
    const saved = await page.evaluate(() => ({
      deck: localStorage.getItem('optcg_decks_v2'),
      hit: localStorage.getItem('optcg_pad_hit'),
      pad: localStorage.getItem('optcg_pad_0'),
    }));
    check(saved.deck === DECK && !!saved.pad, `${label} full storage still opens the saved cards and keeps decks`, { hit: saved.hit, pad: !!saved.pad, deckOk: saved.deck === DECK });
    check(!errors.length, `${label} full storage has no page errors`, errors);
    await context.close();
  }

  // A hanging service-worker lookup must not block startup.
  {
    const sw = `
      try {
        sessionStorage.setItem('optcg_boots', String(Number(sessionStorage.getItem('optcg_boots') || '0') + 1));
        var fake = {
          controller: null,
          getRegistrations: function () { return new Promise(function () {}); },
          ready: Promise.resolve(),
          addEventListener: function () {},
          removeEventListener: function () {}
        };
        Object.defineProperty(Navigator.prototype, 'serviceWorker', { configurable: true, get: function () { return fake; } });
        localStorage.setItem('optcg_sw_stub', 'ok');
      } catch (e) {
        localStorage.setItem('optcg_sw_stub', 'fail');
      }`;
    const { context, page, errors } = await open(browser, {
      ua,
      script: init({ optcg_cards_v2: cacheRaw(0), optcg_decks_v2: DECK }, sw),
      route: hangRoute,
    });
    const started = Date.now();
    await ready(page, 4000);
    const info = await page.evaluate(() => ({
      stub: localStorage.getItem('optcg_sw_stub'),
      boots: sessionStorage.getItem('optcg_boots'),
      deck: localStorage.getItem('optcg_decks_v2'),
    }));
    check(info.stub === 'ok' && info.boots === '1' && Date.now() - started < 4000, `${label} hanging service worker does not block startup`, info);
    check(info.deck === DECK, `${label} service-worker startup keeps decks`);
    check(!errors.length, `${label} service-worker startup has no page errors`, errors);
    await context.close();
  }

  // Refresh must reload even when unregister never resolves.
  {
    const sw = `
      try {
        sessionStorage.setItem('optcg_boots', String(Number(sessionStorage.getItem('optcg_boots') || '0') + 1));
        var fake = {
          controller: null,
          getRegistrations: function () { return new Promise(function () {}); },
          ready: Promise.resolve(),
          addEventListener: function () {},
          removeEventListener: function () {}
        };
        Object.defineProperty(Navigator.prototype, 'serviceWorker', { configurable: true, get: function () { return fake; } });
      } catch (e) {}`;
    const { context, page, errors } = await open(browser, {
      ua,
      script: init({ optcg_cards_v2: cacheRaw(0), optcg_decks_v2: DECK }, sw),
      route: hangRoute,
    });
    await ready(page, 4000);
    await page.evaluate(() => {
      localStorage.setItem('optcg_sentinel', 'keep-me');
      document.getElementById('news').hidden = true;
    });
    const started = Date.now();
    await page.click('#btnRefresh');
    await poll(page, () => page.evaluate(() => Number(sessionStorage.getItem('optcg_boots')) >= 2), 8000);
    const elapsed = Date.now() - started;
    const info = await page.evaluate(() => ({
      boots: sessionStorage.getItem('optcg_boots'),
      sentinel: localStorage.getItem('optcg_sentinel'),
      deck: localStorage.getItem('optcg_decks_v2'),
    }));
    check(elapsed >= 2000 && elapsed < 7000 && info.boots === '2', `${label} Refresh reloads when service-worker cleanup hangs`, { elapsed, boots: info.boots });
    check(info.sentinel === 'keep-me' && info.deck === DECK, `${label} Refresh keeps decks and other storage`, info);
    check(!errors.length, `${label} Refresh has no page errors`, errors);
    await context.close();
  }

  // No cache, API responds: cards load and the deck save is untouched.
  {
    const { context, page, errors } = await open(browser, {
      ua,
      script: init({ optcg_decks_v2: DECK }),
      route: route => {
        const st = route.request().url().includes('allST');
        const body = st ? [] : [apiBody('ZZ-NET', 'Network Hero')];
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      },
    });
    await ready(page, 8000);
    await page.evaluate(() => { document.getElementById('news').hidden = true; });
    await page.fill('#search', 'Network Hero');
    await poll(page, () => page.evaluate(() => {
      const ids = [...document.querySelectorAll('#grid .card')].map(el => el.dataset.id);
      return ids.length === 1 && ids[0] === 'ZZ-NET';
    }), 8000);
    const saved = await storage(page);
    const cachedNet = saved.cache && saved.cache.includes('ZZ-NET');
    check(saved.deck === DECK && cachedNet, `${label} network load stores cards and keeps decks`, { deckOk: saved.deck === DECK, cachedNet });
    check(!errors.length, `${label} network load has no page errors`, errors);
    await context.close();
  }

  // Stale cache, every optcgapi.com request blocked. Art comes from dotgg.
  {
    const { context, page, errors } = await open(browser, {
      ua,
      width: 360,
      height: 740,
      script: init({
        optcg_cards_v2: cacheRaw(48 * 3600 * 1000, ZORO),
        optcg_decks_v2: DECK,
      }),
      route: route => route.abort(),
    });
    await ready(page, 8000);
    await hideNews(page);
    await poll(page, () => page.evaluate(() => {
      const img = document.querySelector('#grid .card[data-id="OP01-001"] img');
      const noticeEl = document.getElementById('dataNotice');
      const notice = noticeEl ? noticeEl.innerText : '';
      const dotgg = [...document.querySelectorAll('#grid .card img')].filter(node => node.naturalWidth > 100 && (node.currentSrc || '').indexOf('static.dotgg.gg') !== -1).length;
      return !!(img && img.naturalWidth > 100 && (img.currentSrc || '').indexOf('static.dotgg.gg/onepiece/card/OP01-001.webp') !== -1
        && dotgg >= 6
        && notice.indexOf("Couldn't reach optcgapi.com") !== -1 && notice.indexOf('saved on this device') !== -1);
    }), 20000);
    const tile = await page.evaluate(() => {
      const el = document.querySelector('#grid .card[data-id="OP01-001"]');
      const c = byId.get('OP01-001');
      const imgs = [...document.querySelectorAll('#grid .card img')].filter(img => img.naturalWidth > 100 && (img.currentSrc || '').includes('static.dotgg.gg'));
      return {
        name: el.querySelector('.cf-name').textContent,
        id: el.querySelector('.cf-id').textContent,
        cost: el.querySelector('.cf-cost').textContent,
        expect: c.name,
        expectCost: c.cost != null && c.cost !== '' ? 'Cost ' + c.cost : 'Cost —',
        shown: getComputedStyle(el.querySelector('img')).opacity === '1',
        dotgg: imgs.length,
        wide: document.documentElement.scrollWidth > innerWidth + 1,
      };
    });
    check(tile.dotgg >= 6 && tile.shown && tile.name === tile.expect && tile.id === 'OP01-001' && tile.cost === tile.expectCost && !tile.wide, `${label} blocked optcgapi shows dotgg art`, tile);
    const saved = await storage(page);
    check(saved.deck === DECK, `${label} image fallback keeps decks`);
    check(!errors.length, `${label} image fallback has no page errors`, errors);
    if (label === 'chromium') await page.screenshot({ path: path.join(shots, 'offline-dotgg-images.png') });
    await context.close();
  }

  // No cache, optcgapi.com blocked. The bundled list supplies the cards and dotgg supplies the art.
  {
    const { context, page, errors } = await open(browser, {
      ua,
      width: 360,
      height: 740,
      script: init({ optcg_decks_v2: DECK }),
      route: route => route.abort(),
    });
    await ready(page, 10000);
    await hideNews(page);
    await poll(page, () => page.evaluate(() => {
      const img = document.querySelector('#grid .card[data-id="OP01-001"] img');
      const noticeEl = document.getElementById('dataNotice');
      const notice = noticeEl ? noticeEl.innerText : '';
      return !!(img && img.naturalWidth > 100 && (img.currentSrc || '').indexOf('static.dotgg.gg/onepiece/card/OP01-001.webp') !== -1
        && notice.indexOf('included with this version') !== -1);
    }), 20000);
    const saved = await storage(page);
    check(saved.deck === DECK, `${label} bundled cards keep decks`);
    check(!errors.length, `${label} bundled images have no page errors`, errors);
    await context.close();
  }

  // A cache that lost img must not call optcgapi.com just to discover the picture.
  {
    let hits = 0;
    const { context, page, errors } = await open(browser, {
      ua,
      script: init({
        optcg_cards_v2: cacheRaw(0, GAP),
        optcg_decks_v2: DECK,
      }),
      route: route => { hits++; return route.abort(); },
    });
    await ready(page, 4000);
    await hideNews(page);
    await page.fill('#search', 'OP01-077');
    await poll(page, () => page.evaluate(() => {
      const img = document.querySelector('#grid .card[data-id="OP01-077"] img');
      return !!(img && img.naturalWidth > 100 && (img.currentSrc || '').indexOf('static.dotgg.gg/onepiece/card/OP01-077.webp') !== -1);
    }), 15000);
    const face = await page.evaluate(() => {
      const el = document.querySelector('#grid .card[data-id="OP01-077"]');
      return {
        name: el.querySelector('.cf-name').textContent,
        id: el.querySelector('.cf-id').textContent,
        cost: el.querySelector('.cf-cost').textContent,
      };
    });
    check(hits === 0 && face.name === 'Image Gap' && face.id === 'OP01-077' && face.cost === 'Cost 2', `${label} missing img uses dotgg without calling optcgapi`, { hits, face });
    const saved = await storage(page);
    check(saved.deck === DECK, `${label} missing img keeps decks`);
    check(!errors.length, `${label} missing img has no page errors`, errors);
    await context.close();
  }

  // Cache present, optcgapi.com and dotgg both blocked. The tile shows name, id, and cost.
  {
    const { context, page, errors } = await open(browser, {
      ua,
      width: 360,
      height: 740,
      script: init({
        optcg_cards_v2: cacheRaw(0, PLACE),
        optcg_decks_v2: DECK,
      }),
      route: route => route.abort(),
      routes: [[/static\.dotgg\.gg/, route => route.abort()]],
    });
    await ready(page, 4000);
    await hideNews(page);
    await page.fill('#search', 'Placeholder Pia');
    await poll(page, () => page.evaluate(() => {
      const img = document.querySelector('#grid .card[data-id="ZZ-PLACE"] img');
      return !!(img && img.classList.contains('is-broken'));
    }), 8000);
    const tile = await page.evaluate(() => {
      const el = document.querySelector('#grid .card[data-id="ZZ-PLACE"]');
      const img = el.querySelector('img');
      const face = el.querySelector('.card-fallback');
      const fr = face.getBoundingClientRect();
      const cs = getComputedStyle(img);
      return {
        name: face.querySelector('.cf-name').textContent,
        id: face.querySelector('.cf-id').textContent,
        cost: face.querySelector('.cf-cost').textContent,
        hidden: cs.display === 'none' || cs.opacity === '0',
        faceH: fr.height,
        faceW: fr.width,
        text: face.innerText.replace(/\s+/g, ' '),
      };
    });
    check(tile.name === 'Placeholder Pia' && tile.id === 'ZZ-PLACE' && tile.cost === 'Cost 3' && tile.hidden && tile.faceH > 40 && tile.faceW > 40, `${label} failed art shows name, id, and cost`, tile);
    const saved = await storage(page);
    check(saved.deck === DECK, `${label} placeholder keeps decks`);
    check(!errors.length, `${label} placeholder has no page errors`, errors);
    if (label === 'chromium') await page.screenshot({ path: path.join(shots, 'offline-text-placeholder.png') });
    await context.close();
  }

  // No cache, both image hosts blocked. Bundled card data still fills the tile.
  {
    const { context, page, errors } = await open(browser, {
      ua,
      width: 360,
      height: 740,
      script: init({ optcg_decks_v2: DECK }),
      route: route => route.abort(),
      routes: [[/static\.dotgg\.gg/, route => route.abort()]],
    });
    await ready(page, 10000);
    await hideNews(page);
    await page.fill('#search', 'OP01-001');
    await poll(page, () => page.evaluate(() => {
      const img = document.querySelector('#grid .card[data-id="OP01-001"] img');
      const noticeEl = document.getElementById('dataNotice');
      const notice = noticeEl ? noticeEl.innerText : '';
      return !!(img && img.classList.contains('is-broken') && notice.indexOf("Couldn't reach optcgapi.com") !== -1);
    }), 8000);
    const tile = await page.evaluate(() => {
      const el = document.querySelector('#grid .card[data-id="OP01-001"]');
      const c = byId.get('OP01-001');
      const face = el.querySelector('.card-fallback');
      return {
        name: face.querySelector('.cf-name').textContent,
        id: face.querySelector('.cf-id').textContent,
        cost: face.querySelector('.cf-cost').textContent,
        expect: c.name,
        expectCost: c.cost != null && c.cost !== '' ? 'Cost ' + c.cost : 'Cost —',
        hidden: getComputedStyle(el.querySelector('img')).display === 'none',
      };
    });
    check(tile.name === tile.expect && tile.id === 'OP01-001' && tile.cost === tile.expectCost && tile.hidden && tile.name.length > 1, `${label} bundled tile shows text when art is blocked`, tile);
    const saved = await storage(page);
    check(saved.deck === DECK, `${label} bundled placeholder keeps decks`);
    check(!errors.length, `${label} bundled placeholder has no page errors`, errors);
    await context.close();
  }
}

await ensureServer();
const chrome = await chromium.launch();
try { await runSuite(chrome, 'chromium'); }
finally { await chrome.close(); }
const kit = await webkit.launch();
try { await runSuite(kit, 'webkit'); }
finally { await kit.close(); }

console.log('FAILS', fails.length);
fails.forEach(f => console.log(' -', f));
if (server) server.kill();
if (fails.length) process.exit(1);
