'use strict';
(async function () {
  const { LABELS, LABEL_BY_KEY, FEATS, CARDS, GROUP_COUNT, esc, judge, allowedRange, toast } = PA;
  const app = document.getElementById('app');
  const SKEY = 'pa45_me';
  let db, room = null, unsub = null;
  let me = null;
  try { me = JSON.parse(sessionStorage.getItem(SKEY) || 'null'); } catch (e) { me = null; }
  let joinError = '';

  try { db = await PA.connect(); }
  catch (e) { app.innerHTML = `<div class="wrap narrow"><div class="err">인터넷 연결을 확인해 주세요. (${esc(e.message)})</div></div>`; return; }
  db.onConnection(ok => { document.getElementById('conn').innerHTML = ok ? '' : '<div class="conn-off">연결이 끊겼어요. 잠시 기다리면 다시 이어져요.</div>'; });


  // ---------- 공통 ----------
  const base = () => `rooms/${me.code}`;
  const lab = k => LABEL_BY_KEY[k];
  const cvars = k => `--c:${lab(k).color};--s:${lab(k).soft}`;
  const chip = k => `<span class="chip" style="${cvars(k)}">${esc(lab(k).name)}</span>`;

  function subscribe() {
    if (unsub) unsub();
    room = undefined;
    app.innerHTML = '<div class="loading">수업에 들어가는 중이에요…</div>';
    unsub = db.sub(base(), v => { room = v; render(); }, () => leave('연결에 문제가 생겼어요. 다시 들어와 주세요.'));
  }
  function leave(msg) {
    if (unsub) unsub(); unsub = null;
    sessionStorage.removeItem(SKEY);
    me = null; room = null; joinError = msg || '';
    renderJoin();
  }
  function topbar(where) {
    const p = room && room.players && room.players[me.pid];
    const g = p && p.group ? `${p.group}모둠 · ` : '';
    return `<div class="topbar"><span class="who">${g}${esc(me.name)}</span><span class="where">${where || ''}</span></div>`;
  }
  function membersOf(g) {
    const ps = (room && room.players) || {};
    return Object.entries(ps).filter(([, p]) => p.group === g).sort((a, b) => (a[1].at || 0) - (b[1].at || 0));
  }
  const nameOf = pid => { const p = room && room.players && room.players[pid]; return p ? p.name : '(나간 친구)'; };

  // ---------- 1. 들어오기 ----------
  function renderJoin() {
    app.innerHTML = `
      <div class="topbar"><span class="who">바닷속 신경망 학습</span><span class="where">4·5차시</span></div>
      <div class="wrap narrow">
        <h1>수업에 들어가요</h1>
        <p class="lead">칠판에 있는 입장 코드와 내 이름을 써 주세요.</p>
        <form class="panel" id="joinForm" autocomplete="off">
          ${joinError ? `<div class="err" role="alert">${esc(joinError)}</div>` : ''}
          <label class="field"><span>입장 코드 (숫자 네 자리)</span><input id="code" inputmode="numeric" maxlength="4" required></label>
          <label class="field"><span>내 이름</span><input id="name" maxlength="10" required></label>
          <button class="btn btn-main btn-wide" type="submit">들어가기</button>
        </form>
        <p class="muted" style="margin-top:24px">선생님은 <a href="teacher.html">선생님 화면</a>을 열어요.</p>
      </div>`;
    document.getElementById('joinForm').onsubmit = onJoin;
    document.getElementById('code').focus();
  }

  async function onJoin(e) {
    e.preventDefault();
    const code = document.getElementById('code').value.trim();
    const name = document.getElementById('name').value.trim().replace(/\s+/g, ' ');
    const fail = m => { joinError = m; renderJoin(); document.getElementById('code').value = code; document.getElementById('name').value = name; };
    if (!/^\d{4}$/.test(code)) return fail('입장 코드는 숫자 네 자리예요. 다시 써 주세요.');
    if (!name) return fail('이름을 써 주세요.');
    const btn = e.target.querySelector('button'); btn.disabled = true; btn.textContent = '들어가는 중…';
    try {
      const meta = await db.get(`rooms/${code}/meta`);
      if (!meta) return fail('이 코드로 열린 수업이 없어요. 칠판의 코드를 다시 확인해 주세요.');
      const players = (await db.get(`rooms/${code}/players`)) || {};
      const same = Object.entries(players).find(([, p]) => p.name === name);
      let pid;
      if (same) {
        if (!confirm(`'${name}' 이름이 이미 들어와 있어요.\n그 사람이 나라면 [확인]을 눌러 이어서 해요.\n내가 아니라면 [취소]를 누르고 이름 뒤에 번호를 붙여 주세요.`)) { btn.disabled = false; btn.textContent = '들어가기'; return; }
        pid = same[0];
      } else {
        pid = PA.uid();
        await db.set(`rooms/${code}/players/${pid}`, { name, at: Date.now() });
      }
      me = { code, pid, name };
      sessionStorage.setItem(SKEY, JSON.stringify(me));
      joinError = '';
      subscribe();
    } catch (err) { fail('들어가지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.'); }
  }

  // ---------- 화면 고르기 ----------
  function render() {
    if (room === undefined) return;
    if (!room || !room.meta) return leave('수업이 끝났거나 닫혔어요. 입장 코드를 다시 확인해 주세요.');
    const p = (room.players || {})[me.pid];
    if (!p) return leave('선생님이 자리를 정리했어요. 다시 들어와 주세요.');
    const phase = room.meta.phase;
    if (!p.group || phase === 'join') return renderPickGroup(phase, p.group);
    if (phase === 'select') return renderLobby(p.group);
    return renderActivity(p.group);
  }

  // ---------- 2. 모둠 고르기 ----------
  function renderPickGroup(phase, myGroup) {
    const groups = room.groups || {};
    let html = topbar('모둠 고르기') + `<div class="wrap"><h1>우리 모둠을 골라요</h1>
      <p class="lead">내 모둠 번호를 눌러요. 잘못 눌렀으면 다른 번호를 다시 누르면 돼요.</p><div class="group-grid">`;
    for (let g = 1; g <= GROUP_COUNT; g++) {
      const mem = membersOf(g);
      const lobby = (groups[g] && groups[g].lobby) || {};
      const closed = phase !== 'join' && lobby.confirmed && phase === 'select';
      html += `<button class="group-btn ${myGroup === g ? 'mine' : ''}" data-act="group" data-g="${g}" ${closed ? 'disabled' : ''} aria-pressed="${myGroup === g}">
        <span class="gname">${g}모둠</span>
        ${myGroup === g ? '<span class="tag">✓ 내 모둠</span>' : ''}
        <span class="gmem">${mem.length ? mem.map(([, m]) => esc(m.name)).join(', ') : '아직 아무도 없어요'}</span>
        ${closed ? '<span class="gmem">역할을 다 정한 모둠이에요</span>' : ''}
      </button>`;
    }
    html += `</div>`;
    if (myGroup && phase === 'join') html += `<div class="notice"><b>${myGroup}모둠을 골랐어요.</b> 선생님이 [시작]을 누르면 모둠 친구들과 모여요. 잠깐 기다려 주세요.</div>`;
    if (phase === 'activity') html += `<div class="notice">활동이 이미 시작됐어요. 모둠을 고르면 모둠 친구들의 화면을 함께 볼 수 있어요.</div>`;
    html += `</div>`;
    app.innerHTML = html;
  }

  async function pickGroup(g) {
    const p = room.players[me.pid];
    if (p.group === g) return;
    if (p.group) await releaseClaim(p.group);
    await db.update(`${base()}/players/${me.pid}`, { group: g });
  }
  async function releaseClaim(g) {
    await db.txn(`${base()}/groups/${g}/lobby`, lb => {
      if (!lb) return lb;
      if (lb.confirmed && room.meta.phase === 'select') return;
      const cl = lb.claims || {};
      for (const k of Object.keys(cl)) if (cl[k] === me.pid) delete cl[k];
      lb.claims = cl; return lb;
    });
  }

  // ---------- 3. 역할(라벨) 고르기 ----------
  function renderLobby(g) {
    const lobby = (room.groups && room.groups[g] && room.groups[g].lobby) || {};
    const claims = lobby.claims || {};
    const mem = membersOf(g);
    const filled = LABELS.filter(l => claims[l.key]).length;
    const myLabel = LABELS.find(l => claims[l.key] === me.pid);
    let html = topbar('역할 고르기') + `<div class="wrap">
      <h1>${g}모둠이 모였어요</h1>
      <ul class="members" aria-label="모둠 친구">${mem.map(([id, m]) => {
        const lk = LABELS.find(l => claims[l.key] === id);
        return `<li>${esc(m.name)}${id === me.pid ? ' (나)' : ''}${lk ? ' · ' + chip(lk.key) : ''}</li>`;
      }).join('')}</ul>
      <p class="lead">내가 맡을 것을 하나 골라요. 친구가 먼저 고른 것은 고를 수 없어요.</p>
      <div class="label-grid">`;
    for (const l of LABELS) {
      const who = claims[l.key];
      const mine = who === me.pid;
      const taken = who && !mine;
      const state = mine ? '✓ 내가 맡았어요 (다시 누르면 취소)' : taken ? `${esc(nameOf(who))}(이)가 골랐어요` : '아직 아무도 안 골랐어요';
      html += `<button class="label-btn ${mine ? 'mine' : ''} ${taken ? 'taken' : ''}" style="${cvars(l.key)}" data-act="claim" data-l="${l.key}" ${taken || lobby.confirmed ? 'disabled' : ''} aria-pressed="${mine}">
        <span class="lname">${l.name}</span><span class="lstate">${state}</span></button>`;
    }
    html += `</div><div class="bottom-bar">`;
    if (lobby.confirmed) {
      html += `<span class="decided-msg">✓ 결정했어요! 다른 모둠이 정할 때까지 기다려요.</span>
        <button class="btn btn-line btn-small" data-act="unconfirmLobby">결정 취소</button>`;
    } else {
      html += `<button class="btn btn-main" data-act="confirmLobby" ${filled === 4 ? '' : 'disabled'}>결정</button>
        <span class="hint">${filled === 4 ? '모두 골랐어요. [결정]을 눌러요.' : `네 가지를 모두 고르면 누를 수 있어요 (${filled}/4)`}</span>`;
      if (!myLabel) html += `<button class="linkish" data-act="regroup">모둠을 잘못 골랐어요</button>`;
    }
    if (mem.length > 4 && !myLabel && filled === 4) html += `<p class="hint" style="width:100%">역할은 네 개예요. 나는 모둠 친구들의 화면을 함께 보며 도와요.</p>`;
    html += `</div></div>`;
    app.innerHTML = html;
  }

  async function claim(g, label) {
    const res = await db.txn(`${base()}/groups/${g}/lobby`, lb => {
      lb = lb || {};
      if (lb.confirmed) return;
      const cl = lb.claims || {};
      if (cl[label] && cl[label] !== me.pid) return;
      const had = cl[label] === me.pid;
      for (const k of Object.keys(cl)) if (cl[k] === me.pid) delete cl[k];
      if (!had) cl[label] = me.pid;
      lb.claims = cl; return lb;
    });
    if (!res.committed) toast('친구가 먼저 골랐어요. 다른 것을 골라요.');
  }
  async function setLobbyConfirmed(g, val) {
    const res = await db.txn(`${base()}/groups/${g}/lobby`, lb => {
      if (!lb) return lb;
      const cl = lb.claims || {};
      if (val && !LABELS.every(l => cl[l.key])) return;
      lb.confirmed = val; return lb;
    });
    if (!res.committed && val) toast('아직 다 고르지 않았어요.');
  }

  // ---------- 4. 학습 활동 ----------
  function renderActivity(g) {
    const grp = (room.groups || {})[g] || {};
    const st = grp.state;
    if (!st || !st.play) {
      app.innerHTML = topbar('학습 활동') + `<div class="wrap narrow"><div class="notice">이 모둠은 활동을 시작하지 않았어요. 선생님께 말해 주세요.</div>
        <div class="bottom-bar"><button class="linkish" data-act="regroupAct">다른 모둠 고르기</button></div></div>`;
      return;
    }
    if (st.play.stage === 'roundEnd') return renderRoundEnd(g, st, grp.history || {});
    const claims = (grp.lobby && grp.lobby.claims) || {};
    const myKey = (LABELS.find(l => claims[l.key] === me.pid) || {}).key;
    const card = CARDS[st.play.card];
    const drafts = st.drafts || {};
    const decidedCount = LABELS.filter(l => drafts[l.key] && drafts[l.key].decided).length;
    const all = decidedCount === 4;
    const where = `<b>${st.play.round}라운드</b> · 카드 ${st.play.card + 1}/8`;

    let html = topbar(where) + `<div class="wrap">${prevHtml(grp.history || {}, st.play, myKey)}<div class="act">${cardHtml(card, st.play.card)}`;
    if (myKey) html += nodeHtml(myKey, st, card);
    else html += observerHtml(claims, drafts);
    html += `</div>`;

    // 결정 띠
    html += `<div class="decide-bar"><div class="team-status" aria-label="모둠 결정 상황">${LABELS.map(l => {
      const d = drafts[l.key] && drafts[l.key].decided;
      return `<span class="ts ${d ? 'yes' : ''}" style="${cvars(l.key)}"><span class="mark">${d ? '✓' : ''}</span><span class="nm">${l.name}</span>${d ? '결정' : '고치는 중'}</span>`;
    }).join('')}</div>`;
    if (myKey) {
      const mine = drafts[myKey] || {};
      html += mine.decided
        ? `<div style="display:flex;align-items:center;gap:12px"><span class="decided-msg">✓ 결정했어요</span><button class="btn btn-line" data-act="decide" data-v="0">결정 취소</button></div>`
        : `<button class="btn btn-main" data-act="decide" data-v="1">결정</button>`;
    }
    html += `</div>`;

    if (all) html += revealHtml(card, drafts, myKey, st.play.card);
    else html += `<p class="muted" style="margin-top:12px">네 명이 모두 [결정]을 누르면 점수가 나와요. (${decidedCount}/4)</p>`;
    html += `</div>`;
    app.innerHTML = html;
  }

  // 바로 앞 카드의 결과 (L1이면 앞 라운드의 L8)
  function prevHtml(history, play, myKey) {
    const key = play.card > 0 ? `r${play.round}c${play.card}` : `r${play.round - 1}c${CARDS.length}`;
    const r = history[key];
    if (!r) return '';
    const w = r.winners || [];
    const verdict = r.correct
      ? `<span class="pv-v ok">○ 맞힘</span>`
      : `<span class="pv-v no">× 틀림</span>`;
    const judged = w.length > 1 ? `${w.map(k => lab(k).name).join('·')} 동점` : `판정 ${lab(w[0]).name}`;
    const scores = LABELS.map(l => `<span class="pv-s ${w.includes(l.key) ? 'win' : ''}" style="${cvars(l.key)}"><b>${l.name}</b> ${r.scores[l.key]}점${l.key === myKey ? ' (나)' : ''}</span>`).join('');
    const roundNote = play.card === 0 ? `${r.round}라운드 ` : '';
    return `<section class="prev" aria-label="바로 앞 카드 결과">
      <span class="pv-t">바로 앞 ${roundNote}<b>${r.card}</b> 결과</span>${verdict}
      <span class="pv-j">${judged} · 정답 ${lab(r.answer).name}</span>
      <span class="pv-sc">${scores}</span></section>`;
  }

  function cardHtml(card, idx) {
    return `<section class="lcard" aria-label="학습 카드 ${card.id}">
      <div class="lcard-top"><span class="id">${card.id}</span><span class="kind">학습 카드</span></div>
      <div class="lcard-feats">${FEATS.map((f, i) => `<div><span class="f">${f}</span><span class="v">${card.x[i]}</span></div>`).join('')}</div>
      <div class="lcard-ans">정답 ${chip(card.answer)}</div>
      <div class="progress-dots" aria-hidden="true">${CARDS.map((c, i) => `<i class="${i < idx ? 'done' : i === idx ? 'now' : ''}"></i>`).join('')}</div>
    </section>`;
  }

  function nodeHtml(key, st, card) {
    const l = lab(key);
    const baseW = (st.weights && st.weights[key]) || PA.initWeights();
    const d = (st.drafts && st.drafts[key]) || { w: baseW };
    const locked = !!d.decided;
    let rows = '';
    FEATS.forEach((f, i) => {
      const b = Number(baseW[f]); const cur = Number(d.w[f]);
      const [lo, hi] = allowedRange(b);
      let cells = '';
      for (let v = 0; v <= 4; v++) {
        const on = v >= lo && v <= hi;
        cells += `<button class="cell ${on ? 'on' : 'off'} ${v === cur ? 'cur' : ''}" ${!on || locked ? 'disabled' : ''}
          data-act="w" data-l="${key}" data-f="${f}" data-v="${v}" aria-label="${f} 가중치 ${v}${v === cur ? ' (지금)' : ''}">${v}${v === b ? '<span class="base">처음</span>' : ''}</button>`;
      }
      const delta = cur > b ? `<span class="delta up">▲ 올림 (${b}→${cur})</span>` : cur < b ? `<span class="delta down">▼ 내림 (${b}→${cur})</span>` : `<span class="delta">그대로</span>`;
      rows += `<div class="wrow"><span class="f">${f}</span><span class="x">카드 <b>${card.x[i]}</b></span><span class="times">×</span>
        <div class="strip" role="group" aria-label="${f} 가중치">${cells}</div>${delta}</div>`;
    });
    return `<section class="node ${locked ? 'locked' : ''}" style="${cvars(key)}">
      <div class="node-head"><h2>나는 <b>${l.name}</b> 노드</h2><span class="rule">가중치는 한 칸(±1)씩, 0~4</span></div>
      <div class="wrows">${rows}</div></section>`;
  }

  function observerHtml(claims, drafts) {
    const empty = LABELS.filter(l => !claims[l.key]);
    return `<section class="panel"><h2>모둠 친구들을 도와요</h2>
      <p class="lead">나는 맡은 노드가 없어요. 친구들 화면을 함께 보며 계산과 검산을 도와요.</p>
      <ul class="members">${LABELS.map(l => `<li>${chip(l.key)} ${claims[l.key] ? esc(nameOf(claims[l.key])) : '빈 자리'}</li>`).join('')}</ul>
      ${empty.map(l => `<button class="btn btn-line" data-act="takeSeat" data-l="${l.key}">빈 자리 ${l.name} 맡기</button>`).join(' ')}
    </section>`;
  }

  function revealHtml(card, drafts, myKey, idx) {
    const w = {}; LABELS.forEach(l => { w[l.key] = drafts[l.key].w; });
    const j = judge(card, w);
    let verdict;
    if (j.correct) verdict = `<div class="verdict ok"><span class="sym">○</span>맞혔어요! 판정: ${lab(j.winners[0]).name}</div>`;
    else if (j.tie) verdict = `<div class="verdict no"><span class="sym">×</span>${j.winners.map(k => lab(k).name).join('·')} 동점이라 틀렸어요. (정답: ${lab(card.answer).name})</div>`;
    else verdict = `<div class="verdict no"><span class="sym">×</span>틀렸어요. 판정: ${lab(j.winners[0]).name} (정답: ${lab(card.answer).name})</div>`;
    const tiles = LABELS.map(l => {
      const win = j.winners.includes(l.key);
      return `<div class="sc ${win ? 'win' : ''}" style="${cvars(l.key)}">
        <div class="nm">${l.name}</div><div class="pt">${j.scores[l.key]}<small>점</small></div>
        <div class="tags">${win ? `<span class="tg win">${j.tie ? '동점 1등' : '판정'}</span>` : ''}${l.key === card.answer ? '<span class="tg ans">정답</span>' : ''}${l.key === myKey ? '<span class="tg">나</span>' : ''}</div></div>`;
    }).join('');
    const last = idx === CARDS.length - 1;
    return `<section class="reveal" aria-live="polite"><h2>${card.id} 점수</h2>${verdict}<div class="scores">${tiles}</div>
      <div class="next-row"><span class="muted">다음으로 넘어가면 결정을 바꿀 수 없어요.</span>
      <button class="btn btn-main" data-act="next">${last ? '라운드 끝 보기 →' : `다음 (${CARDS[idx + 1].id}) →`}</button></div></section>`;
  }

  async function setWeight(g, key, f, v) {
    const st = room.groups[g].state;
    const d = st.drafts[key];
    if (!d || d.decided) return;
    const [lo, hi] = allowedRange(Number(st.weights[key][f]));
    if (v < lo || v > hi) return;
    await db.set(`${base()}/groups/${g}/state/drafts/${key}/w/${f}`, v);
  }
  async function setDecided(g, key, val) {
    const st = room.groups[g].state;
    const { round, card } = st.play;
    await db.txn(`${base()}/groups/${g}/state`, s => {
      if (!s || !s.play) return s;
      if (s.play.stage !== 'card' || s.play.round !== round || s.play.card !== card) return;
      s.drafts[key].decided = val; return s;
    });
  }

  async function nextCard(g) {
    const st = room.groups[g].state;
    const { round, card: idx } = st.play;
    let rec = null;
    const res = await db.txn(`${base()}/groups/${g}/state`, s => {
      if (!s || !s.play) return s;
      const p = s.play;
      if (p.stage !== 'card' || p.round !== round || p.card !== idx) return;
      const drafts = s.drafts || {};
      if (!LABELS.every(l => drafts[l.key] && drafts[l.key].decided)) return;
      const card = CARDS[idx];
      const before = {}, after = {};
      LABELS.forEach(l => { before[l.key] = { ...s.weights[l.key] }; after[l.key] = { ...drafts[l.key].w }; });
      const j = judge(card, after);
      rec = { round, cardIndex: idx, card: card.id, answer: card.answer, before, after, scores: j.scores, winners: j.winners, correct: j.correct, at: Date.now(), by: me.pid };
      s.weights = after;
      s.drafts = {};
      LABELS.forEach(l => { s.drafts[l.key] = { w: { ...after[l.key] }, decided: false }; });
      s.play = idx >= CARDS.length - 1 ? { round, card: idx, stage: 'roundEnd' } : { round, card: idx + 1, stage: 'card' };
      return s;
    });
    if (res.committed && rec) await db.set(`${base()}/groups/${g}/history/r${round}c${idx + 1}`, rec);
  }

  // ---------- 5. 라운드 끝 ----------
  function renderRoundEnd(g, st, history) {
    const r = st.play.round;
    const recs = CARDS.map((c, i) => history[`r${r}c${i + 1}`]);
    const ok = recs.filter(x => x && x.correct).length;
    const allOk = ok === 8;
    app.innerHTML = topbar(`<b>${r}라운드</b> 끝`) + `<div class="wrap narrow" style="max-width:760px">
      <section class="panel round-end">
        <h1>${r}라운드가 끝났어요</h1>
        <p class="big">8장 중 ${ok}장</p><p class="lead">맞혔어요${allOk ? ' — 모두 맞혔어요! 선생님께 알려 주세요.' : '.'}</p>
        <div class="ox">${CARDS.map((c, i) => { const x = recs[i]; const o = x && x.correct;
          return `<div class="${x ? (o ? 'o' : 'x') : ''}"><b>${c.id}</b><span>${x ? (o ? '○' : '×') : '…'}</span></div>`; }).join('')}</div>
        <p class="ask">다음 라운드를 시작하시겠습니까?</p>
        <p class="muted">가중치는 지금 값 그대로 이어져요.</p>
        <button class="btn btn-main" data-act="nextRound" style="min-width:200px">예</button>
      </section></div>`;
  }
  async function nextRound(g) {
    const r = room.groups[g].state.play.round;
    await db.txn(`${base()}/groups/${g}/state`, s => {
      if (!s || !s.play) return s;
      if (s.play.stage !== 'roundEnd' || s.play.round !== r) return;
      s.play = { round: r + 1, card: 0, stage: 'card' };
      return s;
    });
  }

  async function takeSeat(g, key) {
    const res = await db.txn(`${base()}/groups/${g}/lobby`, lb => {
      lb = lb || {}; const cl = lb.claims || {};
      if (cl[key]) return;
      if (Object.values(cl).includes(me.pid)) return;
      cl[key] = me.pid; lb.claims = cl; return lb;
    });
    if (!res.committed) toast('이미 다른 친구가 맡았어요.');
  }

  // ---------- 클릭 처리 ----------
  app.addEventListener('click', async e => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled || !me || !room) return;
    const p = room.players && room.players[me.pid];
    const g = p && p.group;
    const a = b.dataset.act;
    try {
      if (a === 'group') await pickGroup(Number(b.dataset.g));
      else if (a === 'claim') await claim(g, b.dataset.l);
      else if (a === 'confirmLobby') await setLobbyConfirmed(g, true);
      else if (a === 'unconfirmLobby') await setLobbyConfirmed(g, false);
      else if (a === 'regroup') { await releaseClaim(g); await db.update(`${base()}/players/${me.pid}`, { group: null }); }
      else if (a === 'regroupAct') await db.update(`${base()}/players/${me.pid}`, { group: null });
      else if (a === 'w') await setWeight(g, b.dataset.l, b.dataset.f, Number(b.dataset.v));
      else if (a === 'decide') await setDecided(g, (LABELS.find(l => (room.groups[g].lobby.claims || {})[l.key] === me.pid) || {}).key, b.dataset.v === '1');
      else if (a === 'next') { b.disabled = true; await nextCard(g); }
      else if (a === 'nextRound') { b.disabled = true; await nextRound(g); }
      else if (a === 'takeSeat') await takeSeat(g, b.dataset.l);
    } catch (err) {
      console.error(err);
      toast('저장하지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.');
    }
  });

  if (me) subscribe(); else renderJoin();
})();
