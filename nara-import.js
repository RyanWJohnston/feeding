'use strict';

/* ---------- Import from Nara Baby (CSV export) ----------
 * Nara: Activity screen → tap the avatar next to the baby's name → Export Data.
 * Nara's exact column layout isn't documented, so columns are matched by
 * name (type/activity, start, end, duration, left/right, amount, unit, side,
 * notes…) and the result is shown as a preview before anything is saved.
 * Each entry gets an id derived from its contents, so importing the same
 * file twice doesn't create duplicates.
 */

function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const delim = (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';'
    : text.split('\n')[0].includes('\t') && !text.split('\n')[0].includes(',') ? '\t' : ',';
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(f => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some(f => f.trim() !== '')) rows.push(row);
  return rows;
}

const norm = h => String(h).toLowerCase().replace(/[^a-z0-9]/g, '');

// Dates: ISO (with or without zone), M/D/Y or D/M/Y with optional time & AM/PM, or anything Date can parse.
function parseWhen(v) {
  if (v == null) return NaN;
  v = String(v).trim().replace(/\s+at\s+/i, ' ').replace(/,(?=\s*\d{1,2}:)/, '');
  if (!v) return NaN;
  if (/^\d{10,13}$/.test(v)) return +v * (v.length === 10 ? 1000 : 1);
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(am|pm)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i);
  if (m) {
    if (m[8]) return Date.parse(v.replace(' ', 'T'));
    let h = +(m[4] || 0); if (m[7]) h = (h % 12) + (/pm/i.test(m[7]) ? 12 : 0);
    return new Date(+m[1], +m[2] - 1, +m[3], h, +(m[5] || 0), +(m[6] || 0)).getTime();
  }
  m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?)?$/i);
  if (m) {
    let a = +m[1], b = +m[2], y = +m[3]; if (y < 100) y += 2000;
    const [mo, d] = a > 12 ? [b, a] : [a, b]; // assume month first unless impossible
    let h = +(m[4] || 0); if (m[7]) h = (h % 12) + (/p/i.test(m[7]) ? 12 : 0);
    return new Date(y, mo - 1, d, h, +(m[5] || 0), +(m[6] || 0)).getTime();
  }
  const t = Date.parse(v);
  return isNaN(t) ? NaN : t;
}
function parseClockOnly(v) { // "2:05 PM" / "14:05"
  const m = String(v || '').trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!m) return null;
  let h = +m[1]; if (m[4]) h = (h % 12) + (/pm/i.test(m[4]) ? 12 : 0);
  return (h * 3600 + +m[2] * 60 + +(m[3] || 0)) * 1000;
}

// Durations → seconds. "12:34" is m:ss (h:mm for sleep), "1:02:03" h:mm:ss, "1h 5m", "15 min", "90s", "15" (minutes unless header says sec).
function parseDur(v, { hint = '', longish = false } = {}) {
  if (v == null) return NaN;
  const s = String(v).trim().toLowerCase();
  if (!s) return NaN;
  let m = s.match(/^(\d+):(\d{1,2}):(\d{1,2})$/);
  if (m) return +m[1] * 3600 + +m[2] * 60 + +m[3];
  m = s.match(/^(\d+):(\d{1,2})$/);
  if (m) return longish ? +m[1] * 3600 + +m[2] * 60 : +m[1] * 60 + +m[2];
  if (/[hms]/.test(s) && /\d/.test(s)) {
    let total = 0, any = false;
    for (const [, n, u] of s.matchAll(/(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes|s|sec|secs|second|seconds)\b/g)) {
      any = true; total += +n * (u[0] === 'h' ? 3600 : u[0] === 'm' ? 60 : 1);
    }
    if (any) return total;
  }
  const n = parseFloat(s.replace(',', '.'));
  if (isNaN(n)) return NaN;
  if (/sec/.test(hint)) return n;
  if (/hour|hr/.test(hint)) return n * 3600;
  if (/ms|milli/.test(hint)) return n / 1000;
  return n * 60;
}

