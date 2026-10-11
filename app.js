'use strict';

/* ---------- Storage ----------
 * Everything lives in one JSON blob in localStorage. All reads/writes go
 * through load()/save() so a sync backend can be swapped in later.
 */
const KEY = 'feeding.v1';
const ML_PER_OZ = 29.5735;

const TYPES = {
  nurse:  { label: 'Nurse',  title: 'Nursing', icon: '♡', color: 'var(--nurse)' },
  bottle: { label: 'Bottle', title: 'Bottle',  icon: '🍼', color: 'var(--bottle)' },
  pump:   { label: 'Pump',   title: 'Pumping', icon: '🥛', color: 'var(--pump)' },
  diaper: { label: 'Diaper', title: 'Diaper',  icon: '◇', color: 'var(--diaper)' },
  sleep:  { label: 'Sleep',  title: 'Sleep',   icon: '☾', color: 'var(--sleep)' },
  note:   { label: 'Note',   title: 'Note',    icon: '✎', color: 'var(--muted)' },
};
const DIAPERS = {
  wet:   { label: 'Wet',   sub: 'pee' },
  dirty: { label: 'Dirty', sub: 'poop' },
  mixed: { label: 'Mixed', sub: 'wet + dirty' },
  dry:   { label: 'Dry',   sub: 'clean' },
};

function defaultState() {
  return {
    version: 1,
    settings: { babyName: '', birthDate: '', unit: 'ml', theme: 'auto' },
    events: [],
    timers: {},
    sync: { family: null, lastServerAt: 0, pending: {}, pendingBaby: false },
  };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    const s = JSON.parse(raw);
    const d = defaultState();
    return { ...d, ...s, settings: { ...d.settings, ...s.settings }, timers: s.timers || {}, sync: { ...d.sync, ...s.sync } };
  } catch (e) {
    console.error(e);
    return defaultState();
  }
}

let state = load();

