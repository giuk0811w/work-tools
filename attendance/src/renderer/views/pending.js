"use strict";
/* global window, document, U, App */
window.Views = window.Views || {};

window.Views.pending = {
  async render(main) {
    const list = await U.api('pending.list');
    const st = App.state;
    const plans = st.semester.schoolEvents.filter((e) => !e.confirmed);
    // 같은 날짜·소속교·사유끼리 묶음
    const groups = [];
    for (const p of list) {
      const key = `${p.date}|${p.student.school}|${p.reason}`;
      let g = groups.find((x) => x.key === key);
      if (!g) { g = { key, date: p.date, school: p.student.school, reason: p.reason, items: [] }; groups.push(g); }
      g.items.push(p);
    }
    main.innerHTML = `
      <h1>인정결석 대기 목록 <span class="muted" style="font-size:15px;font-weight:400">공문을 확인했으면 체크하세요. 체크하는 즉시 인정결석으로 반영됩니다.</span></h1>
      ${plans.length ? `<div class="panel"><h3 style="margin-top:0">공문 미접수 사전 등록 <span class="small muted">항목 단위로 체크하면 그 항목에 딸린 대기 건이 모두 인정결석이 됩니다</span></h3>
        <table><thead><tr><th style="width:60px">공문 접수</th><th>기간</th><th>소속교</th><th>대상</th><th>사유</th></tr></thead><tbody>${plans.map((e) => `<tr><td class="center"><input type="checkbox" data-plan="${e.id}"></td><td class="nowrap">${U.fmt(e.date)}${e.to && e.to !== e.date ? ' ~ ' + U.fmt(e.to) : ''}</td><td>${U.esc(e.school)}</td><td>${e.names && e.names.length ? U.esc(e.names.join(', ')) : '학교 전체'}</td><td>${U.esc(e.reason)}</td></tr>`).join('')}</tbody></table></div>` : ''}
      ${list.length ? `<div class="panel">
        <div class="row between" style="margin-bottom:8px"><div class="small muted">모두 ${list.length}건. 묶음 제목의 체크박스로 한 번에 처리할 수 있습니다.</div><button class="btn small" id="undo-hint" hidden></button></div>
        <table><thead><tr><th style="width:60px">확인</th><th>날짜</th><th>과목</th><th>차시</th><th>소속교</th><th>학번</th><th>이름</th><th>사유</th><th style="width:90px"></th></tr></thead>
        <tbody>${groups.map((g, gi) => `
          <tr style="background:#f6f8fb"><td class="center"><input type="checkbox" data-group="${gi}" title="이 묶음 모두 확인"></td><td class="nowrap" colspan="8"><b>${U.fmt(g.date)}</b> · ${U.esc(g.school)}${g.reason ? ' · ' + U.esc(g.reason) : ''} <span class="muted small">(${g.items.length}건)</span></td></tr>
          ${g.items.map((p) => { const i = list.indexOf(p); return `<tr>
            <td class="center"><input type="checkbox" data-i="${i}"></td>
            <td class="nowrap">${U.fmt(p.date)}${p.future ? ' <span class="tag muted">예정</span>' : ''}</td><td>${U.esc(p.subjectName)}</td><td class="nowrap">${U.esc(p.seqLabel)}${p.periods.length && p.seqLabel.includes('~') && p.periods.length < 2 ? ` <span class="small muted">(${p.periods.join(',')}번째)</span>` : ''}</td>
            <td>${U.esc(p.student.school)}</td><td>${U.esc(p.student.no)}</td><td><b>${U.esc(p.student.name)}</b></td>
            <td class="small">${U.esc(p.reason)}${p.stored ? '' : ' <span class="tag muted">사전 등록</span>'}</td>
            <td><button class="btn small" data-i="${i}" data-act="P" title="대기를 취소하고 출석으로 되돌립니다">출석으로</button></td>
          </tr>`; }).join('')}`).join('')}</tbody></table>
      </div>` : '<div class="empty">대기 중인 인정결석이 없습니다.</div>'}`;
    const resolveMany = async (items, status) => {
      try { const n = await U.api('pending.resolveMany', { items: items.map((p) => ({ subjectId: p.subjectId, date: p.date, studentId: p.studentId })), status }); U.toast(status === 'E' ? `${n}건을 인정결석으로 반영했습니다.` : `${n}건을 출석으로 되돌렸습니다.`); App.go('pending'); } catch (e) { U.toast(e.message, true); App.go('pending'); }
    };
    main.querySelectorAll('input[data-i]').forEach((cb) => cb.addEventListener('change', () => { if (cb.checked) resolveMany([list[Number(cb.dataset.i)]], 'E'); }));
    main.querySelectorAll('input[data-group]').forEach((cb) => cb.addEventListener('change', () => { if (cb.checked) resolveMany(groups[Number(cb.dataset.group)].items, 'E'); }));
    main.querySelectorAll('button[data-act="P"]').forEach((b) => b.addEventListener('click', () => resolveMany([list[Number(b.dataset.i)]], 'P')));
    main.querySelectorAll('input[data-plan]').forEach((cb) => cb.addEventListener('change', async () => {
      if (!cb.checked) return;
      try { const r = await U.api('plan.confirm', { id: cb.dataset.plan, confirmed: true }); U.toast(`공문 접수로 표시했습니다.${r.changed ? ` 저장된 대기 ${r.changed}건도 인정결석으로 바꿨습니다.` : ''}`); App.go('pending'); } catch (e) { U.toast(e.message, true); }
    }));
  },
};
