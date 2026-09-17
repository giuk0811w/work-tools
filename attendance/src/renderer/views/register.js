'use strict';
/* global window, document, U, App */
window.Views = window.Views || {};

window.Views.register = {
  async render(main, params) {
    const subjects = App.state.semester.subjects;
    if (!subjects.length) { main.innerHTML = '<div class="empty">과목이 없습니다. 설정에서 과목을 추가하세요.</div>'; return; }
    const subjectId = params.subjectId || subjects[0].id;
    const upTo = params.upTo !== undefined ? params.upTo : App.state.today; // 기본: 오늘까지 누적
    const r = await U.api('register.get', { subjectId, to: upTo || undefined });
    const pre = await U.api('export.precheck');
    const mine = pre.find((p) => p.subjectId === subjectId) || { pending: 0, unconfirmed: 0 };
    main.innerHTML = `
      <div class="no-print">
        <div class="row between">
          <h1>출석부 열람·출력</h1>
          <div class="row">
            <button class="btn" id="print">인쇄</button>
            <button class="btn" id="pdf">PDF 저장</button>
            <button class="btn primary" id="xlsx">엑셀(출석부 양식)로 내보내기</button>
          </div>
        </div>
        <div class="tabs">${subjects.map((s) => `<button data-id="${s.id}" class="${s.id === subjectId ? 'active' : ''}">${U.esc(s.name)}</button>`).join('')}</div>
        <div class="row" style="margin-bottom:10px">
          <label class="inline"><input type="radio" name="range" value="today" ${upTo ? 'checked' : ''}> 오늘까지 누적</label>
          <label class="inline"><input type="radio" name="range" value="all" ${upTo ? '' : 'checked'}> 학기 전체(예정 포함)</label>
          <span class="small muted" style="margin-left:12px">범례: O 출석, X 미인정결석, ◎ 인정결석 (노란색은 공문 대기), 빈칸은 미확인 수업</span>
          ${mine.unconfirmed ? `<span class="tag danger">미확인 수업 ${mine.unconfirmed}건</span>` : ''}${mine.pending ? `<span class="tag warn">대기 ${mine.pending}건</span>` : ''}
        </div>
      </div>
      <div class="print-only"><h2 style="margin:0 0 6px">${U.esc(r.semester.name)} ${U.esc(r.semester.school)} 출석부 — ${U.esc(r.subject.name)} (${r.subject.credits ?? ''}학점, ${U.esc(r.subject.teacher || App.state.settings.teacher || '')})</h2><div class="small">출석: O, 인정결석: ◎, 미인정결석: X · 출력일 ${U.fmtFull(App.state.today)}</div></div>
      <div class="panel register-wrap">${matrixHtml(r)}</div>`;
    main.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => App.go('register', { subjectId: b.dataset.id, upTo })));
    main.querySelectorAll('input[name=range]').forEach((i) => i.addEventListener('change', () => App.go('register', { subjectId, upTo: i.value === 'today' ? App.state.today : '' })));
    main.querySelector('#print').addEventListener('click', () => window.print());
    main.querySelector('#pdf').addEventListener('click', async () => { try { const f = await U.api('print.pdf', { landscape: true, defaultName: `${r.subject.name}_출석부.pdf` }); if (f) U.toast(`저장했습니다: ${f}`, false, 4000); } catch (e) { U.toast(e.message, true); } });
    main.querySelector('#xlsx').addEventListener('click', () => exportXlsx(pre, subjects));
    main.querySelectorAll('th[data-date]').forEach((th) => th.addEventListener('click', () => App.go('entry', { subjectId, date: th.dataset.date, back: { view: 'register', params: { subjectId, upTo } } })));
  },
};