function save() {
  localStorage.setItem(KEY, JSON.stringify(state));
  if (navigator.storage && navigator.storage.persist && !save.asked) {
    save.asked = true;
    navigator.storage.persist().catch(() => {});
  }
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function upsert(ev) {
  ev.updated = Date.now();
  const i = state.events.findIndex(e => e.id === ev.id);
  if (i >= 0) state.events[i] = ev; else state.events.push(ev);
  state.events.sort((a, b) => b.start - a.start);
  save();
  Sync.push(ev);
}

function remove(id) {
  const i = state.events.findIndex(e => e.id === id);
  if (i < 0) return;
  const [ev] = state.events.splice(i, 1);
  save();
  Sync.pushDelete(id);
  toast(`${TYPES[ev.type].title} deleted`, 'Undo', () => { upsert(ev); render(); });
}

/* ---------- Formatting ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');

function fmtTime(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
function fmtClock(ms) { // 1:05:09 / 12:04
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}
function fmtDur(ms) { // 1h 5m / 12m / <1m
  const m = Math.round(ms / 60000);
  if (m < 1) return ms > 0 ? '<1m' : '0m';
  const h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : `${m}m`;
}
function fmtAgo(ms) {
  const d = Date.now() - ms;
  if (d < 60000) return 'just now';
  return `${fmtDur(d)} ago`;
}
function fmtAmount(ml) {
  if (ml == null || ml === '') return '';
  return state.settings.unit === 'oz'
    ? `${(ml / ML_PER_OZ).toFixed(1).replace(/\.0$/, '')} oz`
    : `${Math.round(ml)} ml`;
}
const toUnit = ml => state.settings.unit === 'oz' ? +(ml / ML_PER_OZ).toFixed(1) : Math.round(ml);
const fromUnit = v => state.settings.unit === 'oz' ? v * ML_PER_OZ : v;
const unitStep = () => state.settings.unit === 'oz' ? 0.5 : 10;

function toLocalInput(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(v, orig) {
  if (orig != null && v === toLocalInput(orig)) return orig; // untouched: keep seconds
  const t = new Date(v).getTime();
  return isNaN(t) ? (orig ?? Date.now()) : t;
}

function startOfDay(ms) { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }
function dayLabel(ms) {
  const today = startOfDay(Date.now());
  const day = startOfDay(ms);
  if (day === today) return 'Today';
  if (day === today - 864e5) return 'Yesterday';
  return new Date(ms).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
}

function babyAge() {
  const b = state.settings.birthDate;
  if (!b) return '';
  const birth = new Date(b + 'T00:00');
  const days = Math.floor((startOfDay(Date.now()) - birth.getTime()) / 864e5);
  if (days < 0) return '';
  if (days < 14) return `${days} day${days === 1 ? '' : 's'} old`;
  if (days < 84) { const w = Math.floor(days / 7), d = days % 7; return `${w} weeks${d ? ` ${d} day${d === 1 ? '' : 's'}` : ''}`; }
  const now = new Date();
  let months = (now.getFullYear() - birth.getFullYear()) * 12 + now.getMonth() - birth.getMonth();
  if (now.getDate() < birth.getDate()) months--;
  return months < 24 ? `${months} months` : `${Math.floor(months / 12)} years`;
}

function describe(ev) {
  switch (ev.type) {
    case 'nurse': {
      const parts = [];
      if (ev.left) parts.push(`L ${fmtDur(ev.left * 1000)}`);
      if (ev.right) parts.push(`R ${fmtDur(ev.right * 1000)}`);
      if (ev.lastSide) parts.push(`ended ${ev.lastSide}`);
      return parts.join(' · ');
    }
    case 'bottle': return `${fmtAmount(ev.amount)} ${ev.milk === 'formula' ? 'formula' : 'breast milk'}`;
    case 'pump': {
      const total = (ev.left || 0) + (ev.right || 0);
      return `L ${fmtAmount(ev.left || 0)} · R ${fmtAmount(ev.right || 0)} · ${fmtAmount(total)} total`;
    }
    case 'diaper': return (DIAPERS[ev.kind]?.label || '') + (ev.rash ? ' · rash' : '');
    case 'sleep': return ev.end ? fmtDur(ev.end - ev.start) : 'sleeping…';
    case 'note': return ev.note || '';
  }
  return '';
}

/* ---------- Derived data ---------- */
const isFeed = e => e.type === 'nurse' || e.type === 'bottle';
const lastOf = pred => state.events.find(pred); // events sorted newest first
const isWet = e => e.type === 'diaper' && (e.kind === 'wet' || e.kind === 'mixed');
const isDirty = e => e.type === 'diaper' && (e.kind === 'dirty' || e.kind === 'mixed');

function dayStats(dayStart) {
  const end = dayStart + 864e5;
  const evs = state.events.filter(e => e.start >= dayStart && e.start < end);
  const s = { feeds: 0, nurseMin: 0, bottleMl: 0, pumpMl: 0, wet: 0, dirty: 0, diapers: 0, sleepMin: 0 };
  for (const e of evs) {
    if (isFeed(e)) s.feeds++;
    if (e.type === 'nurse') s.nurseMin += ((e.left || 0) + (e.right || 0)) / 60;
    if (e.type === 'bottle') s.bottleMl += e.amount || 0;
    if (e.type === 'pump') s.pumpMl += (e.left || 0) + (e.right || 0);
    if (e.type === 'diaper') s.diapers++;
    if (isWet(e)) s.wet++;
    if (isDirty(e)) s.dirty++;
    if (e.type === 'sleep' && e.end) s.sleepMin += (e.end - e.start) / 60000;
  }
  return s;
}

/* ---------- Timers ---------- */
function nurseElapsed(t, side, now = Date.now()) {
  return (t.acc[side] || 0) + (t.side === side ? now - t.segStart : 0);
}
function tapSide(side) {
  const now = Date.now();
  let t = state.timers.nurse;
  if (!t) {
    t = state.timers.nurse = { startedAt: now, acc: { L: 0, R: 0 }, side: null, segStart: null, lastSide: null };
  }
  if (t.side) t.acc[t.side] += now - t.segStart;
  if (t.side === side) { t.side = null; t.segStart = null; }
  else { t.side = side; t.segStart = now; t.lastSide = side; }
  save();
}
function saveNurseTimer() {
  const t = state.timers.nurse;
  if (!t) return false;
  const now = Date.now();
  const left = Math.round(nurseElapsed(t, 'L', now) / 1000);
  const right = Math.round(nurseElapsed(t, 'R', now) / 1000);
  delete state.timers.nurse;
  if (left + right < 1) { save(); return false; }
  upsert({ id: uid(), type: 'nurse', start: t.startedAt, end: now, left, right, lastSide: t.lastSide });
  return true;
}

/* ---------- Live ticking ---------- */
let tickers = [];
function onTick(fn) { tickers.push(fn); fn(); }
setInterval(() => {
  $('#clock').textContent = fmtTime(Date.now());
  tickers = tickers.filter(fn => fn() !== false);
}, 1000);

/* ---------- Views ---------- */
let tab = 'home';
let historyFilter = 'all';
let historyMode = 'list';
try { historyMode = localStorage.getItem('feeding.historyMode') || 'list'; } catch (e) { /* storage unavailable */ }
let weekOffset = 0; // 0 = this week, -1 = last week, …

function render() {
  tickers = [];
  applyTheme();
  $('#babyName').textContent = state.settings.babyName || 'Baby';
  $('#babyAge').textContent = babyAge();
  $('#clock').textContent = fmtTime(Date.now());
  $$('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  const view = $('#view');
  view.innerHTML = ({ home: viewHome, history: viewHistory, stats: viewStats, settings: viewSettings })[tab]();
  if (tab === 'home') mountHome(view);
  if (tab === 'history') mountHistory(view);
  if (tab === 'settings') mountSettings(view);
  bindRows(view);
}

function rowHtml(ev) {
  const t = TYPES[ev.type];
  return `<button class="row" data-id="${ev.id}" style="--c:${t.color}">
    <span class="dot">${t.icon}</span>
    <span class="main"><div class="title">${t.title}</div><div class="detail">${esc(describe(ev))}${ev.note && ev.type !== 'note' ? ' · ' + esc(ev.note) : ''}</div></span>
    <span class="time">${fmtTime(ev.start)}</span>
  </button>`;
}
function bindRows(root) {
  $$('.row[data-id]', root).forEach(r => r.addEventListener('click', () => {
    const ev = state.events.find(e => e.id === r.dataset.id);
    if (ev) openEditor(ev.type, ev);
  }));
}

function viewHome() {
  const lastFeed = lastOf(isFeed);
  const lastNurse = lastOf(e => e.type === 'nurse');
  const lastDiaper = lastOf(e => e.type === 'diaper');
  const today = dayStats(startOfDay(Date.now()));
  const tiles = Object.entries(TYPES).map(([k, t]) => `
    <button class="tile" data-act="${k}" style="--c:${t.color}">
      <span class="ico">${t.icon}</span>${t.label}<span class="live" data-live="${k}"></span>
    </button>`).join('');
  const recent = state.events.slice(0, 6);
  return `
    <div class="glance">
      <div class="card">
        <div class="label">Last feed</div>
        <div class="value" data-ago="${lastFeed?.start ?? ''}">${lastFeed ? fmtAgo(lastFeed.start) : '—'}</div>
        <div class="sub">${lastFeed ? `${fmtTime(lastFeed.start)} · ${TYPES[lastFeed.type].title.toLowerCase()}` : 'No feeds yet'}</div>
      </div>
      <div class="card">
        <div class="label">Last diaper</div>
        <div class="value" data-ago="${lastDiaper?.start ?? ''}">${lastDiaper ? fmtAgo(lastDiaper.start) : '—'}</div>
        <div class="sub">${lastDiaper ? `${fmtTime(lastDiaper.start)} · ${DIAPERS[lastDiaper.kind]?.label.toLowerCase()}` : 'No changes yet'}</div>
      </div>
      <div class="card wide" style="--c:var(--nurse)">
        <div class="label">Today</div>
        <div class="sub" style="color:var(--text);font-size:15px">
          <b>${today.feeds}</b> feeds · <b>${Math.round(today.nurseMin)}</b> min nursing${today.bottleMl ? ` · <b>${fmtAmount(today.bottleMl)}</b> bottle` : ''}<br>
          <b>${today.wet}</b> wet · <b>${today.dirty}</b> dirty${lastNurse?.lastSide ? ` · last side <span class="badge">${lastNurse.lastSide}</span>` : ''}
        </div>
      </div>
    </div>
    <h2>Log</h2>
    <div class="actions">${tiles}</div>
    <h2>Recent</h2>
    <div class="list">${recent.length ? recent.map(rowHtml).join('') : '<div class="empty">Tap a button above to log the first entry.</div>'}</div>`;
}

function mountHome(view) {
  $$('.tile', view).forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.act;
    if (k === 'nurse') openNurseTimer();
    else if (k === 'sleep') openSleep();
    else openEditor(k);
  }));
  onTick(() => {
    const n = state.timers.nurse, s = state.timers.sleep, now = Date.now();
    const nl = $('[data-live="nurse"]', view), sl = $('[data-live="sleep"]', view);
    if (!nl) return false;
    nl.textContent = n ? fmtClock(nurseElapsed(n, 'L', now) + nurseElapsed(n, 'R', now)) + (n.side ? ` ${n.side}` : ' ❚❚') : '';
    nl.closest('.tile').classList.toggle('running', !!n);
    sl.textContent = s ? fmtClock(now - s.startedAt) : '';
    sl.closest('.tile').classList.toggle('running', !!s);
    $$('[data-ago]', view).forEach(el => { if (el.dataset.ago) el.textContent = fmtAgo(+el.dataset.ago); });
  });
}