// Amounts → ml
function parseAmount(v, unitCell = '', hint = '') {
  if (v == null) return NaN;
  const s = String(v).trim().toLowerCase();
  const n = parseFloat(s.replace(',', '.'));
  if (isNaN(n)) return NaN;
  const unit = /oz|ounce/.test(s) ? 'oz' : /ml|millil/.test(s) ? 'ml'
    : /oz|ounce/.test(String(unitCell).toLowerCase()) ? 'oz' : /ml/.test(String(unitCell).toLowerCase()) ? 'ml'
    : /oz/.test(hint) ? 'oz' : /ml/.test(hint) ? 'ml' : state.settings.unit;
  return unit === 'oz' ? n * ML_PER_OZ : n;
}

function hashStr(s) { // FNV-1a, two rounds → 16 hex chars
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619);
    h2 = Math.imul(h2 ^ s.charCodeAt(i), 2246822519);
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

function detectColumns(header) {
  const H = header.map(norm);
  const used = new Set();
  const find = (...tests) => {
    for (const t of tests) {
      const i = H.findIndex((h, j) => !used.has(j) && (typeof t === 'string' ? h === t : t.test(h)));
      if (i >= 0) return i;
    }
    return -1;
  };
  const pick = (...tests) => { const i = find(...tests); if (i >= 0) used.add(i); return i; };
  const c = {};
  c.type = pick('type', 'activity', 'activitytype', 'eventtype', 'event', 'category', 'kind', 'entrytype', /type$/, /activity/);
  c.start = pick('start', 'starttime', 'startdatetime', 'startdate', 'startedat', 'datetime', 'timestamp', 'begin', /^start/);
  c.end = pick('end', 'endtime', 'enddatetime', 'enddate', 'endedat', 'finish', 'stop', /^end/);
  c.date = pick('date', 'day');
  c.time = pick('time', 'clock');
  c.leftDur = pick(/^left.*(dur|time|min|sec)/, /(dur|time).*left/, 'left', 'l');
  c.rightDur = pick(/^right.*(dur|time|min|sec)/, /(dur|time).*right/, 'right', 'r');
  c.leftAmt = pick(/^left.*(amount|volume|ml|oz|qty|quantity)/, /(amount|volume).*left/);
  c.rightAmt = pick(/^right.*(amount|volume|ml|oz|qty|quantity)/, /(amount|volume).*right/);
  c.dur = pick('duration', 'totalduration', 'length', /^duration/, /dur(ation)?(min|sec|s|m)?$/);
  c.amount = pick('amount', 'volume', 'quantity', 'qty', 'totalamount', /^amount/, /^volume/, 'ml', 'oz');
  c.unit = pick('unit', 'units', 'amountunit', 'volumeunit', /unit/);
  c.side = pick('side', 'lastside', 'endside', 'startside', 'breast', 'firstside', /side/);
  c.sub = pick('subtype', 'details', 'detail', 'diapertype', 'diaper', 'condition', 'status', 'contents', 'milktype', 'feedtype', 'bottletype', 'food', 'value', /type/);
  c.note = pick('note', 'notes', 'comment', 'comments', 'journal', 'description', 'memo', /note/);
  c.extra = header.map((_, i) => i).filter(i => !used.has(i));
  c.hints = H;
  return c;
}

