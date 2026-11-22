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
  const newsFit = await page.evaluate(() => {
    const iw = innerWidth;
    const bad = [];
    for (const el of document.querySelectorAll('.nname, .nmeta, .newsbatch, #newsTitle, #newsSub, #newsbox, #newsList')) {
      const r = el.getBoundingClientRect();
      const wide = r.right > iw + 1 || r.left < -1 || el.scrollWidth > el.clientWidth + 2;
      if (wide) bad.push((el.id || el.className) + ' ' + (el.textContent || '').trim().slice(0, 48));
    }
    return { bad, doc: document.documentElement.scrollWidth > iw + 1 };
  });
  check(!newsFit.doc && newsFit.bad.length === 0, `${label} news text fits`, newsFit);
  const newsHas = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#newsList .newsrow')];
    const batch = (document.querySelector('#newsList .newsbatch')?.innerText || '').toLowerCase();
    const text = rows.map(r => r.innerText || '');
    const ids = ['ST37-001', 'ST37-006', 'ST37-007', 'ST37-015', 'ST38-001', 'ST38-004', 'ST38-008', 'ST38-015'];
    return {
      first: text[0] || '',
      batch,
      ids: ids.filter(id => text.some(t => t.includes(id))),
    };
  });
  check(newsHas.ids.length === 8 && newsHas.first.includes('ST37-001') && newsHas.first.includes('Monkey.D.Luffy') && newsHas.batch.includes('st-37') && newsHas.batch.includes('st-38') && newsHas.batch.includes('unofficial'), `${label} news lists ST37 and ST38`, newsHas);
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

  // Long effect text, long names, and leaders, opened the same way a News row opens a card.
  for (const id of ['ST37-001', 'ST37-006', 'ST37-007', 'ST37-015', 'ST38-001', 'ST38-004', 'ST38-008', 'ST38-015', 'OP18-006', 'OP18-118', 'OP18-117', 'OP18-079']) {
    const opened = await page.evaluate((cardId) => {
      const c = byId.get(cardId);
      if (!c) return null;
      openModal(c, 'browse');
      return c.type;
    }, id);
    check(!!opened, `${label} can open ${id}`);
    if (!opened) continue;
    await page.waitForFunction((cardId) => {
      const img = document.querySelector('#modalbox img');
      if (!img || document.getElementById('modalbox')?.dataset.cardId !== cardId) return false;
      if (!img.complete || img.naturalWidth <= 0 || img.getBoundingClientRect().height < 80) return false;
      return true;
    }, id);
    await page.evaluate(() => {
      const img = document.querySelector('#modalbox img');
      return img && img.decode ? img.decode().catch(() => {}) : null;
    });
    const detail = await page.evaluate(() => {
      const iw = innerWidth;
      const ih = innerHeight;
      const box = document.getElementById('modalbox').getBoundingClientRect();
      const info = document.getElementById('modalinfo');
      const text = document.getElementById('modaltext');
      const name = info.querySelector('h3');
      const tags = [...info.querySelectorAll('.mtag')].map(t => t.textContent);
      const sticksOut = (el) => {
        const r = el.getBoundingClientRect();
        return r.left < -1 || r.right > iw + 1 || el.scrollWidth > el.clientWidth + 2;
      };
      return {
        id: document.getElementById('modalbox').dataset.cardId,
        boxIn: box.left >= -1 && box.top >= -1 && box.right <= iw + 1 && box.bottom <= ih + 1,
        doc: document.documentElement.scrollWidth > iw + 1,
        info: sticksOut(info),
        textWide: sticksOut(text),
        nameWide: sticksOut(name),
        tagWide: [...info.querySelectorAll('.mtag')].some(sticksOut),
        tags,
        types: (info.innerText.match(/Types: [^\n]+/) || [''])[0],
        text: text.textContent,
        name: name.textContent,
        imgSrc: document.querySelector('#modalbox img').getAttribute('src') || '',
        imgH: document.querySelector('#modalbox img').naturalHeight,
        imgShown: document.querySelector('#modalbox img').getBoundingClientRect().height,
      };
    });
    check(detail.boxIn && !detail.doc && !detail.info && !detail.textWide && !detail.nameWide && !detail.tagWide && detail.imgH > 400 && detail.imgShown > 80, `${label} ${id} fits`, detail);
    if (id === 'ST37-001') {
      check(detail.name === 'Monkey.D.Luffy' && detail.text.includes('you may only include {Alabasta} type cards') && detail.text.includes('[When Attacking] Draw 2 cards') && detail.text.includes('7 cards in your hand') && detail.types.includes('Alabasta') && detail.types.includes('Straw Hat Crew') && detail.tags.includes('Leader') && detail.tags.includes('Red Blue') && detail.tags.includes('Life 3') && detail.tags.includes('Power 5000') && detail.tags.includes('Strike') && detail.tags.includes('L') && !detail.tags.some(t => t.startsWith('Cost')) && !detail.tags.some(t => t.startsWith('Counter')) && detail.tags.some(t => t.includes('Unofficial English translation')) && detail.imgSrc.includes('st37/ST37-001.webp'), `${label} ST37-001 text`, detail);
    }
    if (id === 'ST37-006') {
      check(detail.name === 'Portgas.D.Ace' && detail.text.includes('[Blocker]') && detail.text.includes('[On Play]') && detail.text.includes('−3000 power') && detail.types.includes('Alabasta') && detail.types.includes('Whitebeard Pirates') && detail.tags.includes('Character') && detail.tags.includes('Red') && detail.tags.includes('Cost 8') && detail.tags.includes('Power 8000') && detail.tags.includes('Special') && detail.tags.includes('C') && !detail.tags.some(t => t.startsWith('Counter')) && detail.imgSrc.includes('st37/ST37-006.webp'), `${label} ST37-006 text`, detail);
    }
    if (id === 'ST37-007') {
      check(detail.name === 'Monkey.D.Luffy' && detail.text.includes('[Rush]') && detail.text.includes('[Activate: Main] [Once Per Turn]') && detail.text.includes('10000 power or less') && detail.tags.includes('Character') && detail.tags.includes('Cost 7') && detail.tags.includes('Power 9000') && detail.tags.includes('Strike') && detail.tags.includes('SR') && !detail.tags.some(t => t.startsWith('Counter')), `${label} ST37-007 text`, detail);
    }
    if (id === 'ST37-015') {
      check(detail.name === "Oh yeah?! You're the one who's a minnow!!" && detail.text.includes('[Counter]') && detail.text.includes('{Alabasta} type Characters') && detail.text.includes('+4000 power') && detail.text.includes('[Trigger]') && detail.text.includes('5000 power or less') && detail.tags.includes('Event') && detail.tags.includes('Red') && detail.tags.includes('Cost 1') && detail.tags.includes('C') && !detail.tags.some(t => t.startsWith('Power')) && detail.imgSrc.includes('st37/ST37-015.webp'), `${label} ST37-015 text`, detail);
    }
    if (id === 'ST38-001') {
      check(detail.name === 'Mr.0 (Crocodile)' && detail.text.includes('[When Attacking]') && detail.text.includes('base cost of 3 or more') && detail.text.includes('"Baroque Works"') && detail.types.includes('The Seven Warlords of the Sea') && detail.types.includes('Baroque Works') && detail.tags.includes('Leader') && detail.tags.includes('Blue Black') && detail.tags.includes('Life 4') && detail.tags.includes('Power 5000') && detail.tags.includes('Special') && detail.imgSrc.includes('st38/ST38-001.webp'), `${label} ST38-001 text`, detail);
    }
    if (id === 'ST38-004') {
      check(detail.name === 'Miss Goldenweek (Marianne)' && detail.text.includes('[On Play]/[On K.O.]') && detail.text.includes('cost of 2 or less') && detail.types === 'Types: Baroque Works' && detail.tags.includes('Character') && detail.tags.includes('Blue') && detail.tags.includes('Cost 4') && detail.tags.includes('Power 5000') && detail.tags.includes('Counter +1000') && detail.tags.includes('Wisdom') && detail.tags.includes('C') && detail.imgSrc.includes('st38/ST38-004.webp'), `${label} ST38-004 text`, detail);
    }
    if (id === 'ST38-008') {
      check(detail.name === 'Mr.0 (Crocodile)' && detail.text.includes('Choose one:') && detail.text.includes('from your trash') && detail.text.includes('cost of 5 or less') && detail.tags.includes('Character') && detail.tags.includes('Black') && detail.tags.includes('Cost 7') && detail.tags.includes('Power 7000') && detail.tags.includes('Special') && detail.tags.includes('SR') && !detail.tags.some(t => t.startsWith('Counter')) && detail.imgSrc.includes('st38/ST38-008.webp'), `${label} ST38-008 text`, detail);
    }
    if (id === 'ST38-015') {
      check(detail.name === "Don't Be So Full of Yourself, Fishbait" && detail.text.includes('[Main]') && detail.text.includes("Leader's type includes \"Baroque Works\"") && detail.text.includes('[Counter] Your Leader gains +3000 power') && detail.tags.includes('Event') && detail.tags.includes('Blue') && detail.tags.includes('Cost 1') && !detail.tags.some(t => t.startsWith('Power')) && detail.types.includes('The Seven Warlords of the Sea') && detail.types.includes('Baroque Works') && detail.imgSrc.includes('st38/ST38-015.webp'), `${label} ST38-015 text`, detail);
    }
    if (id === 'OP18-006') {
      check(detail.name === 'Koza' && detail.text === 'If you have [Nefertari Vivi], this Character gains [Rush] and +1000 power. (This card can attack on the turn in which it is played.)' && detail.types.includes('Alabasta') && detail.tags.includes('Character') && detail.tags.includes('Red') && detail.tags.includes('Cost 3') && detail.tags.includes('Power 4000') && detail.tags.includes('Counter +2000') && detail.tags.includes('Slash') && detail.tags.includes('C') && detail.tags.some(t => t.includes('Unofficial English translation')) && detail.imgSrc.includes('op18/OP18-006.webp'), `${label} OP18-006 text`, detail);
    }
    if (id === 'OP18-118') {
      check(detail.text.includes('[On Play]') && detail.text.includes('3 of your DON!!') && detail.text.includes('{Water Seven}') && detail.text.includes('[End of Your Turn]') && detail.types.includes('Water Seven') && detail.types.includes('Straw Hat Crew') && detail.tags.includes('Character') && detail.tags.includes('Green') && detail.tags.includes('Cost 9') && detail.tags.includes('Power 10000') && detail.tags.includes('Strike') && detail.tags.includes('SEC') && !detail.tags.some(t => t.startsWith('Counter')) && detail.tags.some(t => t.includes('Unofficial English translation')), `${label} OP18-118 text`, { text: detail.text, tags: detail.tags, types: detail.types });
    }
    if (id === 'OP18-117') {
      check(detail.text.includes('[Spandam]') && detail.text.includes('{Vice Admiral}') && detail.tags.includes('Event') && detail.tags.some(t => t.includes('Unofficial English translation')), `${label} OP18-117 text`, { text: detail.text, tags: detail.tags });
    }
    if (id === 'OP18-079') {
      check(detail.tags.includes('Leader') && detail.tags.includes('Life 4') && detail.text.includes('[Activate: Main]'), `${label} OP18-079 leader`, { text: detail.text, tags: detail.tags });
    }
    if (shots[id]) await page.screenshot({ path: path.join(out, shots[id]) });
    await page.click('.modalclose');
  }

  // Search by name, open the card, add one copy, then put the seeded deck back.
  const deckBefore = await page.evaluate(() => localStorage.getItem('optcg_decks_v2'));
  await page.fill('#search', 'Koza');
  await page.waitForFunction(() => {
    const ids = [...document.querySelectorAll('#grid .card')].map(el => el.dataset.id);
    return ids.length === 1 && ids[0] === 'OP18-006';
  });
  const searched = await page.evaluate(() => {
    const el = document.querySelector('#grid .card');
    return { id: el?.dataset.id, alt: el?.querySelector('img')?.alt, n: document.querySelectorAll('#grid .card').length };
  });
  check(searched.id === 'OP18-006' && searched.alt === 'Koza' && searched.n === 1, `${label} search finds Koza`, searched);
  await page.click('#grid .card');
  await page.waitForFunction(() => document.getElementById('modalbox')?.dataset.cardId === 'OP18-006');
  await page.getByRole('button', { name: '+ Add to deck' }).click();
  await page.waitForFunction(() => (document.getElementById('modalbtns')?.innerText || '').includes('In deck: 1 / 4'));
  const added = await page.evaluate(() => {
    const store = JSON.parse(localStorage.getItem('optcg_decks_v2'));
    const d = store.decks[store.cur];
    const row = [...document.querySelectorAll('#decklist .drow')].find(r => r.querySelector('.dname')?.textContent === 'Koza');
    return {
      qty: d.cards['OP18-006'],
      leader: d.leader,
      notes: d.notes,
      name: d.name,
      row: row ? row.innerText.replace(/\s+/g, ' ') : '',
      inDeck: document.getElementById('modalbtns')?.innerText || '',
    };
  });
  check(added.qty === 1 && added.leader === 'OP18-001' && added.notes === 'keep' && added.name === 'Phone Deck' && added.row.includes('Koza') && added.row.includes('×1') && added.inDeck.includes('In deck: 1 / 4'), `${label} add Koza to deck`, added);
  await page.getByRole('button', { name: '− Remove' }).click();
  await page.waitForFunction(() => (document.getElementById('modalbtns')?.innerText || '').includes('In deck: 0 / 4'));
  const removed = await page.evaluate(() => {
    const store = JSON.parse(localStorage.getItem('optcg_decks_v2'));
    return {
      qty: store.decks[store.cur].cards['OP18-006'] || 0,
      row: [...document.querySelectorAll('#decklist .drow')].some(r => r.querySelector('.dname')?.textContent === 'Koza'),
    };
  });
  check(removed.qty === 0 && !removed.row, `${label} remove Koza`, removed);
  await page.evaluate((raw) => localStorage.setItem('optcg_decks_v2', raw), deckBefore);
  await page.click('.modalclose');
  await page.fill('#search', '');

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
  await page.waitForFunction(() => {
    const panel = document.getElementById('deckpanel');
    const r = panel.getBoundingClientRect();
    return panel.classList.contains('open') && r.left < innerWidth - 20 && r.right <= innerWidth + 1;
  }, null, { timeout: 3000 });
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
  'ST37-001': 'webkit-iphone16-st37-001.png',
  'ST37-006': 'webkit-iphone16-st37-006.png',
  'ST37-007': 'webkit-iphone16-st37-007.png',
  'ST37-015': 'webkit-iphone16-st37-015.png',
  'ST38-001': 'webkit-iphone16-st38-001.png',
  'ST38-004': 'webkit-iphone16-st38-004.png',
  'ST38-008': 'webkit-iphone16-st38-008.png',
  'ST38-015': 'webkit-iphone16-st38-015.png',
  'OP18-006': 'webkit-iphone16-op18-006.png',
  'OP18-118': 'webkit-iphone16-op18-118.png',
  'OP18-117': 'webkit-iphone16-op18-117.png',
  'OP18-079': 'webkit-iphone16-op18-079.png',
});
await run(webkit, 'webkit-iphone15', { ...devices['iPhone 15'] }, island, {});
await run(webkit, 'webkit-se', iphone(375, 667, 2), { top: 20, bottom: 0, left: 0, right: 0 }, {});
await run(webkit, 'webkit-promax', iphone(430, 932, 3), island, {});
const android = (w, h) => ({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await run(chromium, 'chromium-360', android(360, 740), null, {
  news: 'chromium-360-news.png',
  'ST37-001': 'chromium-360-st37-001.png',
  'ST37-015': 'chromium-360-st37-015.png',
  'ST38-001': 'chromium-360-st38-001.png',
  'ST38-004': 'chromium-360-st38-004.png',
  'ST38-015': 'chromium-360-st38-015.png',
  'OP18-006': 'chromium-360-op18-006.png',
  'OP18-118': 'chromium-360-op18-118.png',
  'OP18-117': 'chromium-360-op18-117.png',
  'OP18-079': 'chromium-360-op18-079.png',
});
await run(chromium, 'chromium-390', android(390, 844), null, {
  main: 'chromium-390-main.png',
  news: 'chromium-390-news.png',
  'ST37-015': 'chromium-390-st37-015.png',
  'ST38-008': 'chromium-390-st38-008.png',
  'ST38-015': 'chromium-390-st38-015.png',
  'OP18-006': 'chromium-390-op18-006.png',
  'OP18-118': 'chromium-390-op18-118.png',
  'OP18-117': 'chromium-390-op18-117.png',
});
await run(chromium, 'chromium-412', android(412, 915), null, {
  news: 'chromium-412-news.png',
  'ST37-001': 'chromium-412-st37-001.png',
  'ST37-015': 'chromium-412-st37-015.png',
  'ST38-001': 'chromium-412-st38-001.png',
  'ST38-015': 'chromium-412-st38-015.png',
  'OP18-006': 'chromium-412-op18-006.png',
  'OP18-118': 'chromium-412-op18-118.png',
  'OP18-117': 'chromium-412-op18-117.png',
  'OP18-079': 'chromium-412-op18-079.png',
});

console.log('FAILS', fails.length);
fails.forEach(f => console.log(' -', f));
if (fails.length) process.exit(1);