function viewHistory() {
  const chips = ['all', ...Object.keys(TYPES)].map(k =>
    `<button class="chip ${historyFilter === k ? 'on' : ''}" data-f="${k}">${k === 'all' ? 'All' : TYPES[k].title}</button>`).join('');
  const modes = `<div class="seg hist-mode">${[['list', 'List'], ['week', 'Week']].map(([v, l]) =>
    `<button data-mode="${v}" class="${historyMode === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  if (historyMode === 'week') return `${modes}<div class="chips">${chips}</div>${viewWeek()}`;
  const evs = state.events.filter(e => historyFilter === 'all' || e.type === historyFilter);
  if (!evs.length) return `${modes}<div class="chips">${chips}</div><div class="empty">Nothing logged yet.</div>`;
  let html = '', curDay = null, buf = [];
  const flush = () => {
    if (curDay === null) return;
    const s = dayStats(curDay);
    html += `<div class="day-head">${dayLabel(curDay)}<span>${s.feeds} feeds · ${s.wet} wet · ${s.dirty} dirty</span></div><div class="list">${buf.join('')}</div>`;
    buf = [];
  };
  for (const e of evs.slice(0, 600)) {
    const d = startOfDay(e.start);
    if (d !== curDay) { flush(); curDay = d; }
    buf.push(rowHtml(e));
  }
  flush();
  return `${modes}<div class="chips">${chips}</div>${html}`;
}

/* Week timeline: one column per day (Mon–Sun), time of day running down. */
const LANES = { nurse: 0, bottle: 0, pump: 0, sleep: 1, diaper: 2, note: 2 };

function weekDays() {
  const d = new Date(startOfDay(Date.now()));
  d.setDate(d.getDate() - (d.getDay() + 6) % 7 + weekOffset * 7); // Monday
  const days = [];
  for (let i = 0; i < 7; i++) {
    const start = d.getTime();
    d.setDate(d.getDate() + 1); // setDate keeps DST days at 23/25h
    days.push({ start, end: d.getTime() });
  }
  return days;
}