function naraRowToEvents(row, c, header) {
  const get = i => (i >= 0 && i < row.length ? String(row[i]).trim() : '');
  const typeRaw = get(c.type);
  const type = typeRaw.toLowerCase();
  const sub = get(c.sub).toLowerCase();
  const all = row.join(' ').toLowerCase();

  let start = parseWhen(get(c.start));
  if (isNaN(start) && c.date >= 0) {
    start = parseWhen(get(c.date));
    const tod = parseClockOnly(get(c.time));
    if (!isNaN(start) && tod != null) start = new Date(new Date(start).setHours(0, 0, 0, 0)).getTime() + tod;
  }
  if (isNaN(start)) return { skip: 'no readable start time' };
  let end = parseWhen(get(c.end));
  if (isNaN(end) && c.end >= 0) { // end given as time of day only
    const tod = parseClockOnly(get(c.end));
    if (tod != null) { end = new Date(start).setHours(0, 0, 0, 0) + tod; if (end < start) end += 864e5; }
  }

  // Leftover columns (not mapped) go into the note so nothing is lost
  const extras = c.extra.map(i => [header[i], get(i)])
    .filter(([h, v]) => v && !/^(id|uuid|baby|babyname|child|childname|name|created|updated|timezone)/i.test(norm(h)));
  const noteParts = [get(c.note)];
  const isSleep = /sleep|nap/.test(type);
  const durHint = c.hints[c.dur] || '';
  let durSec = parseDur(get(c.dur), { hint: durHint, longish: isSleep });
  if (isNaN(durSec) && !isNaN(end) && end > start) durSec = (end - start) / 1000;

  const key = [typeRaw, start, get(c.end), get(c.dur), get(c.leftDur), get(c.rightDur), get(c.amount), get(c.sub), get(c.note)].join('|');
  const base = { start, updated: 1 }; // updated=1: anything edited in this app wins over a re-import
  const out = [];
  const idFor = suffix => 'nara-' + hashStr(key + suffix);
  const note = () => [...noteParts, ...extras.map(([h, v]) => `${h}: ${v}`)].filter(Boolean).join(' · ') || undefined;

  const sideOf = v => /^l|left/i.test(v) ? 'L' : /^r|right/i.test(v) ? 'R' : null;

  const nurse = () => {
    let left = parseDur(get(c.leftDur), { hint: c.hints[c.leftDur] || '' });
    let right = parseDur(get(c.rightDur), { hint: c.hints[c.rightDur] || '' });
    left = isNaN(left) ? 0 : left; right = isNaN(right) ? 0 : right;
    let side = sideOf(get(c.side));
    if (!left && !right && durSec > 0) {
      if (side === 'R') right = durSec; else left = durSec;
      if (!side) noteParts.push('side not recorded');
    }
    if (!side) side = right > left ? 'R' : left ? 'L' : undefined;
    const e = { ...base, id: idFor(':n'), type: 'nurse', left: Math.round(left), right: Math.round(right), lastSide: side };
    e.end = !isNaN(end) && end > start ? end : start + (e.left + e.right) * 1000;
    return e;
  };
  const bottle = () => {
    const amt = parseAmount(get(c.amount), get(c.unit), c.hints[c.amount] || '');
    const formula = /formula/.test(sub) || /formula/.test(all);
    return { ...base, id: idFor(':b'), type: 'bottle', amount: isNaN(amt) ? 0 : Math.round(amt), milk: formula ? 'formula' : 'breast' };
  };

  if (/combo/.test(type)) {
    out.push(nurse(), bottle());
  } else if (/bottle/.test(type) || (/feed/.test(type) && /bottle|formula/.test(sub))) {
    out.push(bottle());
  } else if (/pump/.test(type)) {
    let l = parseAmount(get(c.leftAmt), get(c.unit), c.hints[c.leftAmt] || '');
    let r = parseAmount(get(c.rightAmt), get(c.unit), c.hints[c.rightAmt] || '');
    if (isNaN(l) && isNaN(r)) { const t = parseAmount(get(c.amount), get(c.unit), c.hints[c.amount] || ''); l = isNaN(t) ? 0 : t; r = 0; }
    out.push({ ...base, id: idFor(':p'), type: 'pump', left: Math.round(l || 0), right: Math.round(r || 0) });
  } else if (/breast|nurs/.test(type) || (/feed/.test(type) && !/solid|food/.test(type))) {
    out.push(nurse());
  } else if (/diaper|nappy|potty/.test(type)) {
    // Also catches yes/no columns such as "Pee" / "Poo"
    const flagged = header.filter((h, i) => /^(true|yes|y|1|x|✓)$/i.test(get(i))).join(' ').toLowerCase();
    const t = [sub, flagged].join(' ').trim() || all;
    const wet = /wet|pee|urine/.test(t), dirty = /dirty|poo|bm|stool|soiled/.test(t);
    const kind = /mix|both/.test(t) || (wet && dirty) ? 'mixed' : dirty ? 'dirty' : wet ? 'wet' : /dry|clean/.test(t) ? 'dry' : 'wet';
    out.push({ ...base, id: idFor(':d'), type: 'diaper', kind, rash: /rash/.test(all) || undefined });
  } else if (isSleep) {
    const e = !isNaN(end) && end > start ? end : durSec > 0 ? start + durSec * 1000 : NaN;
    if (isNaN(e)) return { skip: 'sleep without an end time or duration' };
    out.push({ ...base, id: idFor(':s'), type: 'sleep', end: e });
  } else if (typeRaw || get(c.note) || extras.length) {
    // Solids, growth, medicine, milestones, journal… kept as notes
    noteParts.unshift([typeRaw, get(c.sub)].filter(Boolean).join(': '));
    if (get(c.amount)) noteParts.push(`${get(c.amount)}${get(c.unit) ? ' ' + get(c.unit) : ''}`);
    if (durSec > 0 && !/^\d+$/.test(get(c.dur))) noteParts.push(fmtDur(durSec * 1000));
    out.push({ ...base, id: idFor(':x'), type: 'note' });
  } else {
    return { skip: 'unknown row' };
  }
  const n = note();
  for (const e of out) if (n) e.note = n;
  return { events: out };
}

