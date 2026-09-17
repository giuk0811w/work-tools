'use strict';
/* global window, document, U, App, sessionCardHtml */
window.Views = window.Views || {};

window.Views.search = {
  async render(main, params) {
    const subjects = App.state.semester.subjects;
    const q = { subjectId: params.subjectId || '', from: params.from || '', to: params.to || '' };
    main.innerHTML = `
      <h1>날짜·과목으로 수업 찾기</h1>
      <div class="panel row">
        <label class="inline">과목 <select id="q-subject"><option value="">전체</option>${subjects.map((s) => `<option value="${s.id}" ${q.subjectId === s.id ? 'selected' : ''}>${U.esc(s.name)}</option>`).join('')}</select></label>
        <label class="inline">기간 <input type="date" id="q-from" value="${q.from}"> ~ <input type="date" id="q-to" value="${q.to}"></label>
        <button class="btn primary" id="q-run">검색</button>
        <button class="btn" id="q-week">이번 주</button>
        <button class="btn" id="q-month">이번 달</button>
        <span class="small muted">과목만 고르고 기간을 비우면 학기 전체 수업 목록이 나옵니다.</span>
      </div>
      <div id="results"></div>`;
    const run = async () => {
      const subjectId = main.querySelector('#q-subject').value; const from = main.querySelector('#q-from').value; const to = main.querySelector('#q-to').value;
      const list = await U.api('session.search', { subjectId: subjectId || undefined, from: from || undefined, to: to || undefined });
      const res = main.querySelector('#results');
      if (!list.length) { res.innerHTML = '<div class="empty">조건에 맞는 수업이 없습니다.</div>'; return; }
      // 날짜별 묶기
      const byDate = new Map();
      for (const it of list) { if (!byDate.has(it.session.date)) byDate.set(it.session.date, []); byDate.get(it.session.date).push(it); }
      res.innerHTML = `<div class="small muted" style="margin:8px 0">${list.length}개 수업. 카드를 누르면 출결을 보거나 수정할 수 있습니다.</div>` + [...byDate.entries()].map(([d, items]) => `<h3>${U.fmtFull(d)} ${d === App.state.today ? '<span class="tag info">오늘</span>' : ''}</h3>${items.map((s) => sessionCardHtml(s)).join('')}`).join('');
      res.querySelectorAll('.session-card').forEach((c) => c.addEventListener('click', () => App.go('entry', { subjectId: c.dataset.subject, date: c.dataset.date, back: { view: 'search', params: { subjectId, from, to } } })));
    };
    main.querySelector('#q-run').addEventListener('click', run);
    main.querySelector('#q-week').addEventListener('click', () => { const t = App.state.today; const d = U.fromISO(t).getDay() || 7; main.querySelector('#q-from').value = U.addDays(t, -(d - 1)); main.querySelector('#q-to').value = U.addDays(t, 7 - d); run(); });
    main.querySelector('#q-month').addEventListener('click', () => { const t = App.state.today; main.querySelector('#q-from').value = t.slice(0, 8) + '01'; const d = U.fromISO(t); const last = new Date(d.getFullYear(), d.getMonth() + 1, 0); main.querySelector('#q-to').value = U.toISO(last); run(); });
    if (q.subjectId || q.from || q.to) run(); else { main.querySelector('#q-week').click(); }
  },
};
