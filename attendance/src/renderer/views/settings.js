'use strict';
/* global window, document, U, App */
window.Views = window.Views || {};

const TABS = [['semester', '학기·가져오기'], ['subjects', '과목·시간표'], ['students', '수강생 명단'], ['calendar', '학사일정'], ['data', '데이터·백업'], ['app', '앱 설정']];

window.Views.settings = {
  async render(main, params) {
    const tab = params.tab || 'semester';
    main.innerHTML = `<h1>설정</h1><div class="tabs">${TABS.map(([k, l]) => `<button data-tab="${k}" class="${k === tab ? 'active' : ''}">${l}</button>`).join('')}</div><div id="tab-body"></div>`;
    main.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => App.go('settings', { tab: b.dataset.tab })));
    const body = main.querySelector('#tab-body');
    await SettingsTabs[tab](body, params);
  },
};

const go = (tab, extra = {}) => App.go('settings', { tab, ...extra });
const sem = () => App.state.semester;

const SettingsTabs = {
  // ---------- 학기 ----------
  async semester(body) {
    const st = App.state;
    const tpl = st.semester ? await U.api('registerTemplate.info') : null;
    body.innerHTML = `
      <div class="grid-2">
        <div class="panel">
          <h2 style="margin-top:0">현재 학기</h2>
          ${st.semester ? `<div class="kv">
            <label>학기명</label><input type="text" id="sem-name" value="${U.esc(st.semester.name)}">
            <label>시작일</label><input type="date" id="sem-start" value="${st.semester.start}">
            <label>종료일</label><input type="date" id="sem-end" value="${st.semester.end}">
            <label>학교명(제목)</label><input type="text" id="sem-school" value="${U.esc(st.semester.school)}">
          </div><div class="row" style="margin-top:10px"><button class="btn primary" id="sem-save">저장</button><span class="small muted">종료일 이후에는 시간표 수업이 만들어지지 않습니다.</span></div>` : '<div class="muted">학기가 없습니다.</div>'}
          <h3>학기 목록</h3>
          <table><thead><tr><th>학기</th><th>기간</th><th>과목</th><th></th></tr></thead><tbody>${st.semesters.map((s) => `<tr><td>${U.esc(s.name)} ${s.id === st.currentSemesterId ? '<span class="tag info">현재</span>' : ''}</td><td>${s.start} ~ ${s.end}</td><td>${s.subjectCount}</td><td>${s.id === st.currentSemesterId ? '' : `<button class="btn small" data-select="${s.id}">이 학기로 전환</button>`} <button class="btn small danger" data-del="${s.id}">삭제</button></td></tr>`).join('') || '<tr><td colspan="4" class="muted">없음</td></tr>'}</tbody></table>
          <div class="row" style="margin-top:10px"><button class="btn" id="sem-new">새 학기 시작</button><span class="small muted">지난 학기 기록은 그대로 보관되며 학기 목록에서 전환해 열람할 수 있습니다.</span></div>
        </div>
        <div>
          <div class="panel">
            <h2 style="margin-top:0">설정 양식으로 셋팅</h2>
            <p class="small muted">과목, 요일·시간, 수강생 명단, 휴업일, 인정결석 사전 등록을 엑셀 양식에 적어 올리면 한 번에 반영됩니다. 양식에는 현재 설정이 미리 채워져 있습니다. 매 학기 이 방법으로 셋팅합니다.</p>
            <div class="row"><button class="btn" id="tpl-download">양식 내려받기</button><button class="btn primary" id="tpl-upload">작성한 양식 업로드…</button></div>
          </div>
          ${tpl ? `<div class="panel">
            <h2 style="margin-top:0">출석부 출력 양식</h2>
            <p class="small muted">엑셀로 내보낼 때 쓰는 출석부 서식입니다. 학기마다 서식이 바뀌면 새 서식 파일을 올려 주세요. 파일에 시트가 여러 개면 "양식" 시트를, 없으면 첫 시트를 서식으로 씁니다. 표의 첫 열 제목이 "연번", 차시 열 제목이 "1차시, 2차시…" 형태여야 합니다.</p>
            <div class="kv"><label>현재 양식</label><div>${tpl.custom ? `<b>${U.esc(tpl.name)}</b> <span class="small muted">(${U.esc(tpl.sheet)} 시트, ${U.esc(tpl.summary)}, ${new Date(tpl.uploadedAt).toLocaleDateString('ko-KR')} 업로드)</span>` : '기본 양식 <span class="small muted">(앱에 내장된 강원온라인학교 서식)</span>'}${tpl.missing ? ' <span class="tag danger">업로드한 파일을 찾을 수 없어 기본 양식을 씁니다</span>' : ''}</div></div>
            <div class="row" style="margin-top:10px"><button class="btn primary" id="rt-upload">양식 파일 업로드…</button><button class="btn" id="rt-download">현재 양식 내려받기</button>${tpl.custom ? '<button class="btn danger" id="rt-reset">기본 양식으로 되돌리기</button>' : ''}</div>
          </div>` : ''}
          <div class="panel">
            <h2 style="margin-top:0">기존 엑셀 출석부에서 기록 가져오기 <span class="tag muted">이번 학기 한정</span></h2>
            <p class="small muted">앱 도입 전에 엑셀로 적어 둔 이번 학기 기록을 옮길 때 한 번만 씁니다. 과목별 시트에서 명단과 지금까지의 출결을 읽어 새 학기로 가져옵니다. 지난 수업은 확정으로, 미래 날짜의 ◎는 대기로 들어옵니다.</p>
            <button class="btn" id="import-pick">엑셀 파일 선택…</button>
          </div>
        </div>
      </div>`;
    const q = (s) => body.querySelector(s);
    if (q('#sem-save')) q('#sem-save').addEventListener('click', async () => { try { await U.api('semester.update', { id: st.semester.id, name: U.val(body, '#sem-name'), start: U.val(body, '#sem-start'), end: U.val(body, '#sem-end'), school: U.val(body, '#sem-school') }); U.toast('저장했습니다.'); go('semester'); } catch (e) { U.toast(e.message, true); } });
    body.querySelectorAll('[data-select]').forEach((b) => b.addEventListener('click', async () => { await U.api('semester.select', { id: b.dataset.select }); go('semester'); }));
    body.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      const s = st.semesters.find((x) => x.id === b.dataset.del);
      if (await U.confirm('학기 삭제', `<p><b>${U.esc(s.name)}</b> 학기와 그 출결 기록을 모두 삭제합니다.</p><p class="small muted">삭제 전에 백업 파일이 자동으로 만들어집니다.</p>`, { okLabel: '삭제', danger: true })) { await U.api('semester.delete', { id: s.id }); go('semester'); }
    }));
    q('#sem-new').addEventListener('click', () => newSemesterDialog());
    q('#import-pick').addEventListener('click', () => importDialog());
    q('#tpl-download').addEventListener('click', async () => { try { const f = await U.api('template.download'); if (f) { const r = await U.modal({ title: '양식 저장 완료', html: `<p>${U.esc(f)}</p><p class="small muted">엑셀에서 열어 작성한 뒤 "작성한 양식 업로드"로 올려 주세요.</p>`, buttons: [{ label: '닫기', value: false }, { label: '파일 열기', cls: 'primary', value: true }] }); if (r) U.api('shell.open', { target: f }); } } catch (e) { U.toast(e.message, true); } });
    q('#tpl-upload').addEventListener('click', () => templateDialog());
    if (q('#rt-upload')) q('#rt-upload').addEventListener('click', async () => { try { const r = await U.api('registerTemplate.pick'); if (r) { U.toast(`출석부 양식을 바꿨습니다: ${r.summary}`, false, 4000); go('semester'); } } catch (e) { U.alert('양식 업로드 실패', `<p>${U.esc(e.message)}</p>`); } });
    if (q('#rt-download')) q('#rt-download').addEventListener('click', async () => { try { const f = await U.api('registerTemplate.download'); if (f) U.toast(`저장했습니다: ${f}`, false, 4000); } catch (e) { U.toast(e.message, true); } });
    if (q('#rt-reset')) q('#rt-reset').addEventListener('click', async () => { if (await U.confirm('기본 양식으로 되돌리기', '업로드한 출석부 양식을 지우고 앱에 내장된 기본 양식을 씁니다.', { danger: true })) { await U.api('registerTemplate.reset'); go('semester'); } });
  },

  // ---------- 과목 ----------
  async subjects(body, params) {
    const s = sem();
    body.innerHTML = `<div class="row between"><div class="small muted">과목을 누르면 시간표를 편집할 수 있습니다. 회차(차시) 번호는 실제 수업일 순서로 자동 계산됩니다.</div><button class="btn primary" id="sub-add">과목 추가</button></div>
      <div class="panel" style="margin-top:10px"><table><thead><tr><th>순서</th><th>과목명</th><th>학점</th><th>담당교사</th><th>주간 시간표</th><th>학생</th><th>시간표 적용 시작일</th><th></th></tr></thead>
      <tbody>${s.subjects.map((sub, i) => `<tr><td class="center"><button class="btn small" data-move="-1" data-id="${sub.id}">▲</button><button class="btn small" data-move="1" data-id="${sub.id}">▼</button></td><td><b>${U.esc(sub.name)}</b></td><td>${sub.credits ?? ''}</td><td>${U.esc(sub.teacher)}</td><td>${sub.schedule.length ? sub.schedule.map((e) => `${U.dowKo(e.dow)} ${e.start || ''}${e.end ? '~' + e.end : ''} ${e.periods}차시`).join('<br>') : '<span class="tag danger">미설정</span>'}</td><td>${sub.students.length}명</td><td>${sub.scheduleFrom || '<span class="muted">학기 시작일</span>'}</td><td><button class="btn small" data-edit="${sub.id}">편집</button> <button class="btn small danger" data-del="${sub.id}">삭제</button></td></tr>`).join('') || '<tr><td colspan="8" class="muted">과목이 없습니다.</td></tr>'}</tbody></table></div>`;
    body.querySelector('#sub-add').addEventListener('click', () => subjectDialog(null));
    body.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => subjectDialog(s.subjects.find((x) => x.id === b.dataset.edit))));
    body.querySelectorAll('[data-move]').forEach((b) => b.addEventListener('click', async () => { await U.api('subject.move', { id: b.dataset.id, dir: Number(b.dataset.move) }); go('subjects'); }));
    body.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      const sub = s.subjects.find((x) => x.id === b.dataset.del);
      if (await U.confirm('과목 삭제', `<p><b>${U.esc(sub.name)}</b> 과목과 출결 기록을 삭제합니다.</p>`, { okLabel: '삭제', danger: true })) { await U.api('subject.delete', { id: sub.id }); go('subjects'); }
    }));
    if (params.editId) subjectDialog(s.subjects.find((x) => x.id === params.editId));
  },

  // ---------- 학생 ----------
  async students(body, params) {
    const s = sem();
    if (!s.subjects.length) { body.innerHTML = '<div class="empty">먼저 과목을 추가하세요.</div>'; return; }
    const subjectId = params.subjectId || s.subjects[0].id;
    const sub = s.subjects.find((x) => x.id === subjectId) || s.subjects[0];
    body.innerHTML = `<div class="tabs">${s.subjects.map((x) => `<button data-id="${x.id}" class="${x.id === sub.id ? 'active' : ''}">${U.esc(x.name)} (${x.students.length})</button>`).join('')}</div>
      <div class="row between"><div class="small muted">중간에 수강을 취소한 학생은 삭제하지 말고 수강취소일을 적어 두면 그 이후 수업에서 제외됩니다.</div><button class="btn primary" id="st-add">학생 추가</button></div>
      <div class="panel" style="margin-top:10px"><table><thead><tr><th style="width:80px">순서</th><th>소속교</th><th>학번</th><th>이름</th><th>수강취소일</th><th></th></tr></thead><tbody>
      ${sub.students.map((st) => `<tr class="${st.dropDate ? 'disabled' : ''}"><td><button class="btn small" data-move="-1" data-id="${st.id}">▲</button><button class="btn small" data-move="1" data-id="${st.id}">▼</button></td><td>${U.esc(st.school)}</td><td>${U.esc(st.no)}</td><td><b>${U.esc(st.name)}</b></td><td>${st.dropDate || ''}</td><td><button class="btn small" data-edit="${st.id}">편집</button> <button class="btn small danger" data-del="${st.id}">삭제</button></td></tr>`).join('') || '<tr><td colspan="6" class="muted">학생이 없습니다.</td></tr>'}
      </tbody></table></div>`;
    body.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => go('students', { subjectId: b.dataset.id })));
    const dialog = (st) => U.modal({
      title: st ? '학생 편집' : '학생 추가',
      html: `<div class="kv"><label>소속교</label><input type="text" id="f-school" value="${U.esc(st ? st.school : '')}" placeholder="○○고등학교"><label>학번</label><input type="text" id="f-no" value="${U.esc(st ? st.no : '')}"><label>이름</label><input type="text" id="f-name" value="${U.esc(st ? st.name : '')}"><label>수강취소일</label><input type="date" id="f-drop" value="${st && st.dropDate ? st.dropDate : ''}"></div>`,
      buttons: [{ label: '취소', value: null }, { label: '저장', cls: 'primary', value: (el) => ({ school: U.val(el, '#f-school'), no: U.val(el, '#f-no'), name: U.val(el, '#f-name'), dropDate: U.val(el, '#f-drop') || null }) }],
    }).then(async (v) => { if (!v) return; try { await U.api('student.save', { subjectId: sub.id, id: st ? st.id : null, ...v }); go('students', { subjectId: sub.id }); } catch (e) { U.toast(e.message, true); } });
    body.querySelector('#st-add').addEventListener('click', () => dialog(null));
    body.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => dialog(sub.students.find((x) => x.id === b.dataset.edit))));
    body.querySelectorAll('[data-move]').forEach((b) => b.addEventListener('click', async () => { await U.api('student.move', { subjectId: sub.id, id: b.dataset.id, dir: Number(b.dataset.move) }); go('students', { subjectId: sub.id }); }));
    body.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      const st = sub.students.find((x) => x.id === b.dataset.del);
      if (await U.confirm('학생 삭제', `<p><b>${U.esc(st.name)}</b> 학생과 이 과목의 출결 기록을 삭제합니다.</p><p class="small muted">수강 취소라면 삭제 대신 편집에서 수강취소일을 적어 주세요.</p>`, { okLabel: '삭제', danger: true })) { await U.api('student.delete', { subjectId: sub.id, id: st.id }); go('students', { subjectId: sub.id }); }
    }));
  },

  // ---------- 학사일정 ----------
  async calendar(body) {
    const s = sem();
    const subjName = (id) => (s.subjects.find((x) => x.id === id) || {}).name || '';
    const schools = await U.api('schools.list');
    const extras = s.subjects.flatMap((sub) => sub.extras.filter((x) => x.source !== 'import').map((x) => ({ ...x, subjectId: sub.id, subjectName: sub.name })));
    const cancels = s.subjects.flatMap((sub) => sub.cancels.map((x) => ({ ...x, subjectId: sub.id, subjectName: sub.name })));
    const imported = s.subjects.flatMap((sub) => sub.extras.filter((x) => x.source === 'import').map((x) => ({ ...x, subjectId: sub.id, subjectName: sub.name })));
    body.innerHTML = `<div class="grid-2">
      <div class="panel"><div class="row between"><h2 style="margin:0">휴업일 (수업 없음)</h2><button class="btn small primary" id="hol-add">추가</button></div>
        <p class="small muted">공휴일, 재량휴업일 등. 휴업일은 회차 번호를 차지하지 않습니다.</p>
        <table><thead><tr><th>날짜</th><th>사유</th><th>적용</th><th></th></tr></thead><tbody>${s.holidays.map((h) => `<tr><td>${U.fmt(h.date)}</td><td>${U.esc(h.reason)}</td><td>${h.subjectIds ? h.subjectIds.map(subjName).join(', ') : '전체'}</td><td><button class="btn small" data-hol-edit="${h.id}">편집</button> <button class="btn small danger" data-hol-del="${h.id}">삭제</button></td></tr>`).join('') || '<tr><td colspan="4" class="muted">없음</td></tr>'}</tbody></table></div>
      <div class="panel"><div class="row between"><h2 style="margin:0">인정결석 사전 등록 (소속교 행사·공문)</h2><button class="btn small primary" id="ev-add">추가</button></div>
        <p class="small muted">소속교 시험·학력평가·체험학습 같은 학교 전체 행사, 또는 공문으로 미리 받은 개별 학생의 결석 기간을 등록합니다. 기간 안의 수업(미래 포함)에서 해당 학생은 인정결석으로 미리 표시됩니다. 공문 접수에 체크하면 바로 인정결석, 체크하지 않으면 인정결석(대기)입니다.</p>
        <table><thead><tr><th>기간</th><th>소속교</th><th>대상</th><th>사유</th><th class="center">공문 접수</th><th></th></tr></thead><tbody>${s.schoolEvents.map((e) => `<tr><td class="nowrap">${U.fmt(e.date)}${e.to && e.to !== e.date ? '<br>~ ' + U.fmt(e.to) : ''}</td><td>${U.esc(e.school)}</td><td>${e.names && e.names.length ? U.esc(e.names.join(', ')) : '<span class="muted">학교 전체</span>'}</td><td>${U.esc(e.reason)}</td><td class="center"><input type="checkbox" data-ev-confirm="${e.id}" ${e.confirmed ? 'checked' : ''}></td><td><button class="btn small" data-ev-edit="${e.id}">편집</button> <button class="btn small danger" data-ev-del="${e.id}">삭제</button></td></tr>`).join('') || '<tr><td colspan="6" class="muted">없음</td></tr>'}</tbody></table></div>
      <div class="panel"><div class="row between"><h2 style="margin:0">보강·추가 수업</h2><button class="btn small primary" id="ex-add">추가</button></div>
        <p class="small muted">정규 요일 외의 수업. 같은 날짜에 정규 수업이 있으면 보강 내용으로 대체됩니다.</p>
        <table><thead><tr><th>날짜</th><th>과목</th><th>차시</th><th>시간</th><th>사유</th><th></th></tr></thead><tbody>${extras.map((x) => `<tr><td>${U.fmt(x.date)}</td><td>${U.esc(x.subjectName)}</td><td>${x.periods}</td><td>${x.start || ''}${x.end ? '~' + x.end : ''}</td><td>${U.esc(x.reason)}</td><td><button class="btn small danger" data-ex-del="${x.subjectId}|${x.date}">삭제</button></td></tr>`).join('') || '<tr><td colspan="6" class="muted">없음</td></tr>'}</tbody></table></div>
      <div class="panel"><div class="row between"><h2 style="margin:0">과목별 휴강</h2><button class="btn small primary" id="cn-add">추가</button></div>
        <p class="small muted">특정 과목만 수업이 없는 날 (출장 등).</p>
        <table><thead><tr><th>날짜</th><th>과목</th><th>사유</th><th></th></tr></thead><tbody>${cancels.map((x) => `<tr><td>${U.fmt(x.date)}</td><td>${U.esc(x.subjectName)}</td><td>${U.esc(x.reason)}</td><td><button class="btn small danger" data-cn-del="${x.subjectId}|${x.date}">삭제</button></td></tr>`).join('') || '<tr><td colspan="4" class="muted">없음</td></tr>'}</tbody></table></div>
    </div>
    ${imported.length ? `<div class="panel"><h2 style="margin-top:0">엑셀에서 가져온 수업일 <span class="small muted">(${imported.length}건)</span></h2><p class="small muted">가져온 날짜는 시간표와 별개로 고정되어 있습니다. 잘못 들어온 날짜는 여기서 삭제하세요. 삭제하면 그 날의 기록도 함께 사라집니다.</p><div style="max-height:220px;overflow:auto"><table><thead><tr><th>과목</th><th>날짜</th><th>차시</th><th></th></tr></thead><tbody>${imported.map((x) => `<tr><td>${U.esc(x.subjectName)}</td><td>${U.fmt(x.date)}</td><td>${x.periods}</td><td><button class="btn small danger" data-ex-del="${x.subjectId}|${x.date}">삭제</button></td></tr>`).join('')}</tbody></table></div></div>` : ''}`;
    const subjOptions = (sel) => s.subjects.map((x) => `<option value="${x.id}" ${sel === x.id ? 'selected' : ''}>${U.esc(x.name)}</option>`).join('');
    const holDialog = (h) => U.modal({ title: h ? '휴업일 편집' : '휴업일 추가', html: `<div class="kv"><label>날짜</label><input type="date" id="f-date" value="${h ? h.date : ''}"><label>사유</label><input type="text" id="f-reason" value="${U.esc(h ? h.reason : '')}" placeholder="예: 개천절, 재량휴업일"><label>적용 과목</label><div>${s.subjects.map((x) => `<label class="inline" style="margin-right:10px"><input type="checkbox" name="subs" value="${x.id}" ${h && h.subjectIds && h.subjectIds.includes(x.id) ? 'checked' : ''}> ${U.esc(x.name)}</label>`).join('')}<div class="small muted">아무것도 고르지 않으면 전체 과목에 적용</div></div></div>`, buttons: [{ label: '취소', value: null }, { label: '저장', cls: 'primary', value: (el) => ({ date: U.val(el, '#f-date'), reason: U.val(el, '#f-reason'), subjectIds: [...el.querySelectorAll('input[name=subs]:checked')].map((i) => i.value) }) }] })
      .then(async (v) => { if (!v) return; try { await U.api('holiday.save', { id: h ? h.id : null, ...v }); go('calendar'); } catch (e) { U.toast(e.message, true); } });
    const studentsBySchool = await U.api('students.bySchool');
    const evDialog = (e) => U.modal({
      title: e ? '인정결석 사전 등록 편집' : '인정결석 사전 등록', width: 640,
      html: `<div class="kv"><label>소속교</label><input type="text" id="f-school" list="school-list" value="${U.esc(e ? e.school : '')}"><datalist id="school-list">${schools.map((x) => `<option value="${U.esc(x)}">`).join('')}</datalist>
        <label>기간</label><div><input type="date" id="f-date" value="${e ? e.date : ''}"> ~ <input type="date" id="f-to" value="${e && e.to && e.to !== e.date ? e.to : ''}"> <span class="small muted">종료일을 비우면 하루</span></div>
        <label>대상 학생</label><div><label class="inline"><input type="radio" name="scope" value="all" ${!e || !(e.names && e.names.length) ? 'checked' : ''}> 학교 전체</label> <label class="inline" style="margin-left:10px"><input type="radio" name="scope" value="some" ${e && e.names && e.names.length ? 'checked' : ''}> 선택한 학생만</label><div id="f-names" style="margin-top:6px;${e && e.names && e.names.length ? '' : 'display:none'}"></div></div>
        <label>사유</label><input type="text" id="f-reason" value="${U.esc(e ? e.reason : '')}" placeholder="예: 1회고사, 전국연합학력평가, 병원 진료">
        <label>공문 접수</label><label class="inline"><input type="checkbox" id="f-confirmed" ${e && e.confirmed ? 'checked' : ''}> 공문을 받았음 (체크하면 바로 인정결석, 아니면 대기)</label></div>`,
      onOpen(el) {
        const namesBox = el.querySelector('#f-names'); const schoolInput = el.querySelector('#f-school');
        const selected = new Set(e && e.names ? e.names : []);
        const renderNames = () => {
          const list = studentsBySchool[schoolInput.value.trim()] || [];
          namesBox.innerHTML = list.length ? list.map((st) => `<label class="inline" style="margin:2px 10px 2px 0"><input type="checkbox" name="nm" value="${U.esc(st.name)}" ${selected.has(st.name) ? 'checked' : ''}> ${U.esc(st.name)} <span class="small muted">${U.esc(st.no)}</span></label>`).join('') + '<div class="small muted">명단에 없는 이름은 아래에 쉼표로 적을 수 있습니다.</div>' : '<div class="small muted">이 소속교의 학생이 명단에 없습니다. 이름을 아래에 쉼표로 적어 주세요.</div>';
          namesBox.insertAdjacentHTML('beforeend', `<input type="text" id="f-extra-names" placeholder="추가 이름 (쉼표 구분)" value="${U.esc([...selected].filter((n) => !list.some((st) => st.name === n)).join(', '))}" style="width:100%;margin-top:4px">`);
          namesBox.querySelectorAll('input[name=nm]').forEach((cb) => cb.addEventListener('change', () => { if (cb.checked) selected.add(cb.value); else selected.delete(cb.value); }));
        };
        renderNames();
        schoolInput.addEventListener('change', renderNames);
        el.querySelectorAll('input[name=scope]').forEach((r) => r.addEventListener('change', () => { namesBox.style.display = el.querySelector('input[name=scope]:checked').value === 'some' ? '' : 'none'; }));
      },
      buttons: [{ label: '취소', value: null }, { label: '저장', cls: 'primary', value: (el) => {
        const some = el.querySelector('input[name=scope]:checked').value === 'some';
        const names = some ? [...el.querySelectorAll('input[name=nm]:checked')].map((i) => i.value).concat(U.val(el, '#f-extra-names').split(/[,，、]/).map((x) => x.trim()).filter(Boolean)) : [];
        return { school: U.val(el, '#f-school'), date: U.val(el, '#f-date'), to: U.val(el, '#f-to') || null, names, reason: U.val(el, '#f-reason'), confirmed: el.querySelector('#f-confirmed').checked };
      } }],
    }).then(async (v) => { if (!v) return; try { await U.api('event.save', { id: e ? e.id : null, ...v }); go('calendar'); } catch (er) { U.toast(er.message, true); } });
    const exDialog = () => U.modal({ title: '보강·추가 수업', html: `<div class="kv"><label>과목</label><select id="f-sub">${subjOptions()}</select><label>날짜</label><input type="date" id="f-date"><label>차시 수</label><input type="number" id="f-periods" value="1" min="1"><label>시간</label><div><input type="time" id="f-start"> ~ <input type="time" id="f-end"></div><label>사유</label><input type="text" id="f-reason" placeholder="예: 대체휴일 보강"></div>`, buttons: [{ label: '취소', value: null }, { label: '저장', cls: 'primary', value: (el) => ({ subjectId: U.val(el, '#f-sub'), date: U.val(el, '#f-date'), periods: U.val(el, '#f-periods'), start: U.val(el, '#f-start'), end: U.val(el, '#f-end'), reason: U.val(el, '#f-reason') }) }] })
      .then(async (v) => { if (!v) return; try { await U.api('extra.save', v); go('calendar'); } catch (e) { U.toast(e.message, true); } });
    const cnDialog = () => U.modal({ title: '과목별 휴강', html: `<div class="kv"><label>과목</label><select id="f-sub">${subjOptions()}</select><label>날짜</label><input type="date" id="f-date"><label>사유</label><input type="text" id="f-reason"></div>`, buttons: [{ label: '취소', value: null }, { label: '저장', cls: 'primary', value: (el) => ({ subjectId: U.val(el, '#f-sub'), date: U.val(el, '#f-date'), reason: U.val(el, '#f-reason') }) }] })
      .then(async (v) => { if (!v) return; try { await U.api('cancel.save', v); go('calendar'); } catch (e) { U.toast(e.message, true); } });
    body.querySelector('#hol-add').addEventListener('click', () => holDialog(null));
    body.querySelector('#ev-add').addEventListener('click', () => evDialog(null));
    body.querySelector('#ex-add').addEventListener('click', exDialog);
    body.querySelector('#cn-add').addEventListener('click', cnDialog);
    body.querySelectorAll('[data-hol-edit]').forEach((b) => b.addEventListener('click', () => holDialog(s.holidays.find((x) => x.id === b.dataset.holEdit))));
    body.querySelectorAll('[data-hol-del]').forEach((b) => b.addEventListener('click', async () => { await U.api('holiday.delete', { id: b.dataset.holDel }); go('calendar'); }));
    body.querySelectorAll('[data-ev-edit]').forEach((b) => b.addEventListener('click', () => evDialog(s.schoolEvents.find((x) => x.id === b.dataset.evEdit))));
    body.querySelectorAll('[data-ev-del]').forEach((b) => b.addEventListener('click', async () => { await U.api('event.delete', { id: b.dataset.evDel }); go('calendar'); }));
    body.querySelectorAll('[data-ev-confirm]').forEach((cb) => cb.addEventListener('change', async () => { try { const r = await U.api('plan.confirm', { id: cb.dataset.evConfirm, confirmed: cb.checked }); U.toast(cb.checked ? `공문 접수로 표시했습니다.${r.changed ? ` 저장된 대기 ${r.changed}건도 인정결석으로 바꿨습니다.` : ''}` : '공문 미접수(대기)로 표시했습니다.'); } catch (e) { U.toast(e.message, true); } }));
    body.querySelectorAll('[data-ex-del]').forEach((b) => b.addEventListener('click', async () => { const [subjectId, date] = b.dataset.exDel.split('|'); if (await U.confirm('수업일 삭제', `${U.fmt(date)} 수업을 목록에서 지웁니다. 그 날의 출결 기록도 삭제됩니다.`, { danger: true, okLabel: '삭제' })) { await U.api('extra.delete', { subjectId, date }); go('calendar'); } }));
    body.querySelectorAll('[data-cn-del]').forEach((b) => b.addEventListener('click', async () => { const [subjectId, date] = b.dataset.cnDel.split('|'); await U.api('cancel.delete', { subjectId, date }); go('calendar'); }));
  },

  // ---------- 데이터 ----------
  async data(body) {
    const info = await U.api('app.info');
    body.innerHTML = `<div class="grid-2">
      <div class="panel"><h2 style="margin-top:0">데이터 파일</h2>
        <div class="kv"><label>데이터 폴더</label><div>${U.esc(info.dataDir)} <button class="btn small" id="open-dir">폴더 열기</button></div><label>파일</label><div>${U.esc(info.dataFile)}</div><label>마지막 백업</label><div>${info.lastBackupAt ? new Date(info.lastBackupAt).toLocaleString('ko-KR') : '없음'}</div></div>
        <p class="small muted">앱을 켤 때마다 하루 한 번 자동 백업하고 최근 30개를 보관합니다. 다른 PC와 함께 쓰려면 데이터 폴더를 OneDrive 같은 동기화 폴더로 바꾸세요. 두 PC에서 동시에 열면 나중에 저장한 쪽이 남습니다.</p>
        <div class="row"><button class="btn" id="change-dir">데이터 폴더 변경…</button><button class="btn" id="backup-now">지금 백업</button><button class="btn" id="export-json">데이터 파일 내보내기…</button></div>
      </div>
      <div class="panel"><h2 style="margin-top:0">백업에서 복원</h2>
        <div style="max-height:260px;overflow:auto"><table><thead><tr><th>백업 파일</th><th>시각</th><th></th></tr></thead><tbody>${info.backups.map((b) => `<tr><td class="small">${U.esc(b.name)}</td><td class="small">${new Date(b.mtime).toLocaleString('ko-KR')}</td><td><button class="btn small" data-restore="${U.esc(b.path)}">복원</button></td></tr>`).join('') || '<tr><td colspan="3" class="muted">백업 없음</td></tr>'}</tbody></table></div>
        <div class="row" style="margin-top:10px"><button class="btn" id="restore-file">다른 파일에서 복원…</button></div>
      </div>
    </div>
    <div class="panel"><h2 style="margin-top:0">전체 초기화</h2><p class="small muted">모든 학기와 기록을 지우고 처음 상태로 돌립니다. 새 학기를 시작하려면 초기화 대신 [학기·가져오기]의 "새 학기 시작"을 쓰세요. 초기화 전에 백업이 자동 저장됩니다.</p><button class="btn danger" id="reset-all">전체 초기화…</button></div>`;
    body.querySelector('#open-dir').addEventListener('click', () => U.api('shell.open', { target: info.dataDir }));
    body.querySelector('#change-dir').addEventListener('click', async () => { try { const r = await U.api('data.changeDir'); if (r) { U.toast(`데이터 폴더를 옮겼습니다: ${r.to}`, false, 4000); go('data'); } } catch (e) { U.toast(e.message, true); } });
    body.querySelector('#backup-now').addEventListener('click', async () => { const f = await U.api('data.backupNow'); U.toast(f ? `백업했습니다: ${f}` : '백업할 데이터가 없습니다.', !f, 4000); go('data'); });
    body.querySelector('#export-json').addEventListener('click', async () => { const f = await U.api('data.exportJson'); if (f) U.toast(`저장했습니다: ${f}`, false, 4000); });
    const restore = async (file) => { if (await U.confirm('복원', `<p>현재 데이터를 이 백업으로 되돌립니다.</p><p class="small">${U.esc(file || '파일을 선택합니다')}</p><p class="small muted">복원 전 현재 상태도 백업됩니다.</p>`, { danger: true, okLabel: '복원' })) { try { const r = await U.api('data.restore', { file }); if (r) { U.toast('복원했습니다.'); go('data'); } } catch (e) { U.toast(e.message, true); } } };
    body.querySelectorAll('[data-restore]').forEach((b) => b.addEventListener('click', () => restore(b.dataset.restore)));
    body.querySelector('#restore-file').addEventListener('click', () => restore(null));
    body.querySelector('#reset-all').addEventListener('click', async () => {
      const typed = await U.modal({ title: '전체 초기화', html: '<p>정말 모든 데이터를 지우시겠습니까? 확인하려면 아래에 <b>초기화</b>라고 입력하세요.</p><input type="text" id="f-confirm" style="width:100%">', buttons: [{ label: '취소', value: null }, { label: '초기화', cls: 'danger', value: (el) => U.val(el, '#f-confirm') }] });
      if (typed !== '초기화') { if (typed != null) U.toast('입력이 달라 취소했습니다.', true); return; }
      const r = await U.api('data.resetAll'); U.toast(`초기화했습니다. 백업: ${r.backup}`, false, 5000); App.go('settings', { tab: 'semester' });
    });
  },

  // ---------- 앱 ----------
  async app(body) {
    const info = await U.api('app.info');
    const st = App.state.settings;
    body.innerHTML = `<div class="panel"><h2 style="margin-top:0">기본 정보</h2><div class="kv"><label>담당교사</label><input type="text" id="s-teacher" value="${U.esc(st.teacher)}" class="short"><label>학교명(기본)</label><input type="text" id="s-school" value="${U.esc(st.school)}"></div><div class="row" style="margin-top:10px"><button class="btn primary" id="s-save">저장</button></div></div>
      <div class="panel"><h2 style="margin-top:0">윈도우 시작 시 자동 실행</h2><label class="inline"><input type="checkbox" id="s-auto" ${info.autoLaunch ? 'checked' : ''}> 로그인하면 출석부를 자동으로 엽니다</label>${info.portable ? '<p class="small muted">무설치 실행 파일은 위치를 옮기면 자동 실행 등록을 다시 해야 합니다.</p>' : ''}${info.platform !== 'win32' ? '<p class="small muted">이 기능은 윈도우에서만 동작합니다.</p>' : ''}</div>
      <div class="panel"><h2 style="margin-top:0">프로그램 정보</h2><div class="kv"><label>버전</label><div>${U.esc(info.version)}</div><label>실행 형태</label><div>${info.portable ? '무설치(포터블)' : '설치형'}</div></div><p class="small muted">작업표시줄에 고정하려면 실행 중인 아이콘을 오른쪽 클릭 → "작업 표시줄에 고정"을 누르세요. 새 버전은 실행 파일만 바꾸면 되고 데이터는 그대로 유지됩니다.</p></div>`;
    body.querySelector('#s-save').addEventListener('click', async () => { await U.api('settings.update', { teacher: U.val(body, '#s-teacher'), school: U.val(body, '#s-school') }); U.toast('저장했습니다.'); go('app'); });
    body.querySelector('#s-auto').addEventListener('change', async (e) => { await U.api('settings.update', { autoLaunch: e.target.checked }); U.toast(e.target.checked ? '자동 실행을 켰습니다.' : '자동 실행을 껐습니다.'); });
  },
};

