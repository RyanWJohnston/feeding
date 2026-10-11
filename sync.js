'use strict';

/* ---------- Live sync (optional) ----------
 * The phone's own storage stays the source of truth for the UI. When a
 * family code is set, every local change is queued in state.sync.pending and
 * mirrored to Firestore at families/{code}/events/{id}; changes from other
 * phones are applied locally. Conflicts: newest `updated` wins. Deletes are
 * written as tombstones ({deleted: true}) so other phones learn about them.
 * Only documents with serverAt newer than the last one seen are fetched.
 */
const FIREBASE_URL = 'https://www.gstatic.com/firebasejs/10.14.1/';

const Sync = (() => {
  const cfg = window.FEEDING_FIREBASE_CONFIG;
  let fs = null, db = null, connecting = null, unsubs = [];
  const inFlight = new Set();
  let status = 'off', lastError = '';

  const S = () => state.sync;
  const configured = () => !!(cfg && cfg.apiKey && cfg.projectId);
  const pendingCount = () => Object.keys(S().pending).length + (S().pendingBaby ? 1 : 0);

  function setStatus(s, err) {
    status = s;
    if (err !== undefined) lastError = err;
    const dot = document.getElementById('syncDot');
    if (dot) { dot.dataset.s = S().family ? s : 'off'; dot.title = describeStatus(); }
    const el = document.getElementById('syncStatus');
    if (el) el.textContent = describeStatus();
  }
  function refreshStatus() {
    if (!S().family) return setStatus('off');
    if (!db || !navigator.onLine) return setStatus('offline');
    if (status === 'error') return setStatus('error');
    setStatus(pendingCount() ? 'pending' : 'synced');
  }
  function describeStatus() {
    const n = pendingCount();
    switch (status) {
      case 'synced': return 'Synced ✓';
      case 'pending': return `Uploading ${n} change${n === 1 ? '' : 's'}…`;
      case 'connecting': return 'Connecting…';
      case 'offline': return n ? `Offline: ${n} change${n === 1 ? '' : 's'} will upload when back online` : 'Offline: will sync when back online';
      case 'error': return 'Sync error: ' + lastError;
      default: return 'Not syncing';
    }
  }

  async function ensureDb() {
    if (db) return;
    if (!connecting) {
      connecting = (async () => {
        const [appMod, authMod, fsMod] = await Promise.all(
          ['firebase-app.js', 'firebase-auth.js', 'firebase-firestore.js'].map(f => import(FIREBASE_URL + f)));
        const app = appMod.initializeApp(cfg);
        await authMod.signInAnonymously(authMod.getAuth(app));
        fs = fsMod;
        db = fs.initializeFirestore(app, { ignoreUndefinedProperties: true });
      })().finally(() => { connecting = null; });
    }
    return connecting;
  }

  async function start() {
    if (!configured() || !S().family) return refreshStatus();
    if (unsubs.length) return flush();
    setStatus('connecting');
    try {
      await ensureDb();
    } catch (e) {
      console.warn('sync: connect failed', e);
      return setStatus('offline'); // retried on the 'online' event / next foreground
    }
    if (!S().family || unsubs.length) return;
    listen();
    flush();
  }

  function stop() {
    unsubs.forEach(u => u());
    unsubs = [];
  }

  function listen() {
    const fam = S().family;
    const onErr = e => { console.warn('sync: listen failed', e); stop(); setStatus('error', e.code || e.message); };
    const since = Math.max(0, (S().lastServerAt || 0) - 60000); // small overlap is harmless
    const q = fs.query(fs.collection(db, 'families', fam, 'events'),
      fs.where('serverAt', '>', fs.Timestamp.fromMillis(since)));
    unsubs.push(fs.onSnapshot(q, snap => {
      if (S().family !== fam) return;
      let changed = false, maxAt = S().lastServerAt || 0;
      for (const ch of snap.docChanges()) {
        if (ch.type === 'removed' || ch.doc.metadata.hasPendingWrites) continue;
        const d = { ...ch.doc.data(), id: ch.doc.id };
        const at = d.serverAt && d.serverAt.toMillis ? d.serverAt.toMillis() : 0;
        if (at > maxAt) maxAt = at;
        delete d.serverAt;
        if (applyRemote(d)) changed = true;
      }
      if (!snap.metadata.fromCache) S().lastServerAt = maxAt;
      save();
      if (status === 'error') status = 'synced';
      refreshStatus();
      if (changed) rerender();
    }, onErr));

    unsubs.push(fs.onSnapshot(fs.doc(db, 'families', fam), snap => {
      if (snap.metadata.fromCache || S().family !== fam || S().pendingBaby) return;
      const baby = snap.exists() && snap.data().baby;
      if (!baby) {
        // First phone in the family: share our baby details
        if (state.settings.babyName || state.settings.birthDate) {
          state.settings.babyUpdated = Date.now();
          Sync.pushBaby();
        }
        return;
      }
      if ((baby.updated || 0) > (state.settings.babyUpdated || 0)) {
        state.settings.babyName = baby.name || '';
        state.settings.birthDate = baby.birthDate || '';
        state.settings.babyUpdated = baby.updated;
        save();
        rerender();
      }
    }, onErr));
  }

  // Returns true if local data changed.
  function applyRemote(d) {
    const mine = S().pending[d.id];
    if (mine && (mine.updated || 0) >= (d.updated || 0)) return false; // our newer edit wins
    const i = state.events.findIndex(e => e.id === d.id);
    if (i >= 0 && (state.events[i].updated || 0) >= (d.updated || 0)) return false;
    if (d.deleted) {
      if (i < 0) return false;
      state.events.splice(i, 1);
      return true;
    }
    if (!TYPES[d.type] || typeof d.start !== 'number') return false;
    if (i >= 0) state.events[i] = d; else state.events.push(d);
    state.events.sort((a, b) => b.start - a.start);
    return true;
  }

  function flush() {
    if (!db || !S().family) return refreshStatus();
    const fam = S().family;
    for (const [id, item] of Object.entries(S().pending)) {
      const key = id + ':' + item.updated;
      if (inFlight.has(key)) continue;
      inFlight.add(key);
      // setDoc resolves once the server has the write (it waits while offline)
      fs.setDoc(fs.doc(db, 'families', fam, 'events', id), { ...item, serverAt: fs.serverTimestamp() })
        .then(() => {
          const cur = S().pending[id];
          if (S().family === fam && cur && cur.updated === item.updated) { delete S().pending[id]; save(); }
        })
        .catch(e => { console.warn('sync: write failed', e); setStatus('error', e.code || e.message); })
        .finally(() => { inFlight.delete(key); refreshStatus(); });
    }
    if (S().pendingBaby && !inFlight.has('baby')) {
      inFlight.add('baby');
      const s = state.settings;
      fs.setDoc(fs.doc(db, 'families', fam),
        { baby: { name: s.babyName || '', birthDate: s.birthDate || '', updated: s.babyUpdated || Date.now() } }, { merge: true })
        .then(() => { if (S().family === fam) { S().pendingBaby = false; save(); } })
        .catch(e => { console.warn('sync: write failed', e); setStatus('error', e.code || e.message); })
        .finally(() => { inFlight.delete('baby'); refreshStatus(); });
    }
    refreshStatus();
  }

  // Avoid wiping out something the user is typing.
  function rerender() {
    const a = document.activeElement;
    if (a && a.matches('input, textarea')) return;
    render();
  }

  function queue(item) {
    if (!S().family) return;
    S().pending[item.id] = item;
    save();
    flush();
  }

  return {
    configured,
    get family() { return S().family; },
    statusText: describeStatus,
    start,
    flush: () => (unsubs.length ? flush() : start()),
    push(ev) { queue({ ...ev, updated: ev.updated || Date.now() }); },
    pushDelete(id) { queue({ id, deleted: true, updated: Date.now() }); },
    pushBaby() { if (S().family) { S().pendingBaby = true; save(); flush(); } },

    // Joining (or creating) uploads everything already on this phone, so
    // both parents' existing logs are merged.
    join(code) {
      code = String(code || '').replace(/\s+/g, '');
      if (!/^[A-Za-z0-9]{20,64}$/.test(code)) throw new Error('That code doesn’t look right');
      stop();
      state.sync = { family: code, lastServerAt: 0, pending: {}, pendingBaby: false };
      for (const ev of state.events) state.sync.pending[ev.id] = { ...ev, updated: ev.updated || ev.start };
      state.settings.babyUpdated = 0; // the family's baby details win; ours are shared only if it has none
      save();
      start();
    },
    create() {
      const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
      const bytes = crypto.getRandomValues(new Uint8Array(24));
      const code = [...bytes].map(b => abc[b % abc.length]).join('');
      this.join(code);
      return code;
    },
    leave() {
      stop();
      state.sync = { family: null, lastServerAt: 0, pending: {}, pendingBaby: false };
      save();
      refreshStatus();
    },
  };
})();

window.addEventListener('online', () => Sync.flush());
window.addEventListener('offline', () => Sync.flush());
