'use strict';
/* global window, document, U, App */
window.Views = window.Views || {};

window.Views.entry = {
  async render(main, params) {
    const { subjectId, date } = params;
    const v = await U.api('session.get', { subjectId, date });
    const back = params.back || { view: 'home', params: {} };
    if (!v.session) {
      main.innerHTML = `<button class="btn" id="back">◀ 돌아가기</button><div class="empty" style="margin-top:14px">${U.esc(v.subject.name)} 과목은 ${U.fmt(date)}에 수업이 없습니다.<br><span class="small">보강 수업이라면 설정 &gt; 학사일정에서 보강을 등록하세요.</span></div>`;
      main.querySelector('#back').addEventListener('click', () => App.go(back.view, back.params));
      return;
    }
    const periods = v.session.periods;
    let splitMode = v.rows.some((r) => new Set(r.statuses).size > 1);
    let editing = !v.confirmed;
    const rows = v.rows.map((r) => ({ ...r, statuses: r.statuses.slice() }));

    const draw = () => {
      main.innerHTML = `
        <div class="row between no-print">
          <button class="btn" id="back">◀ 돌아가기</button>
          <div class="row">
            <button class="btn small" id="prev-session">이전 수업일</button>
            <button class="btn small" id="next-session">다음 수업일</button>
          </div>
        </div>
        <h1 style="margin-top:12px">${U.esc(v.subject.name)} <span class="muted" style="font-weight:400;font-size:16px">${U.fmtFull(date)}${v.timeLabel ? ' · ' + U.esc(v.timeLabel) : ''} · ${U.esc(v.seqLabel)}</span></h1>
        <div class="row" style="margin-bottom:12px">
          ${v.confirmed ? `<span class="tag ok">확정됨</span><span class="small muted">${v.confirmedAt ? new Date(v.confirmedAt).toLocaleString('ko-KR') : ''}</span>` : '<span class="tag muted">미확인</span>'}
          ${periods > 1 ? `<label class="inline small no-print" style="margin-left:auto"><input type="checkbox" id="split" ${splitMode ? 'checked' : ''}> 차시별로 따로 입력 (${periods}차시 연강)</label>` : ''}
        </div>
        <div class="panel">
          <div class="small muted" style="margin-bottom:8px">누르지 않은 학생은 출석으로 처리됩니다. 사전 등록된 소속교 행사·공문이 있는 학생은 인정결석으로 미리 표시됩니다(공문 접수 전이면 대기).</div>
          <table class="entry-table">
            <thead><tr><th style="width:40px">번호</th><th>소속교</th><th style="width:90px">학번</th><th style="width:110px">이름</th><th>${splitMode ? '차시별 출결' : '출결'}</th><th style="width:220px">비고</th></tr></thead>
            <tbody>${rows.map((r, i) => rowHtml(r, i)).join('')}</tbody>
          </table>
        </div>
        <div class="row between no-print">
          <div class="summary-bar" id="summary"></div>
          <div class="row">
            ${editing ? `<button class="btn" id="save-draft">임시 저장</button><button class="btn primary big" id="confirm">출결 확인 (확정)</button>` : `<button class="btn" id="edit">수정</button>`}
          </div>
        </div>`;
      const rowHtmlRef = rowHtml; void rowHtmlRef;
      updateSummary();
      main.querySelector('#back').addEventListener('click', () => App.go(back.view, back.params));
      main.querySelector('#prev-session').addEventListener('click', () => moveSession(-1));
      main.querySelector('#next-session').addEventListener('click', () => moveSession(1));
      const split = main.querySelector('#split');
      if (split) split.addEventListener('change', () => { splitMode = split.checked; if (!splitMode) rows.forEach((r) => { r.statuses = r.statuses.map(() => r.statuses[0]); }); draw(); });
      main.querySelectorAll('.status-group button').forEach((b) => b.addEventListener('click', () => {
        if (!editing) return;
        const r = rows[Number(b.dataset.row)]; const p = b.dataset.period;
        if (p === 'all') r.statuses = r.statuses.map(() => b.dataset.status); else r.statuses[Number(p)] = b.dataset.status;
        r.auto = false;
        refreshRow(Number(b.dataset.row));
      }));
      const sd = main.querySelector('#save-draft'); if (sd) sd.addEventListener('click', () => save(false));
      const cf = main.querySelector('#confirm'); if (cf) cf.addEventListener('click', () => save(true));
      const ed = main.querySelector('#edit'); if (ed) ed.addEventListener('click', async () => { if (await U.confirm('수정', '확정된 출결을 수정합니다. 수정 후 다시 확인 버튼을 눌러 주세요.')) { editing = true; draw(); } });
    };

    function statusButtons(r, i, p) {
      const cur = p === 'all' ? r.statuses[0] : r.statuses[p];
      return `<span class="status-group">${['P', 'X', 'W', 'E'].map((s) => `<button data-row="${i}" data-period="${p}" data-status="${s}" class="${cur === s ? 'sel-' + s : ''}" ${editing ? '' : 'disabled'}>${U.STATUS_SHORT[s]}</button>`).join('')}</span>`;
    }
    function rowHtml(r, i) {
      return `<tr id="row-${i}" class="${r.enrolled ? '' : 'disabled'}">
        <td class="center">${i + 1}</td><td>${U.esc(r.student.school)}</td><td>${U.esc(r.student.no)}</td><td class="name">${U.esc(r.student.name)}${r.enrolled ? '' : ' <span class="tag muted">수강취소</span>'}</td>
        <td>${r.enrolled ? (splitMode ? r.statuses.map((s, p) => `<div class="row" style="margin:2px 0"><span class="small muted" style="width:52px">${v.session.seq + p}차시</span>${statusButtons(r, i, p)}</div>`).join('') : statusButtons(r, i, 'all')) : '<span class="muted small">해당 없음</span>'}</td>
        <td class="small">${r.enrolled && r.reason ? U.esc(r.reason) : ''}${r.enrolled && r.auto ? ' <span class="tag warn">사전 등록</span>' : ''}</td>
      </tr>`;
    }
    function refreshRow(i) {
      const tr = main.querySelector(`#row-${i}`);
      const tmp = document.createElement('tbody'); tmp.innerHTML = rowHtml(rows[i], i);
      tr.replaceWith(tmp.firstElementChild);
      main.querySelectorAll(`#row-${i} .status-group button`).forEach((b) => b.addEventListener('click', () => {
        if (!editing) return;
        const r = rows[i]; const p = b.dataset.period;
        if (p === 'all') r.statuses = r.statuses.map(() => b.dataset.status); else r.statuses[Number(p)] = b.dataset.status;
        r.auto = false; refreshRow(i);
      }));
      updateSummary();
    }
    function updateSummary() {
      const c = { P: 0, X: 0, W: 0, E: 0 };
      for (const r of rows) { if (!r.enrolled) continue; const st = r.statuses.includes('X') ? 'X' : r.statuses.includes('W') ? 'W' : r.statuses.includes('E') ? 'E' : 'P'; c[st] += 1; }
      const el = main.querySelector('#summary');
      if (el) el.innerHTML = `<div class="item">출석 <b>${c.P}</b></div><div class="item">결석 <b>${c.X}</b></div><div class="item">인정결석 대기 <b>${c.W}</b></div><div class="item">인정결석 <b>${c.E}</b></div>`;
    }
    async function save(confirm) {
      try {
        const payload = rows.map((r) => ({ studentId: r.studentId, statuses: r.statuses, reason: r.reason, docNo: r.docNo, docDate: r.docDate }));
        await U.api('session.save', { subjectId, date, rows: payload, confirm });
        U.toast(confirm ? `${U.fmt(date)} ${v.subject.name} 출결을 확정했습니다.` : '임시 저장했습니다.');
        if (confirm) App.go(back.view, back.params); else App.go('entry', params);
      } catch (e) { U.toast(e.message, true); }
    }
    async function moveSession(dir) {
      const list = await U.api('session.search', { subjectId });
      const idx = list.findIndex((s) => s.session.date === date);
      const next = list[idx + dir];
      if (!next) { U.toast(dir < 0 ? '첫 수업입니다.' : '마지막 수업입니다.'); return; }
      App.go('entry', { subjectId, date: next.session.date, back });
    }
    draw();
  },
};