// ---------- 대화상자들 ----------
async function newSemesterDialog() {
  const st = App.state;
  const cur = st.semester;
  const t = st.today; const y = Number(t.slice(0, 4)); const m = Number(t.slice(5, 7));
  const def = m >= 7 ? { name: `${y}학년도 2학기`, start: `${y}-08-16`, end: `${y}-12-31` } : { name: `${y}학년도 1학기`, start: `${y}-03-02`, end: `${y}-07-31` };
  const v = await U.modal({ title: '새 학기 시작', html: `<div class="kv"><label>학기명</label><input type="text" id="f-name" value="${def.name}"><label>시작일</label><input type="date" id="f-start" value="${def.start}"><label>종료일</label><input type="date" id="f-end" value="${def.end}"><label>학교명</label><input type="text" id="f-school" value="${U.esc(cur ? cur.school : st.settings.school)}"></div>${cur ? `<label class="inline" style="margin-top:12px"><input type="checkbox" id="f-copy" checked> 현재 학기(${U.esc(cur.name)})의 과목·시간표·명단을 복사 (출결 기록은 복사하지 않음)</label>` : ''}<p class="small muted">이전 학기는 삭제되지 않고 목록에 남습니다. 명단이 바뀌면 설정 양식을 내려받아 고친 뒤 업로드하세요.</p>`, buttons: [{ label: '취소', value: null }, { label: '만들기', cls: 'primary', value: (el) => ({ name: U.val(el, '#f-name'), start: U.val(el, '#f-start'), end: U.val(el, '#f-end'), school: U.val(el, '#f-school'), copyFromId: el.querySelector('#f-copy') && el.querySelector('#f-copy').checked ? cur.id : null }) }] });
  if (!v) return;
  try { await U.api('semester.create', v); U.toast('새 학기를 시작했습니다.'); go('subjects'); } catch (e) { U.toast(e.message, true); }
}

