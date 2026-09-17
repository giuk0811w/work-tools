'use strict';
/* global window, document, U, App */
window.Views = window.Views || {};

function sessionCardHtml(it, { showDate = false } = {}) {
  const st = it.confirmed ? '<span class="tag ok">확정</span>' : (it.hasRecord ? '<span class="tag warn">입력중</span>' : '<span class="tag muted">미확인</span>');
  const sm = it.summary;
  const counts = it.confirmed || it.hasRecord ? `<span class="meta">출석 ${sm.P} · 결석 ${sm.X} · 인정대기 ${sm.W} · 인정 ${sm.E}</span>` : `<span class="meta">학생 ${it.studentCount}명</span>`;
  return `<div class="session-card ${it.state === 'now' ? 'now' : ''}" data-subject="${it.subjectId}" data-date="${it.session.date}">
    <div class="time">${showDate ? U.fmt(it.session.date) + '<br>' : ''}${U.esc(it.timeLabel || '시간 미설정')}</div>
    <div class="name">${U.esc(it.subjectName)} ${it.state === 'now' ? '<span class="tag info">지금</span>' : ''}</div>
    <div class="seq">${U.esc(it.seqLabel)}</div>
    <div>${st}<br>${counts}</div>
  </div>`;
}

window.Views.home = {
  async render(main, params) {
    const date = params.date || App.state.today;
    const h = await U.api('home.get', { date });
    main.innerHTML = `
      <div class="row between">
        <h1>${h.isToday ? '오늘' : ''} ${U.fmtFull(h.date)} 수업</h1>
        <div class="row no-print">
          <button class="btn" id="prev-day">◀ 전날</button>
          <input type="date" id="pick-date" value="${h.date}">
          <button class="btn" id="next-day">다음날 ▶</button>
          <button class="btn" id="today-btn">오늘</button>
        </div>
      </div>
      <div id="sessions">${h.sessions.length ? h.sessions.map((s) => sessionCardHtml(s)).join('') : '<div class="empty">이 날짜에는 수업이 없습니다. 시간표는 설정에서 조정할 수 있습니다.</div>'}</div>
      <h2>이번 주</h2>
      <div class="week">${h.week.map((d) => `<div class="day ${d.date === App.state.today ? 'today' : ''} ${d.date === h.date ? 'selected' : ''}" data-date="${d.date}"><div class="d">${U.fmtShort(d.date)} (${d.dowKo})</div>${d.sessions.map((s) => `<div class="s ${s.confirmed ? 'done' : ''}" title="${U.esc(s.subjectName)} ${U.esc(s.seqLabel)}">${U.esc(s.subjectName)} <span class="muted">${U.esc(s.seqLabel)}</span></div>`).join('')}</div>`).join('')}</div>
      ${h.unconfirmed.length ? `<h2>확인하지 않은 지난 수업 <span class="badge">${h.unconfirmed.length}</span></h2><div class="small muted" style="margin-bottom:8px">확인 버튼을 누르지 않은 수업입니다. 열어서 출결을 확인해 주세요. 확인하지 않은 수업은 출석부에 빈칸으로 남습니다.</div>${h.unconfirmed.map((s) => sessionCardHtml(s, { showDate: true })).join('')}` : ''}
      ${h.pendingCount ? `<div class="panel row between" style="margin-top:18px"><div>공문 접수를 기다리는 인정결석 대기 건이 <b>${h.pendingCount}건</b> 있습니다.</div><button class="btn" id="go-pending">대기 목록 보기</button></div>` : ''}
    `;
    main.querySelectorAll('.session-card').forEach((c) => c.addEventListener('click', () => App.go('entry', { subjectId: c.dataset.subject, date: c.dataset.date, back: { view: 'home', params: { date: h.date } } })));
    main.querySelectorAll('.week .day').forEach((c) => c.addEventListener('click', () => App.go('home', { date: c.dataset.date })));
    main.querySelector('#pick-date').addEventListener('change', (e) => { if (e.target.value) App.go('home', { date: e.target.value }); });
    main.querySelector('#prev-day').addEventListener('click', () => App.go('home', { date: U.addDays(h.date, -1) }));
    main.querySelector('#next-day').addEventListener('click', () => App.go('home', { date: U.addDays(h.date, 1) }));
    main.querySelector('#today-btn').addEventListener('click', () => App.go('home'));
    const gp = main.querySelector('#go-pending'); if (gp) gp.addEventListener('click', () => App.go('pending'));
  },
};
window.sessionCardHtml = sessionCardHtml;