function viewWeek() {
  const days = weekDays();
  const now = Date.now();
  const all = historyFilter === 'all';
  // Running timers show as live blocks
  const evs = state.events.filter(e => all || e.type === historyFilter);
  if (state.timers.nurse && (all || historyFilter === 'nurse')) evs.push({ id: 'timer:nurse', type: 'nurse', start: state.timers.nurse.startedAt, end: now });
  if (state.timers.sleep && (all || historyFilter === 'sleep')) evs.push({ id: 'timer:sleep', type: 'sleep', start: state.timers.sleep.startedAt, end: now });

  const first = new Date(days[0].start), last = new Date(days[6].start);
  const mon = d => d.toLocaleDateString([], { month: 'short' });
  const range = first.getMonth() === last.getMonth() ? mon(first) : `${mon(first)} – ${mon(last)}`;
  const today = startOfDay(now);

  const head = days.map(d => {
    const dt = new Date(d.start);
    return `<div class="wk-day ${d.start === today ? 'today' : ''}">
      <span>${dt.toLocaleDateString([], { weekday: 'short' }).slice(0, 2)}</span><b>${dt.getDate()}</b></div>`;
  }).join('');

  const hourPct = h => (h / 24) * 100;
  const axis = [0, 3, 6, 9, 12, 15, 18, 21, 24].map(h => {
    const label = h % 12 === 0 ? `12<small>${h === 12 ? 'PM' : 'AM'}</small>` : h === 6 || h === 18 ? `6<small>${h < 12 ? 'AM' : 'PM'}</small>` : String(h % 12);
    return `<div class="wk-tick" style="top:${hourPct(h)}%">${label}</div>`;
  }).join('');
  const lines = [3, 6, 9, 12, 15, 18, 21].map(h => `<div class="wk-line" style="top:${hourPct(h)}%"></div>`).join('');

  const cols = days.map(d => {
    const span = d.end - d.start;
    const blocks = [];
    for (const e of evs) {
      const hasDur = (e.type === 'nurse' || e.type === 'sleep') && e.end > e.start;
      const s = e.start, en = hasDur ? e.end : e.start;
      if (hasDur ? (en <= d.start || s >= d.end) : (s < d.start || s >= d.end)) continue;
      const from = Math.max(s, d.start), to = Math.min(en, d.end);
      const lane = all ? LANES[e.type] : 0;
      const t = TYPES[e.type];
      blocks.push(`<button class="wk-ev ${hasDur ? '' : 'pt'} ${all ? 'lane' : ''}" data-ev="${e.id}"
        style="--c:${t.color};top:${((from - d.start) / span) * 100}%;height:${((to - from) / span) * 100}%;${all ? `left:calc(${lane} * 100% / 3 + 1px)` : ''}"
        title="${esc(t.title)} ${fmtTime(e.start)}" aria-label="${esc(t.title)} ${fmtTime(e.start)}"></button>`);
    }
    const nowLine = d.start === today ? `<div class="wk-now" id="wkNow" style="top:${((now - d.start) / span) * 100}%"></div>` : '';
    return `<div class="wk-col ${d.start === today ? 'today' : ''}">${blocks.join('')}${nowLine}</div>`;
  }).join('');

  const legend = all ? `<div class="wk-legend">
      <span><i style="background:var(--nurse)"></i>Feeds &amp; pump</span>
      <span><i style="background:var(--sleep)"></i>Sleep</span>
      <span><i style="background:var(--diaper)"></i>Diapers &amp; notes</span></div>` : '';

  return `
    <div class="wk-nav">
      <button class="x" id="wkPrev" aria-label="Previous week">‹</button>
      <div><b>${range}</b> <span class="note">${weekOffset === 0 ? 'This week' : weekOffset === -1 ? 'Last week' : `${-weekOffset} weeks ago`}</span></div>
      <button class="x" id="wkNext" aria-label="Next week" ${weekOffset >= 0 ? 'disabled' : ''}>›</button>
    </div>
    <div class="wk card">
      <div class="wk-head"><div></div>${head}</div>
      <div class="wk-body">
        <div class="wk-axis">${axis}</div>
        <div class="wk-cols">
          <div class="wk-night" style="top:0;height:25%"></div>
          <div class="wk-night" style="top:75%;height:25%"></div>
          ${lines}${cols}
        </div>
      </div>
    </div>
    ${legend}`;
}

function mountHistory(view) {
  $$('.chip', view).forEach(c => c.addEventListener('click', () => { historyFilter = c.dataset.f; render(); }));
  $$('[data-mode]', view).forEach(b => b.addEventListener('click', () => {
    historyMode = b.dataset.mode;
    try { localStorage.setItem('feeding.historyMode', historyMode); } catch (e) { /* storage unavailable */ }
    render();
  }));
  if (historyMode !== 'week') return;
  $('#wkPrev', view).addEventListener('click', () => { weekOffset--; render(); });
  $('#wkNext', view).addEventListener('click', () => { if (weekOffset < 0) { weekOffset++; render(); } });
  $$('.wk-ev', view).forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.ev;
    if (id === 'timer:nurse') return openNurseTimer();
    if (id === 'timer:sleep') return openSleep();
    const ev = state.events.find(e => e.id === id);
    if (ev) openEditor(ev.type, ev);
  }));
  // Keep the "now" line moving
  onTick(() => {
    const line = $('#wkNow', view);
    if (!line) return false;
    const d0 = startOfDay(Date.now()), d1 = new Date(d0); d1.setDate(d1.getDate() + 1);
    line.style.top = ((Date.now() - d0) / (d1.getTime() - d0)) * 100 + '%';
  });
}