async function importDialog() {
  let d;
  try { d = await U.api('import.pick'); } catch (e) { U.alert('가져오기 실패', `<p>${U.esc(e.message)}</p>`); return; }
  if (!d) return;
  const cur = App.state.semester;
  const html = `<p class="small">${U.esc(d.file)}</p>
    <table><thead><tr><th>시트</th><th>과목명</th><th>학점</th><th>학생</th><th>수업일</th><th>차시</th><th>기간</th></tr></thead><tbody>${d.subjects.map((s) => `<tr><td>${U.esc(s.sheetName)}</td><td>${U.esc(s.name)}</td><td>${s.credits ?? ''}</td><td>${s.students}</td><td>${s.sessions}</td><td>${s.periods}</td><td class="small">${s.firstDate} ~ ${s.lastDate}</td></tr>`).join('')}</tbody></table>
    <div class="kv" style="margin-top:12px"><label>학기명</label><input type="text" id="f-name" value="${U.esc(d.semester.name)}"><label>시작일</label><input type="date" id="f-start" value="${d.semester.start}"><label>종료일</label><input type="date" id="f-end" value="${d.semester.end}"><label>학교명</label><input type="text" id="f-school" value="${U.esc(d.semester.school)}"></div>
    ${cur ? `<label class="inline" style="margin-top:10px"><input type="checkbox" id="f-replace"> 현재 학기(${U.esc(cur.name)})를 이 내용으로 교체 (체크하지 않으면 새 학기로 추가)</label>` : ''}
    <div style="margin-top:10px">${U.warnListHtml(d.warnings)}</div>
    <p class="small muted">가져온 뒤 [과목·시간표]에서 요일과 시간을 확인하세요. 시간표는 날짜 패턴으로 추정한 값이라 시각은 비어 있습니다.</p>`;
  const v = await U.modal({ title: '기존 출석부 가져오기', html, width: 720, buttons: [{ label: '취소', value: null }, { label: '가져오기', cls: 'primary', value: (el) => ({ draftId: d.draftId, name: U.val(el, '#f-name'), start: U.val(el, '#f-start'), end: U.val(el, '#f-end'), school: U.val(el, '#f-school'), replaceCurrent: !!(el.querySelector('#f-replace') && el.querySelector('#f-replace').checked) }) }] });
  if (!v) return;
  try { await U.api('import.apply', v); U.toast('가져왔습니다. 과목별 수업 시간을 확인해 주세요.', false, 4000); go('subjects'); } catch (e) { U.toast(e.message, true); }
}