function parseNara(text) {
  const rows = parseCsv(text);
  // Header = first row that looks like one (some exports have a title line first)
  let hi = rows.findIndex(r => r.some(f => /type|activity|start|date|time/i.test(f)));
  if (hi < 0) throw new Error('Couldn’t find a header row in this file');
  const header = rows[hi];
  const cols = detectColumns(header);
  if (cols.start < 0 && cols.date < 0) throw new Error('Couldn’t find a date/start column');
  const events = [], skipped = [];
  for (const r of rows.slice(hi + 1)) {
    if (r.length === 1 && !r[0].trim()) continue;
    const res = naraRowToEvents(r, cols, header);
    if (res.skip) skipped.push({ row: r, why: res.skip });
    else events.push(...res.events);
  }
  // Same id twice in one file (true duplicates) → keep one
  const uniq = [...new Map(events.map(e => [e.id, e])).values()];
  return { header, cols, events: uniq, skipped };
}

function openNaraImport(file) {
  file.text().then(text => {
    let res;
    try { res = parseNara(text); } catch (e) { return toast('Import failed: ' + e.message); }
    const { header, cols, events, skipped } = res;
    const counts = {};
    for (const e of events) counts[e.type] = (counts[e.type] || 0) + 1;
    const existing = new Set(state.events.map(e => e.id));
    const fresh = events.filter(e => !existing.has(e.id)).length;
    const span = events.length
      ? `${new Date(Math.min(...events.map(e => e.start))).toLocaleDateString()} – ${new Date(Math.max(...events.map(e => e.start))).toLocaleDateString()}`
      : '';
    const mapped = Object.entries({ Type: cols.type, Start: cols.start, End: cols.end, Date: cols.date, Time: cols.time, Duration: cols.dur, Left: cols.leftDur, Right: cols.rightDur, Amount: cols.amount, Unit: cols.unit, Side: cols.side, Details: cols.sub, Notes: cols.note })
      .filter(([, i]) => i >= 0).map(([k, i]) => `${k} ← “${esc(header[i])}”`).join('<br>');
    const sample = [...events].sort((a, b) => b.start - a.start).slice(0, 5).map(rowHtml).join('');
    openSheet('Import from Nara', 'var(--nurse)', `
      ${events.length ? `
        <p style="margin-top:0"><b>${events.length}</b> entries found${span ? ` (${span})` : ''}${fresh < events.length ? `, <b>${fresh}</b> new` : ''}:</p>
        <p class="note">${Object.entries(counts).map(([t, n]) => `${n} ${TYPES[t].title.toLowerCase()}`).join(' · ')}</p>
        <h2 style="margin-top:14px">Most recent, as they’ll appear</h2>
        <div class="list" style="pointer-events:none">${sample}</div>` : '<p>No entries could be read from this file.</p>'}
      ${skipped.length ? `<p class="note">${skipped.length} row${skipped.length === 1 ? '' : 's'} skipped (e.g. ${esc(skipped[0].why)}: “${esc(skipped[0].row.join(', ').slice(0, 80))}”).</p>` : ''}
      <details style="margin:12px 0"><summary class="note">Column matching</summary><p class="note">${mapped}</p></details>
      ${events.length ? `<button class="btn" id="naraGo">Import ${fresh} entr${fresh === 1 ? 'y' : 'ies'}</button>` : ''}
      <button class="btn secondary" id="naraCancel">Cancel</button>`, root => {
      $('#naraCancel', root).addEventListener('click', closeSheet);
      const go = $('#naraGo', root);
      if (go) go.addEventListener('click', () => {
        const { added } = mergeEvents(events);
        closeSheet();
        toast(`Imported ${added} entries from Nara`);
      });
    });
  }).catch(err => toast('Import failed: ' + err.message));
}
