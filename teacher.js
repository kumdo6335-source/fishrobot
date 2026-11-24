'use strict';
(async function () {
  const { LABELS, LABEL_BY_KEY, FEATS, CARDS, GROUP_COUNT, esc, initWeights, toast } = PA;
  const app = document.getElementById('app');
  const TKEY = 'pa45_teacher_room';
  let db, code = localStorage.getItem(TKEY), room, unsub = null;

  try { db = await PA.connect(); }
  catch (e) { app.innerHTML = `<div class="wrap narrow"><div class="err">Firebase에 연결하지 못했습니다. (${esc(e.message)})</div></div>`; return; }
  db.onConnection(ok => { document.getElementById('conn').innerHTML = ok ? '' : '<div class="conn-off">서버 연결이 끊겼습니다. 자동으로 다시 연결합니다.</div>'; });


  const base = () => `rooms/${code}`;
  const lab = k => LABEL_BY_KEY[k];
  const cv = k => `--c:${lab(k).color};--s:${lab(k).soft}`;
  const chip = k => `<span class="chip" style="${cv(k)}">${lab(k).name}</span>`;

  function renderStart(msg) {
    app.innerHTML = `<div class="topbar"><span class="who">바닷속 신경망 학습 · 선생님</span><span class="where">4·5차시</span></div>
      <div class="wrap narrow">
        <h1>수업 열기</h1>
        ${msg ? `<div class="err">${esc(msg)}</div>` : ''}
        <div class="panel">
          <button class="btn btn-main btn-wide" data-act="create">새 수업 만들기</button>
          <p class="muted">입장 코드(숫자 네 자리)가 만들어집니다. 칠판에 띄워 학생에게 알려 주세요.</p>
          <hr style="border:none;border-top:1px solid var(--line);margin:18px 0">
          <form id="resume"><label class="field"><span>이어서 하기 (입장 코드)</span><input id="rcode" inputmode="numeric" maxlength="4"></label>
          <button class="btn btn-line btn-wide" type="submit">이 수업 다시 열기</button></form>
        </div>
      </div>`;
    document.getElementById('resume').onsubmit = async e => {
      e.preventDefault();
      const c = document.getElementById('rcode').value.trim();
      if (!(await db.get(`rooms/${c}/meta`))) return renderStart('그 코드의 수업이 없습니다.');
      open(c);
    };
  }

  async function createRoom() {
    let c;
    for (let i = 0; i < 20; i++) {
      c = String(Math.floor(1000 + Math.random() * 9000));
      if (!(await db.get(`rooms/${c}/meta`))) break;
    }
    await db.set(`rooms/${c}/meta`, { phase: 'join', createdAt: Date.now() });
    open(c);
  }

  function open(c) {
    code = c; localStorage.setItem(TKEY, c);
    if (unsub) unsub();
    room = undefined;
    unsub = db.sub(base(), v => { room = v; render(); });
  }

  function close() {
    if (unsub) unsub(); unsub = null;
    localStorage.removeItem(TKEY); code = null; room = null;
    renderStart();
  }

  // ---------- 계산 ----------
  function membersOf(g) {
    return Object.entries((room && room.players) || {}).filter(([, p]) => p.group === g).sort((a, b) => (a[1].at || 0) - (b[1].at || 0));
  }
  const activeGroups = () => { const s = []; for (let g = 1; g <= GROUP_COUNT; g++) if (membersOf(g).length) s.push(g); return s; };
  const grp = g => (room.groups || {})[g] || {};
  function roundSummary(g) {
    const h = grp(g).history || {};
    const st = grp(g).state;
    const maxR = st && st.play ? st.play.round : 0;
    const out = [];
    for (let r = 1; r <= maxR; r++) {
      const recs = CARDS.map((c, i) => h[`r${r}c${i + 1}`]).filter(Boolean);
      out.push({ r, n: recs.length, ok: recs.filter(x => x.correct).length });
    }
    return out;
  }

  // ---------- 화면 ----------
  function render() {
    if (room === undefined) return;
    if (!room || !room.meta) return close();
    const phase = room.meta.phase;
    const act = activeGroups();
    const players = room.players || {};
    const noGroup = Object.values(players).filter(p => !p.group);
    const stepIdx = { join: 0, select: 1, activity: 2 }[phase];
    const steps = ['모둠 고르기', '역할 고르기', '학습 활동'];

    let action = '';
    if (phase === 'join') {
      const n = Object.keys(players).length;
      action = `<button class="btn btn-main" data-act="toSelect" ${act.length ? '' : 'disabled'}>시작</button>
        <span class="msg">들어온 학생 ${n}명 · 모둠 ${act.length}개${noGroup.length ? ` · 모둠 안 고름: ${noGroup.map(p => esc(p.name)).join(', ')}` : ''}<br>시작을 누르면 같은 모둠끼리 모여 역할(해파리·불가사리·물고기·쓰레기)을 고릅니다.</span>`;
    } else if (phase === 'select') {
      const done = act.filter(g => grp(g).lobby && grp(g).lobby.confirmed);
      const ready = act.length > 0 && done.length === act.length;
      action = `<button class="btn btn-main" data-act="toActivity" ${ready ? '' : 'disabled'}>활동 시작</button>
        <span class="msg">결정한 모둠 ${done.length}/${act.length}${ready ? ' — 모든 모둠이 결정했습니다.' : ` · 기다리는 모둠: ${act.filter(g => !done.includes(g)).map(g => g + '모둠').join(', ')}`}</span>
        <button class="btn btn-line btn-small" data-act="toJoin">모둠 고르기로 되돌리기</button>`;
    } else {
      action = `<span class="msg"><b>학습 활동 중</b> · 모둠마다 L1~L8을 차례로 진행합니다. 라운드 끝에서 학생이 [예]를 누르면 다음 라운드로 넘어갑니다.</span>
        <button class="btn btn-line btn-small" data-act="csv">기록 CSV 내려받기</button>`;
    }

    let html = `<div class="topbar"><span class="who">바닷속 신경망 학습 · 선생님</span><span class="where">${db.mode === 'local' ? '연습 모드' : '실시간 연결'}</span></div>
    <div class="wrap">
      <div class="t-head">
        <div class="code-box"><span>입장 코드</span><b>${esc(code)}</b></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-line btn-small" data-act="csv">CSV</button>
          <button class="btn btn-line btn-small" data-act="leave">다른 수업 열기</button>
          <button class="btn btn-danger btn-small" data-act="wipe">수업 지우기</button>
        </div>
      </div>
      <ol class="steps">${steps.map((s, i) => `<li class="${i === stepIdx ? 'now' : i < stepIdx ? 'done' : ''}"><b>${i + 1}. ${s}</b>${['학생이 모둠 번호 선택', '모둠 안에서 라벨 하나씩', 'L1~L8 라운드 학습'][i]}</li>`).join('')}</ol>
      <div class="action-row">${action}</div>`;

    if (phase === 'activity') html += roundTableHtml(act);
    html += `<div class="t-groups">`;
    for (let g = 1; g <= GROUP_COUNT; g++) html += groupCardHtml(g, phase);
    html += `</div></div>`;
    app.innerHTML = html;
  }

  function roundTableHtml(act) {
    const sums = act.map(g => ({ g, s: roundSummary(g), st: grp(g).state }));
    const maxR = Math.max(1, ...sums.map(x => x.s.length));
    let h = `<h2 class="section-title">라운드표 (맞힌 카드 수 / 8)</h2><table class="rtable"><thead><tr><th>모둠</th>`;
    for (let r = 1; r <= maxR; r++) h += `<th>${r}라운드</th>`;
    h += `<th>지금</th></tr></thead><tbody>`;
    for (const { g, s, st } of sums) {
      h += `<tr><th>${g}모둠</th>`;
      for (let r = 1; r <= maxR; r++) {
        const x = s[r - 1];
        if (!x) h += '<td></td>';
        else if (x.n === 8) h += `<td class="${x.ok === 8 ? 'full' : ''}">${x.ok}${x.ok === 8 ? ' ○' : ''}</td>`;
        else h += `<td class="cur">${x.ok} (${x.n}장 함)</td>`;
      }
      h += `<td>${st && st.play ? posText(st) : '—'}</td></tr>`;
    }
    return h + `</tbody></table>`;
  }
  function posText(st) {
    const p = st.play;
    if (p.stage === 'roundEnd') return `${p.round}라운드 끝, 다음 라운드 대기`;
    const d = st.drafts || {};
    return `${p.round}라운드 · ${CARDS[p.card].id} (결정 ${LABELS.filter(l => d[l.key] && d[l.key].decided).length}/4)`;
  }

  function groupCardHtml(g, phase) {
    const mem = membersOf(g);
    const G = grp(g);
    const claims = (G.lobby && G.lobby.claims) || {};
    let status = '';
    if (!mem.length) status = '<span class="st">비어 있음</span>';
    else if (phase === 'join') status = `<span class="st">${mem.length}명</span>`;
    else if (phase === 'select') status = G.lobby && G.lobby.confirmed ? '<span class="st ok">✓ 결정</span>' : `<span class="st wait">고르는 중 ${LABELS.filter(l => claims[l.key]).length}/4</span>`;
    else status = G.state ? `<span class="st ok">${G.state.play.round}라운드</span>` : '<span class="st wait">미참여</span>';

    let h = `<div class="t-group"><h3>${g}모둠 ${status}</h3>`;
    if (!mem.length) return h + `<div class="t-empty">아직 들어온 학생이 없습니다.</div></div>`;
    h += `<ul>${mem.map(([id, p]) => {
      const lk = LABELS.find(l => claims[l.key] === id);
      return `<li><span>${esc(p.name)} ${lk ? chip(lk.key) : ''}</span><button class="kick" data-act="kick" data-pid="${id}" aria-label="${esc(p.name)} 내보내기">내보내기</button></li>`;
    }).join('')}</ul>`;
    if (phase === 'activity' && G.state) {
      const st = G.state;
      h += `<div class="pos">${posText(st)}</div><table class="wtable"><thead><tr><th>가중치</th>${FEATS.map(f => `<th>${f}</th>`).join('')}</tr></thead><tbody>`;
      for (const l of LABELS) {
        const w = (st.weights && st.weights[l.key]) || {};
        h += `<tr style="${cv(l.key)}"><td class="lb">${l.name}</td>${FEATS.map(f => `<td>${w[f]}</td>`).join('')}</tr>`;
      }
      h += `</tbody></table><div class="muted" style="font-size:13px;margin-top:4px">지금 카드를 시작할 때의 값</div>`;
    }
    return h + `</div>`;
  }

  // ---------- 동작 ----------
  async function toActivity() {
    const act = activeGroups();
    if (!act.every(g => grp(g).lobby && grp(g).lobby.confirmed)) return toast('아직 결정하지 않은 모둠이 있습니다.');
    const upd = {};
    for (const g of act) {
      const weights = {}, drafts = {};
      LABELS.forEach(l => { weights[l.key] = initWeights(); drafts[l.key] = { w: initWeights(), decided: false }; });
      upd[`groups/${g}/state`] = { play: { round: 1, card: 0, stage: 'card' }, weights, drafts };
      upd[`groups/${g}/history`] = null;
    }
    upd['meta/phase'] = 'activity';
    upd['meta/activityAt'] = Date.now();
    await db.update(base(), upd);
  }

  async function kick(pid) {
    const p = room.players[pid];
    if (!p) return;
    const inAct = room.meta.phase === 'activity';
    if (!confirm(`${p.name} 학생을 내보낼까요?${inAct ? '\n맡은 노드는 빈 자리가 되고, 같은 모둠의 다른 학생이 맡을 수 있습니다.' : ''}\n학생은 다시 들어올 수 있습니다.`)) return;
    if (p.group) {
      await db.txn(`${base()}/groups/${p.group}/lobby`, lb => {
        if (!lb) return lb;
        const cl = lb.claims || {};
        for (const k of Object.keys(cl)) if (cl[k] === pid) delete cl[k];
        lb.claims = cl;
        if (!inAct) lb.confirmed = false;
        return lb;
      });
    }
    await db.remove(`${base()}/players/${pid}`);
  }

  function csvExport() {
    const rows = [];
    const head = ['모둠', '라운드', '카드', '정답', '판정', '결과', '수정 내용', ...LABELS.map(l => l.name + ' 점수')];
    LABELS.forEach(l => FEATS.forEach(f => head.push(`${l.name} ${f} 전`)));
    LABELS.forEach(l => FEATS.forEach(f => head.push(`${l.name} ${f} 후`)));
    LABELS.forEach(l => head.push(`${l.name} 담당`));
    head.push('시각');
    rows.push(head);
    for (let g = 1; g <= GROUP_COUNT; g++) {
      const G = grp(g);
      const claims = (G.lobby && G.lobby.claims) || {};
      const recs = Object.values(G.history || {}).sort((a, b) => a.round - b.round || a.cardIndex - b.cardIndex);
      for (const r of recs) {
        const winners = r.winners || [];
        const changes = [];
        LABELS.forEach(l => FEATS.forEach(f => {
          const d = r.after[l.key][f] - r.before[l.key][f];
          if (d) changes.push(`${l.name} ${f}${d > 0 ? '+' : ''}${d}`);
        }));
        const row = [g, r.round, r.card, lab(r.answer).name, winners.length > 1 ? '동점(' + winners.map(k => lab(k).name).join('·') + ')' : lab(winners[0]).name, r.correct ? '○' : '×', changes.join('; '), ...LABELS.map(l => r.scores[l.key])];
        LABELS.forEach(l => FEATS.forEach(f => row.push(r.before[l.key][f])));
        LABELS.forEach(l => FEATS.forEach(f => row.push(r.after[l.key][f])));
        LABELS.forEach(l => row.push(claims[l.key] && room.players && room.players[claims[l.key]] ? room.players[claims[l.key]].name : ''));
        row.push(new Date(r.at).toLocaleString('ko-KR'));
        rows.push(row);
      }
    }
    if (rows.length === 1) return toast('아직 기록이 없습니다.');
    const csv = '﻿' + rows.map(r => r.map(v => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `4-5차시_학습기록_${code}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  app.addEventListener('click', async e => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const a = b.dataset.act;
    try {
      if (a === 'create') { b.disabled = true; await createRoom(); }
      else if (a === 'toSelect') await db.update(`${base()}/meta`, { phase: 'select' });
      else if (a === 'toJoin') { if (confirm('모둠 고르기 단계로 되돌릴까요? 학생이 고른 역할은 그대로 남습니다.')) await db.update(`${base()}/meta`, { phase: 'join' }); }
      else if (a === 'toActivity') { b.disabled = true; await toActivity(); }
      else if (a === 'kick') await kick(b.dataset.pid);
      else if (a === 'csv') csvExport();
      else if (a === 'leave') close();
      else if (a === 'wipe') {
        if (confirm(`입장 코드 ${code} 수업을 지울까요?\n학생 목록과 학습 기록이 모두 사라지며 되돌릴 수 없습니다. 먼저 CSV를 내려받아 두세요.`)) { const c = code; close(); await db.remove(`rooms/${c}`); }
      }
    } catch (err) { console.error(err); toast('저장하지 못했습니다: ' + err.message); }
  });

  if (code) open(code); else renderStart();
})();