async function templateDialog() {
  let d;
  try { d = await U.api('template.pick'); } catch (e) { U.alert('양식 읽기 실패', `<p>${U.esc(e.message)}</p>`); return; }
  if (!d) return;
  const cur = App.state.semester;
  const html = `<p class="small">${U.esc(d.file)}</p>
    <table><thead><tr><th>과목</th><th>학점</th><th>시간표</th><th>학생</th><th>보강</th></tr></thead><tbody>${d.subjects.map((s) => `<tr><td>${U.esc(s.name)}</td><td>${s.credits ?? ''}</td><td class="small">${U.esc(s.schedule) || '<span class="tag danger">없음</span>'}</td><td>${s.students}</td><td>${s.extras}</td></tr>`).join('')}</tbody></table>
    <p class="small">휴업일 ${d.holidays}건, 소속교 행사 ${d.schoolEvents}건${d.semester.name ? ` · 학기: ${U.esc(d.semester.name)} (${d.semester.start || '?'} ~ ${d.semester.end || '?'})` : ''}</p>
    ${cur ? `<label class="inline"><input type="radio" name="mode" value="current" checked> 현재 학기(${U.esc(cur.name)})에 적용 — 기존 출결 기록 유지</label><br><label class="inline"><input type="radio" name="mode" value="new"> 양식의 [학기] 정보로 새 학기를 만들어 적용</label>` : '<p>새 학기를 만들어 적용합니다.</p>'}
    <div style="margin-top:10px">${U.warnListHtml(d.warnings)}</div>`;
  const v = await U.modal({ title: '설정 양식 적용', html, width: 720, buttons: [{ label: '취소', value: null }, { label: '적용', cls: 'primary', value: (el) => ({ draftId: d.draftId, asNewSemester: !cur || (el.querySelector('input[name=mode]:checked') || {}).value === 'new' }) }] });
  if (!v) return;
  try {
    const r = await U.api('template.apply', v);
    const s = r.summary;
    await U.alert('적용 완료', `<p>과목 추가 ${s.subjectsAdded.length}건${s.subjectsAdded.length ? ` (${U.esc(s.subjectsAdded.join(', '))})` : ''}, 과목 삭제 ${s.subjectsRemoved.length}건, 학생 추가 ${s.studentsAdded}명, 학생 삭제 ${s.studentsRemoved}명, 수강취소 처리 ${s.studentsDropped.length}명${s.studentsDropped.length ? ` (${U.esc(s.studentsDropped.join(', '))})` : ''}</p>${U.warnListHtml(s.warnings)}`);
    go('subjects');
  } catch (e) { U.toast(e.message, true); }
}

