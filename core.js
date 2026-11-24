'use strict';
// 4·5차시 공통: 데이터(라벨·카드·규칙) + 저장소(Firebase Realtime Database 또는 연습 모드)
window.PA = (() => {
  const LABELS = [
    { key: 'jelly', name: '해파리', color: '#7a4fc2', soft: '#efe8fa' },
    { key: 'star',  name: '불가사리', color: '#c8561c', soft: '#fcece2' },
    { key: 'fish',  name: '물고기', color: '#1f6fb8', soft: '#e3eef9' },
    { key: 'trash', name: '쓰레기', color: '#4d6b49', soft: '#e7efe5' }
  ];
  const LABEL_BY_KEY = Object.fromEntries(LABELS.map(l => [l.key, l]));
  const FEATS = ['A', 'B', 'C', 'D'];

  // 학습 카드: 라운드마다 이 순서 (A·B·C·D)
  const CARDS = [
    { id: 'L1', answer: 'jelly', x: [3, 2, 1, 1] },
    { id: 'L2', answer: 'star',  x: [1, 3, 2, 1] },
    { id: 'L3', answer: 'fish',  x: [1, 1, 3, 2] },
    { id: 'L4', answer: 'trash', x: [2, 1, 1, 3] },
    { id: 'L5', answer: 'jelly', x: [3, 3, 1, 1] },
    { id: 'L6', answer: 'star',  x: [1, 3, 3, 1] },
    { id: 'L7', answer: 'fish',  x: [1, 1, 3, 3] },
    { id: 'L8', answer: 'trash', x: [3, 1, 1, 3] }
  ];

  const W = { init: 2, min: 0, max: 4, step: 1 };
  const GROUP_COUNT = 6;

  const initWeights = () => ({ A: W.init, B: W.init, C: W.init, D: W.init });
  const score = (w, x) => FEATS.reduce((s, f, i) => s + (Number(w && w[f]) || 0) * x[i], 0);

  function judge(card, weightsByLabel) {
    const scores = {};
    LABELS.forEach(l => { scores[l.key] = score(weightsByLabel[l.key], card.x); });
    const max = Math.max(...Object.values(scores));
    const winners = LABELS.filter(l => scores[l.key] === max).map(l => l.key);
    const tie = winners.length > 1;
    return { scores, max, winners, tie, correct: !tie && winners[0] === card.answer };
  }

  // 이번 카드에서 고를 수 있는 가중치 범위: 카드 시작 값 ±1, 0~4
  const allowedRange = base => [Math.max(W.min, base - W.step), Math.min(W.max, base + W.step)];

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const clone = v => (v == null ? v : JSON.parse(JSON.stringify(v)));

  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = () => rej(new Error('스크립트를 불러오지 못했어요: ' + src));
      document.head.appendChild(s);
    });
  }

  // ---------- 저장소: Firebase ----------
  async function firebaseBackend(cfg) {
    const v = '10.12.2';
    await loadScript(`https://www.gstatic.com/firebasejs/${v}/firebase-app-compat.js`);
    await loadScript(`https://www.gstatic.com/firebasejs/${v}/firebase-database-compat.js`);
    if (!firebase.apps.length) firebase.initializeApp(cfg);
    const db = firebase.database();
    return {
      mode: 'firebase',
      sub(path, cb, onErr) {
        const r = db.ref(path);
        const h = s => cb(s.val());
        r.on('value', h, e => onErr && onErr(e));
        return () => r.off('value', h);
      },
      get: async p => (await db.ref(p).get()).val(),
      set: (p, val) => db.ref(p).set(val),
      update: (p, obj) => db.ref(p).update(obj),
      remove: p => db.ref(p).remove(),
      async txn(p, fn) {
        const res = await db.ref(p).transaction(cur => fn(cur), undefined, false);
        return { committed: res.committed, value: res.snapshot.val() };
      },
      onConnection(cb) {
        db.ref('.info/connected').on('value', s => cb(!!s.val()));
      }
    };
  }

  // ---------- 저장소: 연습 모드(같은 컴퓨터의 창끼리) ----------
  function localBackend() {
    const KEY = 'pa45_localdb';
    const ch = 'BroadcastChannel' in window ? new BroadcastChannel('pa45') : null;
    const subs = new Set();
    const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } };
    const parts = p => p.split('/').filter(Boolean);
    const getAt = (root, p) => parts(p).reduce((o, k) => (o == null ? undefined : o[k]), root);
    function prune(o) {
      if (o && typeof o === 'object') {
        for (const k of Object.keys(o)) {
          o[k] = prune(o[k]);
          if (o[k] == null) delete o[k];
        }
        if (!Array.isArray(o) && Object.keys(o).length === 0) return null;
      }
      return o;
    }
    function setAt(root, p, val) {
      const ks = parts(p);
      if (!ks.length) return prune(clone(val)) || {};
      let o = root;
      for (let i = 0; i < ks.length - 1; i++) {
        if (o[ks[i]] == null || typeof o[ks[i]] !== 'object') o[ks[i]] = {};
        o = o[ks[i]];
      }
      const last = ks[ks.length - 1];
      if (val == null) delete o[last]; else o[last] = clone(val);
      return prune(root) || {};
    }
    function notify() {
      const root = read();
      subs.forEach(s => {
        const v = getAt(root, s.path);
        const j = JSON.stringify(v === undefined ? null : v);
        if (j !== s.last) { s.last = j; s.cb(v === undefined ? null : clone(v)); }
      });
    }
    function write(root) {
      localStorage.setItem(KEY, JSON.stringify(root));
      if (ch) ch.postMessage(1);
      setTimeout(notify, 0);
    }
    if (ch) ch.onmessage = notify;
    window.addEventListener('storage', e => { if (e.key === KEY) notify(); });
    return {
      mode: 'local',
      sub(path, cb) {
        const s = { path, cb, last: undefined };
        subs.add(s);
        setTimeout(notify, 0);
        return () => subs.delete(s);
      },
      get: async p => { const v = getAt(read(), p); return v === undefined ? null : clone(v); },
      set: async (p, val) => write(setAt(read(), p, val)),
      update: async (p, obj) => {
        let root = read();
        for (const k of Object.keys(obj)) root = setAt(root, p + '/' + k, obj[k]);
        write(root);
      },
      remove: async p => write(setAt(read(), p, null)),
      async txn(p, fn) {
        const root = read();
        const cur = getAt(root, p);
        const next = fn(cur === undefined ? null : clone(cur));
        if (next === undefined) return { committed: false, value: cur === undefined ? null : cur };
        write(setAt(root, p, next));
        return { committed: true, value: next };
      },
      onConnection(cb) { cb(true); }
    };
  }

  async function connect() {
    const cfg = window.FIREBASE_CONFIG || {};
    let db;
    if (cfg.apiKey && cfg.databaseURL) db = await firebaseBackend(cfg);
    else db = localBackend();
    if (db.mode === 'local') {
      const b = document.createElement('div');
      b.className = 'mode-banner';
      b.textContent = '연습 모드: 이 컴퓨터의 브라우저 창끼리만 연결돼요. 수업에서 쓰려면 firebase-config.js를 채워 주세요.';
      document.body.prepend(b);
    }
    return db;
  }

  function toast(msg) {
    let t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.remove('show'), 2600);
  }

  return { LABELS, LABEL_BY_KEY, FEATS, CARDS, W, GROUP_COUNT, initWeights, score, judge, allowedRange, esc, uid, clone, connect, toast };
})();
