'use strict';
/* global window, document, U, App */
window.Views = window.Views || {};

window.Views.pending = {
  async render(main) {
    const list = await U.api('pending.list');
    main.innerHTML = `
      <h1>인정결석 대기 목록 <span class="muted" style="font-size:15px;font-weight:400">공문 접수 확인 후 확정하세요</span></h1>
      ${list.length ? `<div class="panel"><table>
        <thead><tr><th>날짜</th><th>과목</th><th>차시</th><th>소속교</th><th>학번</th><th>이름</th><th>사유</th><th style="width:150px">공문번호</th><th style="width:140px">접수일</th><th style="width:250px">처리</th></tr></thead>
        <tbody>${list.map((p, i) => `<tr>
          <td class="nowrap">${U.fmt(p.date)}</td><td>${U.esc(p.subjectName)}</td><td>${U.esc(p.seqLabel)}${p.periods.length && p.periods.length < 2 && p.seqLabel.includes('~') ? ` <span class="small muted">(${p.periods.join(',')}번째)</span>` : ''}${p.confirmed ? '' : ' <span class="tag muted">미확정</span>'}</td>
          <td>${U.esc(p.student.school)}</td><td>${U.esc(p.student.no)}</td><td><b>${U.esc(p.student.name)}</b></td>
          <td><input type="text" data-i="${i}" data-f="reason" value="${U.esc(p.reason)}" style="width:100%"></td>
          <td><input type="text" data-i="${i}" data-f="docNo" value="${U.esc(p.docNo)}" placeholder="공문번호" style="width:100%"></td>
          <td><input type="date" data-i="${i}" data-f="docDate" value="${U.esc(p.docDate)}"></td>
          <td><button class="btn small primary" data-i="${i}" data-act="E">공문 접수 → 확정</button> <button class="btn small" data-i="${i}" data-act="P">출석으로</button> <button class="btn small danger" data-i="${i}" data-act="X">미인정</button></td>
        </tr>`).join('')}</tbody></table>
        <div class="row" style="margin-top:10px"><button class="btn" id="confirm-all">공문번호가 입력된 건 모두 확정</button><span class="small muted">같은 학교·같은 날짜의 여러 건은 공문 하나로 처리되는 경우가 많으니 공문번호를 채운 뒤 한 번에 확정하세요.</span></div>
      </div>` : '<div class="empty">대기 중인 인정결석이 없습니다.</div>'}`;
    const vals = list.map((p) => ({ reason: p.reason, docNo: p.docNo, docDate: p.docDate }));
    main.querySelectorAll('input[data-f]').forEach((inp) => inp.addEventListener('input', () => { vals[Number(inp.dataset.i)][inp.dataset.f] = inp.value; }));
    const resolve = async (i, status) => {
      const p = list[i]; const v = vals[i];
      if (status === 'X' && !(await U.confirm('미인정결석 처리', `${U.esc(p.student.name)} 학생의 ${U.fmt(p.date)} ${U.esc(p.subjectName)} 대기 건을 미인정결석으로 바꿉니다.`, { danger: true }))) return;
      await U.api('pending.resolve', { subjectId: p.subjectId, date: p.date, studentId: p.studentId, status, docNo: v.docNo, docDate: v.docDate, reason: v.reason });
    };
    main.querySelectorAll('button[data-act]').forEach((b) => b.addEventListener('click', async () => {
      try { await resolve(Number(b.dataset.i), b.dataset.act); U.toast('처리했습니다.'); App.go('pending'); } catch (e) { U.toast(e.message, true); }
    }));
    const ca = main.querySelector('#confirm-all');
    if (ca) ca.addEventListener('click', async () => {
      const targets = list.map((p, i) => i).filter((i) => vals[i].docNo && vals[i].docNo.trim());
      if (!targets.length) { U.toast('공문번호가 입력된 건이 없습니다.', true); return; }
      if (!(await U.confirm('일괄 확정', `${targets.length}건을 인정결석으로 확정합니다.`))) return;
      for (const i of targets) await resolve(i, 'E');
      U.toast(`${targets.length}건 확정했습니다.`); App.go('pending');
    });
  },
};