async function subjectDialog(sub) {
  const rows = sub ? sub.schedule.map((e) => ({ ...e })) : [];
  const rowHtml = (e, i) => `<tr data-i="${i}"><td><select data-f="dow">${[1, 2, 3, 4, 5, 6, 7].map((d) => `<option value="${d}" ${Number(e.dow) === d ? 'selected' : ''}>${U.dowKo(d)}</option>`).join('')}</select></td><td><input type="time" data-f="start" value="${e.start || ''}"></td><td><input type="time" data-f="end" value="${e.end || ''}"></td><td><input type="number" data-f="periods" min="1" value="${e.periods || 1}"></td><td><button class="btn small danger" data-rm="${i}">삭제</button></td></tr>`;
  const v = await U.modal({
    title: sub ? '과목 편집' : '과목 추가', width: 640,
    html: `<div class="kv"><label>과목명</label><input type="text" id="f-name" value="${U.esc(sub ? sub.name : '')}"><label>학점</label><input type="number" id="f-credits" value="${sub && sub.credits != null ? sub.credits : ''}" min="0" step="1"><label>담당교사</label><input type="text" id="f-teacher" value="${U.esc(sub ? sub.teacher : (App.state.settings.teacher || ''))}" class="short"><label>메모</label><input type="text" id="f-memo" value="${U.esc(sub ? sub.memo : '')}" placeholder="출석부 비고란에 인쇄됩니다"><label>시간표 적용 시작일</label><div><input type="date" id="f-from" value="${sub && sub.scheduleFrom ? sub.scheduleFrom : ''}"> <span class="small muted">비우면 학기 시작일부터. 엑셀에서 가져온 과목은 가져온 마지막 날 다음날로 설정되어 있습니다.</span></div></div>
      <h3>주간 시간표</h3><table id="sched"><thead><tr><th>요일</th><th>시작</th><th>종료</th><th>차시 수</th><th></th></tr></thead><tbody>${rows.map(rowHtml).join('')}</tbody></table><button class="btn small" id="add-row" style="margin-top:6px">요일 추가</button><div class="small muted" style="margin-top:6px">하루 두 차시 연강이면 한 줄에 차시 수 2로 적습니다. 시각은 홈 화면의 정렬과 "지금 수업" 표시에 쓰입니다.</div>`,
    onOpen(el) {
      const tbody = el.querySelector('#sched tbody');
      const bind = () => { el.querySelectorAll('[data-rm]').forEach((b) => b.onclick = () => { rows.splice(Number(b.dataset.rm), 1); tbody.innerHTML = rows.map(rowHtml).join(''); bind(); }); el.querySelectorAll('#sched [data-f]').forEach((inp) => inp.onchange = () => { rows[Number(inp.closest('tr').dataset.i)][inp.dataset.f] = inp.value; }); };
      bind();
      el.querySelector('#add-row').addEventListener('click', () => { rows.push({ dow: 1, start: '', end: '', periods: 1 }); tbody.innerHTML = rows.map(rowHtml).join(''); bind(); });
    },
    buttons: [{ label: '취소', value: null }, { label: '저장', cls: 'primary', value: (el) => ({ name: U.val(el, '#f-name'), credits: U.val(el, '#f-credits'), teacher: U.val(el, '#f-teacher'), memo: U.val(el, '#f-memo'), scheduleFrom: U.val(el, '#f-from') || null, schedule: rows }) }],
  });
  if (!v) return;
  try { await U.api('subject.save', { id: sub ? sub.id : null, ...v }); U.toast('저장했습니다.'); go('subjects'); } catch (e) { U.toast(e.message, true); }
}
