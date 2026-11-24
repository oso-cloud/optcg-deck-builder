// DON turn sandbox. The deck list comes from the builder's saved decks.
// Card text is not automated: paying a cost rests DON, and each attached
// DON is +1000 power. The four DON counts always add up to 10.
'use strict';

const DON_TOTAL = 10;
const HAND_MAX = 7;
const SCENARIO_KEY = 'optcg_don_scenarios_v1';
const COLOR_BORDER = {
  Red: 'var(--red)', Green: 'var(--green)', Blue: 'var(--blue)',
  Purple: 'var(--purple)', Black: 'var(--black)', Yellow: 'var(--yellow)',
};

const setup = { deckId: null, donField: 0, donRested: 0, picks: {} };
let play = null;
let past = [];
let view = 'setup';
let seq = 1;

function make(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
function clamp(n, lo, hi) {
  n = Math.floor(Number(n) || 0);
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}
function cardOf(id) {
  const c = byId.get(id);
  if (c) return c;
  return { id: id, name: id, text: '', type: 'Character', cost: null, power: null, img: '', colors: [], counter: null, life: null };
}
function cardImg(card, alt) {
  const img = document.createElement('img');
  img.alt = alt != null ? alt : ((card && card.name) || '');
  if (card && typeof attachCardImage === 'function') attachCardImage(img, card);
  else if (card && card.img) img.src = card.img;
  return img;
}
function cname(id) {
  const c = byId.get(id);
  return c && c.name ? c.name : id;
}
function cardCost(card) {
  if (!card || card.cost == null || card.cost === '') return { cost: 0, known: false };
  const n = Number(card.cost);
  if (!Number.isFinite(n) || n < 0) return { cost: 0, known: false };
  return { cost: Math.floor(n), known: true };
}
function cardPower(card) {
  if (!card || card.power == null || card.power === '') return null;
  const n = Number(card.power);
  return Number.isFinite(n) ? n : null;
}
function shownPower(card, attached) {
  const base = cardPower(card);
  if (base == null) return null;
  return base + (attached || 0) * 1000;
}
function colorOf(card) {
  const col = card && card.colors && card.colors[0];
  return COLOR_BORDER[col] || 'var(--border)';
}
function inst(id) { return { uid: 'c' + (seq++), id: id }; }
function currentDeck() {
  if (!setup.deckId || !store.decks) return null;
  return store.decks[setup.deckId] || null;
}
function copiesOf(id) {
  const d = currentDeck();
  if (!d || !d.cards) return 0;
  return Math.max(0, Math.floor(Number(d.cards[id]) || 0));
}
function pickedTotal() {
  let n = 0;
  for (const v of Object.values(setup.picks)) n += v;
  return n;
}
function setNote(msg) {
  const n = document.getElementById('simNote');
  n.textContent = msg || '';
  n.hidden = !msg;
}
function attachedCount(s) {
  return (s.leader.attached || 0) + s.chars.reduce((sum, c) => sum + (c.attached || 0), 0);
}
function donSum(s) {
  return s.don.deck + s.don.active + s.don.rested + attachedCount(s);
}

function clampPicks() {
  const d = currentDeck();
  const cards = (d && d.cards) || {};
  let total = 0;
  for (const id of Object.keys(setup.picks)) {
    const have = Math.max(0, Math.floor(Number(cards[id]) || 0));
    let n = setup.picks[id];
    if (n > have) n = have;
    if (total + n > HAND_MAX) n = HAND_MAX - total;
    if (n <= 0) delete setup.picks[id];
    else { setup.picks[id] = n; total += n; }
  }
}

function buildPlay(src) {
  const d = store.decks[src.deckId] || { cards: {}, leader: null, name: '' };
  const pool = [];
  for (const [id, qty] of Object.entries(d.cards || {})) {
    const n = Math.max(0, Math.floor(Number(qty) || 0));
    for (let i = 0; i < n; i++) pool.push(id);
  }
  const hand = [];
  const handIds = [];
  for (const id of src.handIds || []) {
    const i = pool.indexOf(id);
    if (i < 0) continue;
    pool.splice(i, 1);
    hand.push(inst(id));
    handIds.push(id);
  }
  pool.sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
  const field = clamp(src.donField, 0, DON_TOTAL);
  const rested = clamp(src.donRested, 0, field);
  return {
    setup: { deckId: src.deckId, donField: field, donRested: rested, handIds: handIds },
    leaderId: d.leader || null,
    leader: { rested: false, attached: 0 },
    chars: [],
    stages: [],
    hand: hand,
    deck: pool,
    trash: [],
    don: { deck: DON_TOTAL - field, active: field - rested, rested: rested },
    log: ['Turn started.'],
  };
}

function commit(mutator) {
  if (!play) return false;
  const prev = JSON.stringify(play);
  const next = JSON.parse(prev);
  let msg = null;
  try { msg = mutator(next); }
  catch (err) { setNote('That action failed.'); return false; }
  if (!msg) return false;
  next.log.unshift(msg);
  if (next.log.length > 40) next.log.length = 40;
  if (donSum(next) !== DON_TOTAL) {
    setNote('That action was cancelled so the DON total stays at 10.');
    return false;
  }
  past.push(prev);
  if (past.length > 60) past.shift();
  play = next;
  setNote('');
  closeSheet();
  renderPlay();
  return true;
}

function payAndPlay(s, uid, override) {
  const i = s.hand.findIndex(c => c.uid === uid);
  if (i < 0) return null;
  const item = s.hand[i];
  const card = cardOf(item.id);
  const costInfo = cardCost(card);
  const cost = costInfo.cost;
  if (s.don.active < cost && !override) return null;
  const paid = Math.min(s.don.active, cost);
  s.don.active -= paid;
  s.don.rested += paid;
  s.hand.splice(i, 1);
  const type = card.type || 'Character';
  let where = 'the trash';
  if (type === 'Character') {
    s.chars.push({ uid: item.uid, id: item.id, rested: false, attached: 0 });
    where = 'the field';
  } else if (type === 'Stage') {
    s.stages.push({ uid: item.uid, id: item.id, rested: false, attached: 0 });
    where = 'the stage';
  } else {
    s.trash.push({ uid: item.uid, id: item.id });
  }
  const short = paid < cost ? ' (short ' + (cost - paid) + ')' : '';
  const paidLabel = costInfo.known ? String(paid) + ' DON' : 'no listed cost';
  return 'Played ' + cname(item.id) + ' to ' + where + ' for ' + paidLabel + short + '.';
}
function take(s, zone, uid) {
  const list = zone === 'hand' ? s.hand : zone === 'char' ? s.chars : zone === 'stage' ? s.stages : zone === 'trash' ? s.trash : null;
  if (!list) return null;
  const i = list.findIndex(c => c.uid === uid);
  if (i < 0) return null;
  return list.splice(i, 1)[0];
}
function releaseAttached(s, item) {
  const n = item.attached || 0;
  if (!n) return '';
  item.attached = 0;
  s.don.rested += n;
  return ' ' + n + ' attached DON ' + (n === 1 ? 'is' : 'are') + ' now rested.';
}
function moveToTrash(s, zone, uid, verb) {
  if (zone === 'leader') return null;
  const item = take(s, zone, uid);
  if (!item) return null;
  const extra = releaseAttached(s, item);
  s.trash.push({ uid: item.uid, id: item.id });
  return verb + ' ' + cname(item.id) + '.' + extra;
}
function moveToHand(s, zone, uid) {
  if (zone === 'leader') return null;
  const item = take(s, zone, uid);
  if (!item) return null;
  const extra = releaseAttached(s, item);
  s.hand.push({ uid: item.uid, id: item.id });
  return 'Returned ' + cname(item.id) + ' to hand.' + extra;
}
function zoneTarget(s, zone, uid) {
  if (zone === 'leader') return s.leader;
  if (zone === 'char') return s.chars.find(c => c.uid === uid) || null;
  if (zone === 'stage') return s.stages.find(c => c.uid === uid) || null;
  return null;
}
function zoneName(s, zone, target) {
  if (zone === 'leader') return cname(s.leaderId) || 'Leader';
  return cname(target.id);
}
function setRested(s, zone, uid, rested) {
  const target = zoneTarget(s, zone, uid);
  if (!target || !!target.rested === rested) return null;
  target.rested = rested;
  return (rested ? 'Rested ' : 'Re-stood ') + zoneName(s, zone, target) + '.';
}
function attachDon(s, zone, uid) {
  if (s.don.active <= 0) return null;
  if (zone !== 'leader' && zone !== 'char') return null;
  const target = zoneTarget(s, zone, uid);
  if (!target) return null;
  s.don.active -= 1;
  target.attached = (target.attached || 0) + 1;
  return 'Attached 1 DON to ' + zoneName(s, zone, target) + '. +1000 power.';
}
function minusAttached(s, zone, uid) {
  const target = zoneTarget(s, zone, uid);
  if (!target || !target.attached) return null;
  target.attached -= 1;
  s.don.deck += 1;
  return 'DON!! −1 from ' + zoneName(s, zone, target) + ' back to the DON deck.';
}
function restOneDon(s) {
  if (s.don.active <= 0) return null;
  s.don.active -= 1;
  s.don.rested += 1;
  return 'Rested 1 DON.';
}
function standOneDon(s) {
  if (s.don.rested <= 0) return null;
  s.don.rested -= 1;
  s.don.active += 1;
  return 'Re-stood 1 DON.';
}
function addDon(s, asActive) {
  if (s.don.deck <= 0) return null;
  s.don.deck -= 1;
  if (asActive) s.don.active += 1;
  else s.don.rested += 1;
  return 'Added 1 DON from the DON deck as ' + (asActive ? 'active' : 'rested') + '.';
}
function minusDon(s, fromActive) {
  const key = fromActive ? 'active' : 'rested';
  if (s.don[key] <= 0) return null;
  s.don[key] -= 1;
  s.don.deck += 1;
  return 'DON!! −1 (' + key + ' back to the DON deck).';
}
function drawNext(s) {
  if (!s.deck.length) return null;
  const id = s.deck.shift();
  s.hand.push(inst(id));
  return 'Drew ' + cname(id) + '.';
}
function drawSpecific(s, id) {
  const i = s.deck.indexOf(id);
  if (i < 0) return null;
  s.deck.splice(i, 1);
  s.hand.push(inst(id));
  return 'Drew ' + cname(id) + '.';
}

function undo() {
  if (!past.length || !play) return;
  play = JSON.parse(past.pop());
  closeSheet();
  setNote('');
  renderPlay();
}
function resetTurn() {
  if (!play) return;
  past = [];
  play = buildPlay(play.setup);
  play.log.unshift('Reset to the chosen setup.');
  closeSheet();
  setNote('');
  renderPlay();
}
function startTurn() {
  if (!currentDeck()) { setNote('Choose a deck first.'); return; }
  const handIds = [];
  for (const [id, n] of Object.entries(setup.picks)) {
    for (let i = 0; i < n; i++) handIds.push(id);
  }
  play = buildPlay({
    deckId: setup.deckId,
    donField: setup.donField,
    donRested: setup.donRested,
    handIds: handIds,
  });
  past = [];
  setNote('');
  closeSheet();
  showPlay();
}

function readScenarios() {
  try {
    const raw = JSON.parse(localStorage.getItem(SCENARIO_KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw.filter(s => s && typeof s.id === 'string' && typeof s.deckId === 'string' && Array.isArray(s.handIds));
  } catch (err) { return []; }
}
function writeScenarios(list) {
  let raw = null;
  try { raw = localStorage.getItem(SCENARIO_KEY); }
  catch (err) { throw err; }
  if (raw != null && raw !== '') {
    try {
      if (!Array.isArray(JSON.parse(raw))) throw new Error('unreadable');
    } catch (err) {
      throw new Error('Saved DON scenarios could not be read.');
    }
  }
  localStorage.setItem(SCENARIO_KEY, JSON.stringify(list.slice(0, 30)));
}
function saveScenario() {
  const d = currentDeck();
  if (!d) { setNote('Choose a deck first.'); return; }
  const handIds = [];
  for (const [id, n] of Object.entries(setup.picks)) {
    for (let i = 0; i < n; i++) handIds.push(id);
  }
  const input = document.getElementById('simScenarioName');
  let name = input.value.trim();
  if (!name) name = (d.name || 'Deck') + ' · ' + setup.donField + ' DON';
  name = name.slice(0, 60);
  const list = readScenarios();
  list.unshift({
    id: 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: name,
    deckId: setup.deckId,
    donField: setup.donField,
    donRested: setup.donRested,
    handIds: handIds,
    saved: Date.now(),
  });
  try { writeScenarios(list); }
  catch (err) { setNote('Could not save on this device.'); return; }
  input.value = '';
  setNote('Saved "' + name + '".');
  renderScenarios();
}
function loadScenario(id) {
  const sc = readScenarios().find(s => s.id === id);
  if (!sc) return;
  if (!store.decks[sc.deckId]) { setNote('That deck is no longer on this device.'); return; }
  setup.deckId = sc.deckId;
  setup.donField = clamp(sc.donField, 0, DON_TOTAL);
  setup.donRested = clamp(sc.donRested, 0, setup.donField);
  setup.picks = {};
  for (const cardId of sc.handIds) setup.picks[cardId] = (setup.picks[cardId] || 0) + 1;
  clampPicks();
  const sel = document.getElementById('simDeck');
  if ([...sel.options].some(o => o.value === sc.deckId)) sel.value = sc.deckId;
  renderLeaderPreview();
  renderDonSetup();
  renderPicks();
  syncPicks();
  setNote('Loaded "' + sc.name + '". Press Start turn to play it.');
  document.getElementById('simScroll').scrollTop = 0;
}
function deleteScenario(id) {
  try { writeScenarios(readScenarios().filter(s => s.id !== id)); }
  catch (err) { setNote('Could not update saved scenarios.'); return; }
  renderScenarios();
}

function renderDeckSelect() {
  const sel = document.getElementById('simDeck');
  const entries = Object.entries(store.decks || {}).sort((a, b) => String(a[1].name || '').localeCompare(String(b[1].name || '')));
  const prev = setup.deckId;
  sel.innerHTML = '';
  for (const [id, d] of entries) {
    const o = document.createElement('option');
    o.value = id;
    o.textContent = d.name || 'Deck';
    sel.appendChild(o);
  }
  if (!entries.length) { setup.deckId = null; return; }
  if (!(prev && store.decks[prev])) {
    setup.picks = {};
    setup.deckId = store.cur && store.decks[store.cur] ? store.cur : entries[0][0];
  } else setup.deckId = prev;
  sel.value = setup.deckId;
}
function renderLeaderPreview() {
  const box = document.getElementById('simLeaderPreview');
  box.innerHTML = '';
  box.onclick = null;
  const d = currentDeck();
  if (!d) {
    box.appendChild(make('div', 'simhint', 'Save a deck in the builder, then come back.'));
    return;
  }
  if (!d.leader || !byId.has(d.leader)) {
    box.appendChild(make('div', 'simhint', 'No leader in this deck. You can still run the turn.'));
    return;
  }
  const c = byId.get(d.leader);
  const img = cardImg(c);
  const info = make('div', 'siminfo');
  info.appendChild(make('div', 'simname', c.name));
  const bits = [c.color || '', c.power != null ? 'Power ' + c.power : '', c.life != null && c.life !== '' ? 'Life ' + c.life : ''].filter(Boolean);
  info.appendChild(make('div', 'simsub', bits.join(' · ')));
  box.append(img, info);
  box.onclick = () => openModal(c, 'browse');
  box.setAttribute('role', 'button');
  box.tabIndex = 0;
}
function renderDonSetup() {
  document.getElementById('simDonField').textContent = String(setup.donField);
  document.getElementById('simDonRested').textContent = String(setup.donRested);
  const active = setup.donField - setup.donRested;
  document.getElementById('simDonPreview').textContent =
    'Active ' + active + ' · Rested ' + setup.donRested + ' · DON deck ' + (DON_TOTAL - setup.donField);
  document.getElementById('simDonFieldDec').disabled = setup.donField <= 0;
  document.getElementById('simDonFieldInc').disabled = setup.donField >= DON_TOTAL;
  document.getElementById('simDonRestedDec').disabled = setup.donRested <= 0;
  document.getElementById('simDonRestedInc').disabled = setup.donRested >= setup.donField;
}
function bumpField(delta) {
  setup.donField = clamp(setup.donField + delta, 0, DON_TOTAL);
  if (setup.donRested > setup.donField) setup.donRested = setup.donField;
  renderDonSetup();
}
function bumpRested(delta) {
  setup.donRested = clamp(setup.donRested + delta, 0, setup.donField);
  renderDonSetup();
}
function pickRow(id, qty, card) {
  const row = make('div', 'simpick');
  row.dataset.id = id;
  row.style.borderLeft = '4px solid ' + colorOf(card);
  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'simpick-open';
  const img = cardImg(card);
  const info = make('span', 'siminfo');
  info.appendChild(make('span', 'simname', card.name || id));
  const cost = cardCost(card);
  const power = cardPower(card);
  const bits = ['×' + qty];
  if (cost.known) bits.push('Cost ' + cost.cost);
  if (power != null) bits.push('Power ' + power);
  info.appendChild(make('span', 'simsub', bits.join(' · ')));
  if (card.text) info.appendChild(make('span', 'simtext', card.text));
  open.append(img, info);
  open.setAttribute('aria-label', (card.name || id) + ', card details');
  const rem = document.createElement('button');
  rem.type = 'button';
  rem.className = 'simqtybtn sim-rem';
  rem.textContent = '−';
  rem.setAttribute('aria-label', 'Remove one ' + (card.name || id));
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'simqtybtn sim-add';
  add.textContent = '+';
  add.setAttribute('aria-label', 'Add one ' + (card.name || id));
  row.append(open, rem, make('span', 'simqty', '0'), add);
  return row;
}
function renderPicks() {
  const box = document.getElementById('simPick');
  box.innerHTML = '';
  const d = currentDeck();
  if (!d) {
    box.appendChild(make('p', 'simempty', 'Save a deck in the builder first.'));
    return;
  }
  const entries = Object.entries(d.cards || {}).filter(([, q]) => Number(q) > 0);
  if (!entries.length) {
    box.appendChild(make('p', 'simempty', 'This deck has no cards yet. Add some in the builder.'));
    return;
  }
  const cards = entries.map(([id, q]) => ({ id: id, q: Math.floor(Number(q) || 0), c: cardOf(id) }));
  cards.sort((a, b) =>
    (TYPE_ORDER[a.c.type] ?? 9) - (TYPE_ORDER[b.c.type] ?? 9) ||
    (Number(a.c.cost) || 0) - (Number(b.c.cost) || 0) ||
    String(a.c.name || '').localeCompare(String(b.c.name || '')));
  let last = '';
  for (const item of cards) {
    const type = item.c.type || 'Card';
    if (type !== last) {
      last = type;
      box.appendChild(make('div', 'dsection', type));
    }
    box.appendChild(pickRow(item.id, item.q, item.c));
  }
}
function syncPicks() {
  clampPicks();
  const total = pickedTotal();
  document.getElementById('simHandCount').textContent = total + ' / ' + HAND_MAX;
  document.querySelectorAll('#simPick .simpick').forEach(row => {
    const id = row.dataset.id;
    const n = setup.picks[id] || 0;
    row.querySelector('.simqty').textContent = String(n);
    row.querySelector('.sim-add').disabled = n >= copiesOf(id) || total >= HAND_MAX;
    row.querySelector('.sim-rem').disabled = n <= 0;
  });
}
function addPick(id) {
  if ((setup.picks[id] || 0) >= copiesOf(id) || pickedTotal() >= HAND_MAX) return;
  setup.picks[id] = (setup.picks[id] || 0) + 1;
  syncPicks();
}
function remPick(id) {
  const n = setup.picks[id] || 0;
  if (n <= 1) delete setup.picks[id];
  else setup.picks[id] = n - 1;
  syncPicks();
}
function renderScenarios() {
  const box = document.getElementById('simScenarios');
  box.innerHTML = '';
  const list = readScenarios();
  if (!list.length) {
    box.appendChild(make('p', 'simempty', 'No saved scenarios yet.'));
    return;
  }
  for (const sc of list) {
    const row = make('div', 'simscen');
    const deck = store.decks[sc.deckId];
    const info = make('div', 'siminfo');
    info.appendChild(make('div', 'simname', sc.name));
    info.appendChild(make('div', 'simsub',
      (deck ? deck.name : 'Missing deck') + ' · ' + sc.donField + ' DON (' + sc.donRested + ' rested) · ' + sc.handIds.length + ' in hand'));
    const load = document.createElement('button');
    load.type = 'button';
    load.className = 'sim-load';
    load.dataset.scenario = sc.id;
    load.textContent = 'Load';
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'sim-del';
    del.dataset.scenario = sc.id;
    del.textContent = 'Delete';
    row.append(info, load, del);
    box.appendChild(row);
  }
}
function renderResume() {
  document.getElementById('simResumeWrap').hidden = !play;
  document.getElementById('simStart').textContent = play ? 'Start over' : 'Start turn';
  document.getElementById('simStart').disabled = !currentDeck();
}
function renderSetup() {
  renderDeckSelect();
  renderLeaderPreview();
  renderDonSetup();
  renderPicks();
  syncPicks();
  renderScenarios();
  renderResume();
}

function boardRow(item, zone) {
  const card = cardOf(item.id);
  const attached = item.attached || 0;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'simrow' + (item.rested ? ' rested' : '');
  btn.dataset.zone = zone;
  btn.dataset.id = item.id;
  if (item.uid) btn.dataset.uid = item.uid;
  btn.dataset.attached = String(attached);
  btn.dataset.rested = item.rested ? '1' : '0';
  const total = shownPower(card, attached);
  if (total != null) btn.dataset.power = String(total);
  const cost = cardCost(card);
  if (cost.known) btn.dataset.cost = String(cost.cost);
  btn.style.borderLeft = '4px solid ' + colorOf(card);
  const img = cardImg(card, card.name || item.id);
  const info = make('span', 'siminfo');
  info.appendChild(make('span', 'simname', card.name || item.id));
  const sub = [];
  if (card.type !== 'Leader') sub.push(cost.known ? 'Cost ' + cost.cost : 'Cost —');
  if (total != null) sub.push('Power ' + total);
  info.appendChild(make('span', 'simsub', sub.join(' · ')));
  const flags = [];
  if (item.rested) flags.push('Rested');
  if (attached) flags.push('DON ×' + attached + ' · +' + (attached * 1000));
  if (flags.length) info.appendChild(make('span', 'simflags', flags.join(' · ')));
  if (card.text) info.appendChild(make('span', 'simtext', card.text));
  btn.append(img, info);
  return btn;
}
function fillZone(el, items, zone, empty) {
  el.innerHTML = '';
  if (!items.length) {
    el.appendChild(make('p', 'simempty', empty));
    return;
  }
  for (const item of items) el.appendChild(boardRow(item, zone));
}
function renderDonBar() {
  const attached = attachedCount(play);
  document.getElementById('nDonDeck').textContent = String(play.don.deck);
  document.getElementById('nDonActive').textContent = String(play.don.active);
  document.getElementById('nDonRested').textContent = String(play.don.rested);
  document.getElementById('nDonAttached').textContent = String(attached);
  const sum = play.don.deck + play.don.active + play.don.rested + attached;
  const sumEl = document.getElementById('simDonSum');
  sumEl.textContent = 'DON deck ' + play.don.deck + ' + active ' + play.don.active + ' + rested ' + play.don.rested + ' + attached ' + attached + ' = ' + sum;
  sumEl.classList.toggle('bad', sum !== DON_TOTAL);
  document.getElementById('simRestDon').disabled = play.don.active <= 0;
  document.getElementById('simStandDon').disabled = play.don.rested <= 0;
  document.getElementById('simAddActive').disabled = play.don.deck <= 0;
  document.getElementById('simAddRested').disabled = play.don.deck <= 0;
  document.getElementById('simMinusActive').disabled = play.don.active <= 0;
  document.getElementById('simMinusRested').disabled = play.don.rested <= 0;
  document.getElementById('simUndo').disabled = past.length === 0;
  document.getElementById('simDraw').disabled = play.deck.length === 0;
  document.getElementById('simDrawPick').disabled = play.deck.length === 0;
}
function renderPlay() {
  if (!play) return;
  const leaderBox = document.getElementById('simLeader');
  leaderBox.innerHTML = '';
  if (!play.leaderId) leaderBox.appendChild(make('p', 'simempty', 'No leader in this deck.'));
  else {
    const btn = boardRow({ id: play.leaderId, rested: play.leader.rested, attached: play.leader.attached }, 'leader');
    btn.id = 'simLeaderCard';
    leaderBox.appendChild(btn);
  }
  document.getElementById('simHChars').textContent = 'Characters (' + play.chars.length + ')';
  document.getElementById('simHStage').textContent = 'Stage (' + play.stages.length + ')';
  document.getElementById('simHHand').textContent = 'Hand (' + play.hand.length + ')';
  fillZone(document.getElementById('simChars'), play.chars, 'char', 'No characters yet. Play one from hand.');
  fillZone(document.getElementById('simStages'), play.stages, 'stage', 'No stage.');
  fillZone(document.getElementById('simHand'), play.hand, 'hand', 'Hand is empty.');
  fillZone(document.getElementById('simTrash'), play.trash, 'trash', 'Trash is empty.');
  const next = play.deck.length ? cname(play.deck[0]) : '';
  document.getElementById('simDeckInfo').textContent = play.deck.length + ' cards left' +
    (next ? '. Next draw: ' + next : '') + '. Trash ' + play.trash.length + '.';
  renderDonBar();
}

function sheetBtn(label, act, extra) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'simbtn' + (extra && extra.cls ? ' ' + extra.cls : '');
  b.textContent = label;
  b.dataset.act = act;
  if (extra) {
    if (extra.uid) b.dataset.uid = extra.uid;
    if (extra.zone) b.dataset.zone = extra.zone;
    if (extra.id) b.dataset.id = extra.id;
    if (extra.disabled) b.disabled = true;
  }
  return b;
}
function metaLine(card, inst) {
  const bits = [];
  if (card.type) bits.push(card.type);
  const cost = cardCost(card);
  if (card.type !== 'Leader') bits.push(cost.known ? 'Cost ' + cost.cost : 'Cost —');
  const attached = inst && inst.attached ? inst.attached : 0;
  const total = shownPower(card, attached);
  if (total != null) {
    bits.push(attached ? 'Power ' + total + ' (' + cardPower(card) + '+' + (attached * 1000) + ')' : 'Power ' + total);
  }
  if (attached) bits.push('DON ×' + attached);
  if (card.type === 'Leader' && card.life != null && card.life !== '') bits.push('Life ' + card.life);
  if (card.counter) bits.push('Counter +' + card.counter);
  if (inst && inst.rested) bits.push('Rested');
  return bits.join(' · ');
}
function fillSheet(card, zone, uid, inst) {
  document.getElementById('simSheetCard').hidden = false;
  const img = document.getElementById('simSheetImg');
  img.alt = card.name || '';
  if (typeof attachCardImage === 'function') attachCardImage(img, card);
  else if (card.img) img.src = card.img;
  else img.removeAttribute('src');
  document.getElementById('simSheetName').textContent = card.name || card.id || 'Card';
  document.getElementById('simSheetMeta').textContent = metaLine(card, inst);
  const text = document.getElementById('simSheetText');
  text.textContent = card.text ? card.text : 'No effect text.';
  text.scrollTop = 0;
  const warn = document.getElementById('simSheetWarn');
  warn.textContent = '';
  const acts = document.getElementById('simSheetActs');
  acts.innerHTML = '';
  acts.scrollTop = 0;
  const extra = { uid: uid, zone: zone, id: card.id };
  const cost = cardCost(card);
  if (zone === 'hand') {
    if (!cost.known) acts.appendChild(sheetBtn('Play (no cost listed)', 'play', Object.assign({ cls: 'gold' }, extra)));
    else if (play.don.active >= cost.cost) {
      const label = cost.cost === 0 ? 'Play — cost 0' : 'Play — rest ' + cost.cost + ' DON';
      acts.appendChild(sheetBtn(label, 'play', Object.assign({ cls: 'gold' }, extra)));
    } else {
      warn.textContent = 'Only ' + play.don.active + ' active DON. Cost is ' + cost.cost + '. Play anyway rests ' + play.don.active + ' and still plays the card.';
      acts.appendChild(sheetBtn('Play anyway', 'play-override', Object.assign({ cls: 'warn' }, extra)));
    }
    acts.appendChild(sheetBtn('Trash', 'trash', Object.assign({ cls: 'danger' }, extra)));
  } else if (zone === 'leader' || zone === 'char' || zone === 'stage') {
    if (inst && inst.rested) acts.appendChild(sheetBtn('Re-stand', 'stand', extra));
    else acts.appendChild(sheetBtn('Rest', 'rest', extra));
    if (zone === 'leader' || zone === 'char') {
      acts.appendChild(sheetBtn('Attach DON (+1000)', 'attach', Object.assign({ disabled: play.don.active <= 0 }, extra)));
      acts.appendChild(sheetBtn('DON!! −1 to deck', 'minus-attached', Object.assign({ disabled: !(inst && inst.attached) }, extra)));
    }
    if (zone === 'char') {
      acts.appendChild(sheetBtn('K.O.', 'ko', Object.assign({ cls: 'danger' }, extra)));
      acts.appendChild(sheetBtn('Trash', 'trash', Object.assign({ cls: 'danger' }, extra)));
      acts.appendChild(sheetBtn('Return to hand', 'to-hand', extra));
    }
    if (zone === 'stage') {
      acts.appendChild(sheetBtn('Trash', 'trash', Object.assign({ cls: 'danger' }, extra)));
      acts.appendChild(sheetBtn('Return to hand', 'to-hand', extra));
    }
  } else if (zone === 'trash') {
    acts.appendChild(sheetBtn('Return to hand', 'to-hand', Object.assign({ cls: 'gold' }, extra)));
  }
  if (card.id && byId.has(card.id)) acts.appendChild(sheetBtn('Full card', 'open-card', { id: card.id }));
  acts.appendChild(sheetBtn('Close', 'close'));
  document.getElementById('simSheet').hidden = false;
}
function openBoard(row) {
  if (!play) return;
  const zone = row.dataset.zone;
  const uid = row.dataset.uid || '';
  const id = zone === 'leader' ? play.leaderId : row.dataset.id;
  if (!id) return;
  let inst = null;
  if (zone === 'leader') inst = play.leader;
  else if (zone === 'char') inst = play.chars.find(c => c.uid === uid);
  else if (zone === 'stage') inst = play.stages.find(c => c.uid === uid);
  else if (zone === 'hand') inst = play.hand.find(c => c.uid === uid);
  else if (zone === 'trash') inst = play.trash.find(c => c.uid === uid);
  if (!inst) return;
  fillSheet(cardOf(id), zone, uid, inst);
}
function openDrawSheet() {
  if (!play || !play.deck.length) return;
  const counts = new Map();
  for (const id of play.deck) counts.set(id, (counts.get(id) || 0) + 1);
  document.getElementById('simSheetCard').hidden = true;
  document.getElementById('simSheetName').textContent = 'Draw a card';
  document.getElementById('simSheetMeta').textContent = play.deck.length + ' left in the deck';
  document.getElementById('simSheetText').textContent = '';
  document.getElementById('simSheetWarn').textContent = '';
  const acts = document.getElementById('simSheetActs');
  acts.innerHTML = '';
  for (const [id, n] of counts) {
    const c = cardOf(id);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'simrow';
    b.dataset.act = 'draw-one';
    b.dataset.id = id;
    const img = cardImg(c);
    const info = make('span', 'siminfo');
    info.appendChild(make('span', 'simname', c.name || id));
    info.appendChild(make('span', 'simsub', (c.type || 'Card') + (n > 1 ? ' · ×' + n + ' left' : '') + ' · ' + id));
    b.append(img, info);
    acts.appendChild(b);
  }
  acts.appendChild(sheetBtn('Close', 'close'));
  document.getElementById('simSheet').hidden = false;
}
function closeSheet() {
  const sheet = document.getElementById('simSheet');
  if (sheet) sheet.hidden = true;
}
function doAct(btn) {
  const act = btn.dataset.act;
  if (act === 'close') { closeSheet(); return; }
  if (act === 'open-card') {
    const c = byId.get(btn.dataset.id);
    if (c) openModal(c, 'browse');
    return;
  }
  if (act === 'draw-one') { commit(s => drawSpecific(s, btn.dataset.id)); return; }
  const uid = btn.dataset.uid || '';
  const zone = btn.dataset.zone || '';
  commit(s => {
    if (act === 'play') return payAndPlay(s, uid, false);
    if (act === 'play-override') return payAndPlay(s, uid, true);
    if (act === 'trash') return moveToTrash(s, zone, uid, 'Trashed');
    if (act === 'ko') return moveToTrash(s, zone, uid, 'K.O.');
    if (act === 'to-hand') return moveToHand(s, zone, uid);
    if (act === 'rest') return setRested(s, zone, uid, true);
    if (act === 'stand') return setRested(s, zone, uid, false);
    if (act === 'attach') return attachDon(s, zone, uid);
    if (act === 'minus-attached') return minusAttached(s, zone, uid);
    return null;
  });
}

function showSetup() {
  view = 'setup';
  document.getElementById('simSetup').hidden = false;
  document.getElementById('simPlay').hidden = true;
  document.getElementById('simDonBar').hidden = true;
  document.getElementById('simTitle').textContent = 'DON turn';
  renderSetup();
  document.getElementById('simScroll').scrollTop = 0;
}
function showPlay() {
  view = 'play';
  document.getElementById('simSetup').hidden = true;
  document.getElementById('simPlay').hidden = false;
  document.getElementById('simDonBar').hidden = false;
  const d = play && store.decks[play.setup.deckId];
  document.getElementById('simTitle').textContent = d && d.name ? d.name : 'DON turn';
  renderPlay();
  document.getElementById('simScroll').scrollTop = 0;
}
function hideSim() {
  const root = document.getElementById('sim');
  root.hidden = true;
  document.getElementById('app').removeAttribute('aria-hidden');
  document.getElementById('btnDonSim').setAttribute('aria-pressed', 'false');
  closeSheet();
}
function closeSim() {
  const root = document.getElementById('sim');
  if (root.hidden) return;
  if (history.state && history.state.optcgSim) {
    suppressPop++;
    hideSim();
    const done = () => {
      suppressPop = Math.max(0, suppressPop - 1);
      window.removeEventListener('popstate', done);
    };
    window.addEventListener('popstate', done);
    history.back();
    setTimeout(done, 800);
  } else hideSim();
}
function openSim() {
  const root = document.getElementById('sim');
  if (!root.hidden) return;
  const deckWas = typeof deckDrawerOpen === 'function' && deckDrawerOpen();
  if (typeof closePanels === 'function') closePanels();
  const show = () => {
    root.hidden = false;
    document.getElementById('app').setAttribute('aria-hidden', 'true');
    document.getElementById('btnDonSim').setAttribute('aria-pressed', 'true');
    if (!history.state || !history.state.optcgSim) history.pushState({ optcgSim: 1 }, '');
    if (view === 'play' && play) showPlay();
    else showSetup();
    const closeBtn = document.getElementById('simClose');
    if (closeBtn) {
      try { closeBtn.focus({ preventScroll: true }); }
      catch (err) { closeBtn.focus(); }
    }
  };
  if (deckWas && typeof historyChain !== 'undefined') historyChain = historyChain.then(show);
  else show();
}
function onPop() {
  if (typeof suppressPop !== 'undefined' && suppressPop) return;
  const root = document.getElementById('sim');
  if (!root || root.hidden) return;
  if (history.state && history.state.optcgSim) return;
  hideSim();
}
function onSimClick(e) {
  const t = e.target;
  if (!(t instanceof Element)) return;
  const act = t.closest('#simSheet [data-act]');
  if (act) { doAct(act); return; }
  if (t.closest('#simSheetScrim')) { closeSheet(); return; }
  const add = t.closest('.sim-add');
  if (add) { addPick(add.closest('.simpick').dataset.id); return; }
  const rem = t.closest('.sim-rem');
  if (rem) { remPick(rem.closest('.simpick').dataset.id); return; }
  const opener = t.closest('.simpick-open');
  if (opener) {
    const c = byId.get(opener.closest('.simpick').dataset.id);
    if (c) openModal(c, 'browse');
    return;
  }
  const load = t.closest('.sim-load');
  if (load) { loadScenario(load.dataset.scenario); return; }
  const del = t.closest('.sim-del');
  if (del) { deleteScenario(del.dataset.scenario); return; }
  const row = t.closest('#simPlay .simrow');
  if (row) openBoard(row);
}

function initDonSim() {
  document.getElementById('btnDonSim').onclick = openSim;
  document.getElementById('simClose').onclick = closeSim;
  document.getElementById('simDonFieldDec').onclick = () => bumpField(-1);
  document.getElementById('simDonFieldInc').onclick = () => bumpField(1);
  document.getElementById('simDonRestedDec').onclick = () => bumpRested(-1);
  document.getElementById('simDonRestedInc').onclick = () => bumpRested(1);
  document.getElementById('simDeck').onchange = () => {
    const id = document.getElementById('simDeck').value;
    if (id === setup.deckId) return;
    setup.deckId = id;
    setup.picks = {};
    renderLeaderPreview();
    renderPicks();
    syncPicks();
  };
  document.getElementById('simStart').onclick = startTurn;
  document.getElementById('simResume').onclick = () => { if (play) showPlay(); };
  document.getElementById('simEditSetup').onclick = () => showSetup();
  document.getElementById('simSave').onclick = saveScenario;
  document.getElementById('simScenarioName').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); saveScenario(); }
  });
  document.getElementById('simUndo').onclick = undo;
  document.getElementById('simReset').onclick = resetTurn;
  document.getElementById('simRestDon').onclick = () => commit(restOneDon);
  document.getElementById('simStandDon').onclick = () => commit(standOneDon);
  document.getElementById('simAddActive').onclick = () => commit(s => addDon(s, true));
  document.getElementById('simAddRested').onclick = () => commit(s => addDon(s, false));
  document.getElementById('simMinusActive').onclick = () => commit(s => minusDon(s, true));
  document.getElementById('simMinusRested').onclick = () => commit(s => minusDon(s, false));
  document.getElementById('simDraw').onclick = () => commit(drawNext);
  document.getElementById('simDrawPick').onclick = openDrawSheet;
  document.getElementById('sim').addEventListener('click', onSimClick);
  window.addEventListener('popstate', onPop);
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const root = document.getElementById('sim');
    if (!root || root.hidden) return;
    if (document.getElementById('modal').classList.contains('open')) return;
    if (!document.getElementById('simSheet').hidden) { closeSheet(); e.preventDefault(); }
  });
  window.refreshDonSim = function () {
    const root = document.getElementById('sim');
    if (!root || root.hidden) return;
    if (view === 'play' && play) renderPlay();
    else renderSetup();
  };
}
try { initDonSim(); }
catch (err) { /* the builder still opens if the simulator cannot bind */ }