function viewStats() {
  const today = startOfDay(Date.now());
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    days.push({ start: d.getTime(), ...dayStats(d.getTime()) });
  }
  const chart = (key, color, fmt = v => Math.round(v)) => {
    const max = Math.max(1, ...days.map(d => d[key]));
    return `<div class="chart" style="--c:${color}">${days.map(d => `
      <div class="bar"><em>${d[key] ? fmt(d[key]) : ''}</em><i style="height:${(d[key] / max) * 80}%"></i>
      <b>${new Date(d.start).toLocaleDateString([], { weekday: 'narrow' })}</b></div>`).join('')}</div>`;
  };
  // Average gap between feeds over the last 24h
  const since = Date.now() - 864e5;
  const feeds = state.events.filter(e => isFeed(e) && e.start >= since).map(e => e.start).sort((a, b) => a - b);
  const gaps = feeds.slice(1).map((t, i) => t - feeds[i]);
  const avgGap = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
  const week = days.reduce((a, d) => ({ feeds: a.feeds + d.feeds, wet: a.wet + d.wet, dirty: a.dirty + d.dirty }), { feeds: 0, wet: 0, dirty: 0 });
  return `
    <div class="glance">
      <div class="card"><div class="label">Avg time between feeds (24h)</div><div class="value">${avgGap ? fmtDur(avgGap) : '—'}</div></div>
      <div class="card"><div class="label">Feeds / day (7d)</div><div class="value">${(week.feeds / 7).toFixed(1)}</div></div>
      <div class="card"><div class="label">Wet / day (7d)</div><div class="value">${(week.wet / 7).toFixed(1)}</div></div>
      <div class="card"><div class="label">Dirty / day (7d)</div><div class="value">${(week.dirty / 7).toFixed(1)}</div></div>
    </div>
    <h2>Feeds per day</h2><div class="card">${chart('feeds', 'var(--nurse)')}</div>
    <h2>Nursing minutes</h2><div class="card">${chart('nurseMin', 'var(--nurse)')}</div>
    <h2>Bottle volume</h2><div class="card">${chart('bottleMl', 'var(--bottle)', toUnit)}</div>
    <h2>Wet diapers</h2><div class="card">${chart('wet', 'var(--diaper)')}</div>
    <h2>Dirty diapers</h2><div class="card">${chart('dirty', 'var(--diaper)')}</div>
    <h2>Sleep (hours)</h2><div class="card">${chart('sleepMin', 'var(--sleep)', v => (v / 60).toFixed(1))}</div>`;
}