function matrixHtml(r) {
  const cols = r.columns;
  if (!cols.length) return '<div class="empty">표시할 수업이 없습니다.</div>';
  const head1 = cols.map((c) => `<th class="${c.confirmed ? '' : (c.future ? 'future' : 'unconfirmed')}" data-date="${c.date}" title="${c.confirmed ? '확정' : (c.future ? '예정' : '미확인 — 눌러서 입력')}" style="cursor:pointer">${c.seq}</th>`).join('');
  const head2 = cols.map((c) => `<th class="${c.confirmed ? '' : (c.future ? 'future' : 'unconfirmed')}">${U.fmtShort(c.date)}</th>`).join('');
  const body = r.students.map((st, i) => {
    const cells = cols.map((c) => {
      const cell = c.cells[i];
      if (!cell.enrolled) return '<td class="na"></td>';
      if (cell.status == null) return '<td></td>';
      return `<td class="st-${cell.status}" title="${U.esc(cell.reason || '')}${cell.docNo ? ' / ' + U.esc(cell.docNo) : ''}">${U.STATUS_SYMBOL[cell.status]}</td>`;
    }).join('');
    const total = cols.reduce((a, c) => { const cell = c.cells[i]; if (cell.enrolled && cell.status) a[cell.status] += 1; return a; }, { P: 0, X: 0, W: 0, E: 0 });
    return `<tr><td>${i + 1}</td><td class="name">${U.esc(st.school)}</td><td>${U.esc(st.no)}</td><td class="name"><b>${U.esc(st.name)}</b>${st.dropDate ? ` <span class="small muted">(취소 ${U.fmtShort(st.dropDate)})</span>` : ''}</td>${cells}<td>${total.P}</td><td>${total.X}</td><td>${total.W + total.E}</td></tr>`;
  }).join('');
  return `<table class="register"><thead><tr><th rowspan="2">번호</th><th rowspan="2" class="name">소속교</th><th rowspan="2">학번</th><th rowspan="2" class="name">이름</th>${head1}<th rowspan="2">출석</th><th rowspan="2">미인정</th><th rowspan="2">인정</th></tr><tr>${head2}</tr></thead><tbody>${body}</tbody></table>`;
}

async function exportXlsx(pre, subjects) {
  const warn = pre.filter((p) => p.unconfirmed || p.pending);
  const html = `<p>기존 출석부 양식(과목별 시트, 17차시 단위 표)으로 엑셀 파일을 만듭니다.</p>
    <div style="margin:8px 0">${subjects.map((s) => `<label class="inline" style="margin-right:12px"><input type="checkbox" name="sub" value="${s.id}" checked> ${U.esc(s.name)}</label>`).join('')}</div>
    ${warn.length ? `<div class="warn-list"><b>확인 필요</b>${warn.map((p) => `<div>· ${U.esc(p.subject)}: ${p.unconfirmed ? `미확인 수업 ${p.unconfirmed}건(빈칸으로 출력) ` : ''}${p.pending ? `공문 대기 ${p.pending}건(노란 ◎로 출력)` : ''}</div>`).join('')}</div>` : '<p class="small muted">미확인 수업이나 대기 건이 없습니다.</p>'}`;
  const ids = await U.modal({ title: '엑셀로 내보내기', html, buttons: [{ label: '취소', value: null }, { label: '파일 저장', cls: 'primary', value: (el) => [...el.querySelectorAll('input[name=sub]:checked')].map((i) => i.value) }] });
  if (!ids) return;
  if (!ids.length) { U.toast('과목을 하나 이상 선택하세요.', true); return; }
  try {
    const res = await U.api('export.xlsx', { subjectIds: ids });
    if (!res) return;
    const open = await U.modal({ title: '저장 완료', html: `<p>${U.esc(res.file)}</p>${U.warnListHtml(res.warnings)}`, buttons: [{ label: '닫기', value: false }, { label: '폴더 열기', value: 'folder' }, { label: '파일 열기', cls: 'primary', value: 'open' }] });
    if (open === 'open') U.api('shell.open', { target: res.file });
    if (open === 'folder') U.api('shell.showInFolder', { target: res.file });
  } catch (e) { U.toast(e.message, true); }
}