function viewSettings() {
  const s = state.settings;
  const seg = (name, opts, cur) => `<div class="seg" data-seg="${name}">${opts.map(([v, l]) =>
    `<button data-v="${v}" class="${cur === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  return `
    <h2>Baby</h2>
    <div class="card">
      <div class="field"><label>Name</label><input type="text" id="sName" value="${esc(s.babyName)}" placeholder="Baby"></div>
      <div class="field"><label>Birth date</label><input type="date" id="sBirth" value="${esc(s.birthDate)}"></div>
    </div>
    <h2>Display</h2>
    <div class="card">
      <div class="field"><label>Units</label>${seg('unit', [['ml', 'ml'], ['oz', 'oz']], s.unit)}</div>
      <div class="field"><label>Theme</label>${seg('theme', [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark'], ['night', 'Night']], s.theme)}</div>
      <p class="note">“Night” is a dim, red-shifted theme for 3 a.m. feeds.</p>
    </div>
    <h2>Sync between phones</h2>
    <div class="card">${syncSettingsHtml()}</div>
    <h2>Your data</h2>
    <div class="card">
      <p class="note" style="margin-top:0">${state.events.length} entries, stored on this phone${Sync.family ? ' and synced' : ''}. Export a backup regularly, or use it to copy data to another phone (Import merges, it doesn't overwrite).</p>
      <p class="note" id="persist"></p>
      <div class="btn-row">
        <button class="btn secondary" id="exp">Export backup</button>
        <button class="btn secondary" id="imp">Import</button>
      </div>
      <button class="btn secondary" id="csv">Export CSV (for pediatrician)</button>
      <input type="file" id="impFile" accept="application/json,.json" hidden>
      <button class="btn danger" id="wipe">Delete all data</button>
    </div>
    <p class="note" style="text-align:center;margin-top:20px">Feeding Log · works offline · no account, no tracking</p>`;
}

function mountSettings(view) {
  const set = (k, v) => { state.settings[k] = v; save(); };
  const setBaby = (k, v) => { state.settings.babyUpdated = Date.now(); set(k, v); Sync.pushBaby(); render(); };
  $('#sName', view).addEventListener('change', e => setBaby('babyName', e.target.value.trim()));
  $('#sBirth', view).addEventListener('change', e => setBaby('birthDate', e.target.value));
  $$('[data-seg]', view).forEach(seg => $$('button', seg).forEach(b => b.addEventListener('click', () => {
    set(seg.dataset.seg, b.dataset.v); render();
  })));
  mountSyncSettings(view);
  $('#exp', view).addEventListener('click', exportJson);
  $('#csv', view).addEventListener('click', exportCsv);
  $('#imp', view).addEventListener('click', () => $('#impFile', view).click());
  $('#impFile', view).addEventListener('change', e => e.target.files[0] && importJson(e.target.files[0]));
  $('#wipe', view).addEventListener('click', () => {
    if (confirm('Delete ALL entries and settings on this phone? This also stops syncing; the other phone keeps its copy. Export a backup first if unsure.')) {
      Sync.leave(); state = defaultState(); save(); render(); toast('All data deleted from this phone');
    }
  });
  if (navigator.storage && navigator.storage.persisted) {
    navigator.storage.persisted().then(p => {
      const el = $('#persist', view);
      if (el) el.textContent = p
        ? '✓ Storage is marked persistent (the browser won’t clear it automatically).'
        : 'Tip: on iPhone, use Share → Add to Home Screen so Safari doesn’t clear the data.';
    });
  }
}

function syncSettingsHtml() {
  if (!Sync.configured()) {
    return `<p class="note" style="margin:0">Live sync isn’t set up yet. Add your Firebase config to <code>sync-config.js</code> (see the README), then both phones will stay in sync automatically.</p>`;
  }
  if (!Sync.family) {
    return `
      <p class="note" style="margin-top:0">Keep both parents’ phones in sync. Start on one phone, then enter the same code on the other. Entries already on each phone are merged.</p>
      <button class="btn" id="syncCreate" style="--c:var(--nurse)">Start syncing (get a code)</button>
      <div class="field" style="margin-top:16px"><label>Or join with a code from the other phone</label>
        <input type="text" id="syncCode" placeholder="Paste code" autocapitalize="off" autocomplete="off" spellcheck="false"></div>
      <button class="btn secondary" id="syncJoin">Join</button>`;
  }
  return `
    <p class="note" style="margin-top:0">Family code. Enter this on the other phone under Settings → Join. Keep it private: anyone with it can see and edit the log.</p>
    <div class="setting-row" style="padding-top:0"><code id="syncCodeShow" style="font-size:15px;word-break:break-all;-webkit-user-select:all;user-select:all">${esc(Sync.family)}</code></div>
    <p class="note" id="syncStatus">${esc(Sync.statusText())}</p>
    <div class="btn-row">
      <button class="btn secondary" id="syncShare">Share code</button>
      <button class="btn secondary" id="syncLeave">Stop syncing</button>
    </div>`;
}

function mountSyncSettings(view) {
  const on = (id, fn) => { const el = $('#' + id, view); if (el) el.addEventListener('click', fn); };
  on('syncCreate', () => { Sync.create(); render(); toast('Syncing started: share the code with the other phone'); });
  on('syncJoin', () => {
    try { Sync.join($('#syncCode', view).value); render(); toast('Joined: syncing…'); }
    catch (e) { toast(e.message); }
  });
  on('syncShare', async () => {
    const text = Sync.family;
    try {
      if (navigator.share) await navigator.share({ title: 'Feeding Log sync code', text });
      else { await navigator.clipboard.writeText(text); toast('Code copied'); }
    } catch (e) { /* share sheet dismissed */ }
  });
  on('syncLeave', () => {
    if (!confirm('Stop syncing on this phone? Entries stay on this phone; new ones won’t be shared.')) return;
    Sync.leave(); render(); toast('Sync stopped on this phone');
  });
}

/* ---------- Sheets ---------- */
const sheet = $('#sheet');
let sheetTickers = [];
function openSheet(title, color, body, mount) {
  sheet.innerHTML = `<div class="sheet-inner" style="--c:${color}">
    <div class="sheet-head"><h3>${title}</h3><button class="x" aria-label="Close">✕</button></div>${body}</div>`;
  $('.x', sheet).addEventListener('click', closeSheet);
  if (!sheet.open) sheet.showModal();
  mount && mount(sheet);
}
function closeSheet() { if (sheet.open) sheet.close(); }
sheet.addEventListener('close', () => { sheetTickers.forEach(id => clearInterval(id)); sheetTickers = []; render(); });
sheet.addEventListener('click', e => { if (e.target === sheet) closeSheet(); }); // tap backdrop
function sheetTick(fn) { fn(); sheetTickers.push(setInterval(fn, 250)); }

function openNurseTimer() {
  const last = lastOf(e => e.type === 'nurse');
  const body = `
    <p class="note" style="margin:0 0 6px">${last?.lastSide ? `Last feed ended on <span class="badge">${last.lastSide === 'L' ? 'Left' : 'Right'}</span> · ${fmtAgo(last.start)}` : 'Tap a side to start the timer. Tap again to pause.'}</p>
    <div class="sides">
      ${['L', 'R'].map(s => `<button class="side" data-side="${s}">
        <span class="lr">${s}</span><span class="t" data-t="${s}">0:00</span><span class="hint" data-h="${s}">${last?.lastSide === s ? 'ended here last' : 'start'}</span>
      </button>`).join('')}
    </div>
    <div class="total" id="nTotal"></div>
    <div class="btn-row">
      <button class="btn secondary" id="nDiscard">Discard</button>
      <button class="btn" id="nSave">Save</button>
    </div>
    <button class="btn secondary" id="nManual">Enter manually instead</button>`;
  openSheet('Nursing', TYPES.nurse.color, body, root => {
    $$('.side', root).forEach(b => b.addEventListener('click', () => { tapSide(b.dataset.side); update(); }));
    $('#nSave', root).addEventListener('click', () => {
      if (saveNurseTimer()) { closeSheet(); toast('Nursing saved'); } else toast('Start a side first');
    });
    $('#nDiscard', root).addEventListener('click', () => {
      if (state.timers.nurse && !confirm('Discard this nursing session?')) return;
      delete state.timers.nurse; save(); closeSheet();
    });
    $('#nManual', root).addEventListener('click', () => openEditor('nurse'));
    function update() {
      const t = state.timers.nurse, now = Date.now();
      for (const s of ['L', 'R']) {
        const btn = $(`[data-side="${s}"]`, root);
        if (!btn) return;
        const running = t && t.side === s;
        btn.classList.toggle('on', !!running);
        $(`[data-t="${s}"]`, root).textContent = fmtClock(t ? nurseElapsed(t, s, now) : 0);
        if (t) $(`[data-h="${s}"]`, root).textContent = running ? 'tap to pause' : (nurseElapsed(t, s, now) ? 'paused' : 'start');
      }
      $('#nTotal', root).textContent = t
        ? `Total ${fmtClock(nurseElapsed(t, 'L', now) + nurseElapsed(t, 'R', now))} · started ${fmtTime(t.startedAt)}`
        : '';
    }
    sheetTick(update);
  });
}

function openSleep() {
  const t = state.timers.sleep;
  if (!t) {
    openSheet('Sleep', TYPES.sleep.color, `
      <button class="btn" id="sStart">Start sleep timer now</button>
      <button class="btn secondary" id="sPast">Log a past sleep</button>`, root => {
      $('#sStart', root).addEventListener('click', () => {
        state.timers.sleep = { startedAt: Date.now() }; save(); closeSheet(); toast('Sleep timer started');
      });
      $('#sPast', root).addEventListener('click', () => openEditor('sleep'));
    });
    return;
  }
  openSheet('Sleeping', TYPES.sleep.color, `
    <div class="total" style="font-size:40px;color:var(--text);font-weight:700" id="sEl"></div>
    <div class="field"><label>Fell asleep at</label><input type="datetime-local" id="sFrom" value="${toLocalInput(t.startedAt)}"></div>
    <button class="btn" id="sWake">Woke up — save</button>
    <button class="btn secondary" id="sCancel">Cancel timer</button>`, root => {
    $('#sFrom', root).addEventListener('change', e => { t.startedAt = fromLocalInput(e.target.value, t.startedAt); save(); });
    $('#sWake', root).addEventListener('click', () => {
      upsert({ id: uid(), type: 'sleep', start: t.startedAt, end: Date.now() });
      delete state.timers.sleep; save(); closeSheet(); toast('Sleep saved');
    });
    $('#sCancel', root).addEventListener('click', () => {
      if (!confirm('Cancel the running sleep timer?')) return;
      delete state.timers.sleep; save(); closeSheet();
    });
    sheetTick(() => { const el = $('#sEl', root); if (el) el.textContent = fmtClock(Date.now() - t.startedAt); });
  });
}

/* Generic add/edit form for every type */
function openEditor(type, ev) {
  const isNew = !ev;
  const now = Date.now();
  if (isNew) {
    ev = { id: uid(), type, start: now };
    if (type === 'bottle') {
      const lb = lastOf(e => e.type === 'bottle');
      ev.amount = lb?.amount ?? (state.settings.unit === 'oz' ? 3 * ML_PER_OZ : 90);
      ev.milk = lb?.milk ?? 'breast';
    }
    if (type === 'pump') { ev.left = 0; ev.right = 0; }
    if (type === 'diaper') ev.kind = 'wet';
    if (type === 'sleep') { ev.start = now - 3600e3; ev.end = now; }
    if (type === 'nurse') { ev.left = 0; ev.right = 0; ev.lastSide = 'R'; }
  }
  const T = TYPES[type];
  const stepper = (id, ml) => `<div class="stepper">
      <button type="button" data-step="-" data-for="${id}">−</button>
      <input type="number" inputmode="decimal" id="${id}" value="${toUnit(ml || 0)}" min="0" step="${unitStep()}">
      <button type="button" data-step="+" data-for="${id}">+</button><span class="unit">${state.settings.unit}</span></div>`;
  const minutes = (id, sec) => `<div class="stepper">
      <button type="button" data-step="-" data-for="${id}" data-inc="1">−</button>
      <input type="number" inputmode="numeric" id="${id}" value="${Math.round((sec || 0) / 60)}" min="0" step="1">
      <button type="button" data-step="+" data-for="${id}" data-inc="1">+</button><span class="unit">min</span></div>`;
  const seg = (id, opts, cur) => `<div class="seg" id="${id}">${opts.map(([v, l]) =>
    `<button type="button" data-v="${v}" class="${cur === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;

  let fields = '';
  switch (type) {
    case 'nurse':
      fields = `
        <div class="field"><label>Started</label><input type="datetime-local" id="fStart" value="${toLocalInput(ev.start)}"></div>
        <div class="field"><label>Left</label>${minutes('fL', ev.left)}</div>
        <div class="field"><label>Right</label>${minutes('fR', ev.right)}</div>
        <div class="field"><label>Ended on</label>${seg('fSide', [['L', 'Left'], ['R', 'Right']], ev.lastSide)}</div>`;
      break;
    case 'bottle':
      fields = `
        <div class="field"><label>Time</label><input type="datetime-local" id="fStart" value="${toLocalInput(ev.start)}"></div>
        <div class="field"><label>Milk</label>${seg('fMilk', [['breast', 'Breast milk'], ['formula', 'Formula']], ev.milk)}</div>
        <div class="field"><label>Amount</label>${stepper('fAmt', ev.amount)}</div>`;
      break;
    case 'pump':
      fields = `
        <div class="field"><label>Time</label><input type="datetime-local" id="fStart" value="${toLocalInput(ev.start)}"></div>
        <div class="field"><label>Left</label>${stepper('fL', ev.left)}</div>
        <div class="field"><label>Right</label>${stepper('fR', ev.right)}</div>`;
      break;
    case 'diaper':
      fields = `
        <div class="choice" id="fKind">${Object.entries(DIAPERS).map(([k, d]) =>
          `<button type="button" data-v="${k}" class="${ev.kind === k ? 'on' : ''}">${d.label}<small>${d.sub}</small></button>`).join('')}</div>
        <div class="field"><label>Time</label><input type="datetime-local" id="fStart" value="${toLocalInput(ev.start)}"></div>
        <div class="field"><label class="setting-row" style="color:var(--text);font-size:16px;margin:0">Diaper rash <input type="checkbox" id="fRash" ${ev.rash ? 'checked' : ''} style="width:24px;height:24px"></label></div>`;
      break;
    case 'sleep':
      fields = `
        <div class="field"><label>Fell asleep</label><input type="datetime-local" id="fStart" value="${toLocalInput(ev.start)}"></div>
        <div class="field"><label>Woke up</label><input type="datetime-local" id="fEnd" value="${toLocalInput(ev.end || now)}"></div>`;
      break;
    case 'note':
      fields = `<div class="field"><label>Time</label><input type="datetime-local" id="fStart" value="${toLocalInput(ev.start)}"></div>`;
      break;
  }
  const body = `${fields}
    <div class="field"><label>${type === 'note' ? 'Note (medicine, temperature, milestone…)' : 'Note (optional)'}</label><textarea id="fNote">${esc(ev.note)}</textarea></div>
    <button class="btn" id="fSave">${isNew ? 'Save' : 'Update'}</button>
    ${isNew ? '' : '<button class="btn danger" id="fDel">Delete</button>'}`;

  openSheet(`${isNew ? '' : 'Edit '}${T.title}`, T.color, body, root => {
    $$('.seg, .choice', root).forEach(g => $$('button', g).forEach(b => b.addEventListener('click', () => {
      $$('button', g).forEach(x => x.classList.toggle('on', x === b));
    })));
    $$('[data-step]', root).forEach(b => b.addEventListener('click', () => {
      const input = $('#' + b.dataset.for, root);
      const inc = +(b.dataset.inc || unitStep());
      const v = Math.max(0, (+input.value || 0) + (b.dataset.step === '+' ? inc : -inc));
      input.value = +v.toFixed(1);
    }));
    const val = id => $('#' + id, root);
    const segVal = id => $(`#${id} .on`, root)?.dataset.v;
    $('#fSave', root).addEventListener('click', () => {
      const out = { ...ev, start: fromLocalInput(val('fStart').value, ev.start), note: val('fNote').value.trim() || undefined };
      if (type === 'nurse') {
        out.left = Math.round((+val('fL').value || 0) * 60);
        out.right = Math.round((+val('fR').value || 0) * 60);
        out.lastSide = segVal('fSide');
        out.end = out.start + (out.left + out.right) * 1000;
      }
      if (type === 'bottle') { out.milk = segVal('fMilk'); out.amount = fromUnit(+val('fAmt').value || 0); }
      if (type === 'pump') { out.left = fromUnit(+val('fL').value || 0); out.right = fromUnit(+val('fR').value || 0); }
      if (type === 'diaper') { out.kind = segVal('fKind'); out.rash = val('fRash').checked || undefined; }
      if (type === 'sleep') {
        out.end = fromLocalInput(val('fEnd').value, ev.end);
        if (out.end < out.start) { toast('Wake time is before sleep time'); return; }
      }
      if (type === 'note' && !out.note) { toast('Write a note first'); return; }
      upsert(out);
      closeSheet();
      toast(`${T.title} ${isNew ? 'saved' : 'updated'}`);
    });
    if (!isNew) $('#fDel', root).addEventListener('click', () => { closeSheet(); remove(ev.id); });
  });
}

/* ---------- Import / export ---------- */
function download(name, text, mime) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const stamp = () => toLocalInput(Date.now()).replace(/[T:]/g, '-');

function exportJson() {
  download(`feeding-backup-${stamp()}.json`, JSON.stringify({ ...state, timers: {}, sync: undefined }, null, 1), 'application/json');
}
function exportCsv() {
  const rows = [['date', 'time', 'type', 'details', 'duration_min', 'amount_ml', 'note']];
  for (const e of [...state.events].reverse()) {
    const d = new Date(e.start);
    const dur = e.type === 'nurse' ? ((e.left || 0) + (e.right || 0)) / 60 : e.end ? (e.end - e.start) / 60000 : '';
    const amt = e.type === 'bottle' ? e.amount : e.type === 'pump' ? (e.left || 0) + (e.right || 0) : '';
    rows.push([d.toLocaleDateString(), d.toLocaleTimeString(), e.type, describe(e), dur === '' ? '' : Math.round(dur), amt === '' ? '' : Math.round(amt), e.note || '']);
  }
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  download(`feeding-${stamp()}.csv`, csv, 'text/csv');
}
function importJson(file) {
  file.text().then(txt => {
    const data = JSON.parse(txt);
    if (!Array.isArray(data.events)) throw new Error('No events in file');
    let added = 0, updated = 0;
    const byId = new Map(state.events.map(e => [e.id, e]));
    for (const e of data.events) {
      if (!e || !e.id || !TYPES[e.type] || typeof e.start !== 'number') continue;
      const cur = byId.get(e.id);
      if (!cur) { byId.set(e.id, e); added++; Sync.push(e); }
      else if ((e.updated || 0) > (cur.updated || 0)) { byId.set(e.id, e); updated++; Sync.push(e); }
    }
    state.events = [...byId.values()].sort((a, b) => b.start - a.start);
    if (!state.settings.babyName && data.settings) state.settings = { ...state.settings, ...data.settings };
    save(); render();
    toast(`Imported: ${added} new, ${updated} updated`);
  }).catch(err => toast('Import failed: ' + err.message));
}

/* ---------- Misc ---------- */
let toastTimer;
function toast(msg, action, fn) {
  const el = $('#toast');
  el.innerHTML = esc(msg) + (action ? ` <button>${esc(action)}</button>` : '');
  if (action) $('button', el).addEventListener('click', () => { fn(); el.classList.remove('show'); });
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), action ? 5000 : 2200);
}

function applyTheme() {
  const t = state.settings.theme;
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}

$$('.tabbar button').forEach(b => b.addEventListener('click', () => { tab = b.dataset.tab; render(); window.scrollTo(0, 0); }));

// Another tab/window changed the data
window.addEventListener('storage', e => { if (e.key === KEY) { state = load(); render(); } });
// Refresh "x min ago" etc. when the app comes back to the foreground
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if (!sheet.open) { state = load(); render(); }
  Sync.flush();
});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

render();
Sync.start();
