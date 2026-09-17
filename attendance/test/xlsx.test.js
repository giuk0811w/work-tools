'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { parseAttendanceWorkbook, buildSemesterFromImport } = require('../src/core/importer');
const { buildSettingsTemplate, parseSettingsTemplate, applySettings } = require('../src/core/settings-template');
const { buildRegisterWorkbook, exportPrecheck, inspectTemplate } = require('../src/core/exporter');
const { listSessions } = require('../src/core/schedule');
const marks = require('../src/core/marks');
const model = require('../src/core/model');

const FIXTURE = path.join(__dirname, 'fixtures', 'sample-attendance.xlsx');

test('importer: parses blocks, students, marks; skips stale blocks', async () => {
  const draft = await parseAttendanceWorkbook(fs.readFileSync(FIXTURE));
  assert.equal(draft.subjects.length, 3);
  const eco = draft.subjects.find((s) => s.sheetName === '경제');
  assert.equal(eco.name, '경제'); assert.equal(eco.credits, 2); assert.equal(eco.students.length, 8);
  assert.deepEqual(eco.sessions.map((s) => `${s.date}x${s.periods}`), ['2026-08-13x2', '2026-08-20x2', '2026-08-27x2', '2026-09-03x2', '2026-09-10x2', '2026-09-17x2']);
  const s910 = eco.sessions.find((s) => s.date === '2026-09-10');
  assert.ok(Object.values(s910.marks).every((m) => m.join('') === 'EE'));
  const s917 = eco.sessions.find((s) => s.date === '2026-09-17');
  assert.ok(Object.values(s917.marks).every((m) => m.join('') === 'PP'));
  const clim = draft.subjects.find((s) => s.sheetName === '기후변화');
  assert.equal(clim.students.length, 2);
  assert.equal(clim.sessions.length, 28); // 17 + 11 (5~6월 잔재 블록 제외)
  assert.ok(draft.warnings.some((w) => w.includes('이른 날짜')));
  const fin = draft.subjects.find((s) => s.sheetName === '금융경제');
  assert.equal(fin.students.length, 5);
  const s813 = fin.sessions.find((s) => s.date === '2026-08-13');
  assert.equal(s813.periods, 2);
  assert.equal(draft.semester.name, '2026학년도 2학기');
  assert.equal(draft.semester.start, '2026-08-10');
});

test('importer: builds semester with confirmed past records and pending future marks', async () => {
  const draft = await parseAttendanceWorkbook(fs.readFileSync(FIXTURE));
  const sem = buildSemesterFromImport(draft, { todayISO: '2026-09-17' });
  const eco = sem.subjects.find((s) => s.name === '경제');
  assert.deepEqual(eco.schedule, [{ dow: 4, start: '', end: '', periods: 2 }]);
  assert.equal(eco.scheduleFrom, '2026-09-18');
  const sessions = listSessions(sem, eco);
  assert.equal(sessions[0].date, '2026-08-13');
  assert.equal(sessions[5].date, '2026-09-17'); assert.equal(sessions[5].seq, 11);
  assert.equal(sessions[6].date, '2026-09-24'); assert.equal(sessions[6].source, 'weekly');
  const recPast = marks.getRecord(sem, eco.id, '2026-09-10');
  assert.equal(recPast.confirmed, true);
  assert.ok(Object.values(recPast.marks).every((m) => m.s.join('') === 'EE'));
  assert.equal(Object.keys(recPast.marks).length, 8);
  assert.equal(marks.getRecord(sem, eco.id, '2026-09-17'), null); // 오늘, 표기 없음 → 기록 없음(미확정)
  const clim = sem.subjects.find((s) => s.name.startsWith('기후'));
  const rec810 = marks.getRecord(sem, clim.id, '2026-08-10');
  const stB = clim.students.find((s) => s.name === '학생02');
  assert.deepEqual(rec810.marks[stB.id].s, ['X']);
  assert.equal(marks.pendingList(sem).length, 2); // 기후변화 학생02 9/29, 9/30 (미래 ◎ → 대기)
});

test('settings template: roundtrip and apply preserves ids/records', async () => {
  const draft = await parseAttendanceWorkbook(fs.readFileSync(FIXTURE));
  const sem = buildSemesterFromImport(draft, { todayISO: '2026-09-17' });
  sem.holidays.push({ id: 'h', date: '2026-10-05', reason: '대체휴일', subjectIds: null });
  sem.schoolEvents.push({ id: 'e', school: '다라고등학교', date: '2026-10-20', to: '2026-10-21', names: ['학생02'], reason: '학력평가', confirmed: true });
  const eco = sem.subjects.find((s) => s.name === '경제');
  eco.schedule = [{ dow: 4, start: '14:00', end: '15:40', periods: 2 }];
  const buf = await buildSettingsTemplate(sem, { teacher: '홍길동' });
  const parsed = await parseSettingsTemplate(buf);
  assert.equal(parsed.warnings.length, 0, parsed.warnings.join('\n'));
  assert.equal(parsed.subjects.length, 3);
  const peco = parsed.subjects.find((s) => s.name === '경제');
  assert.deepEqual(peco.schedule, [{ dow: 4, start: '14:00', end: '15:40', periods: 2 }]);
  assert.equal(peco.students.length, 8);
  assert.equal(peco.students[0].no, '3');
  assert.deepEqual(parsed.holidays, [{ date: '2026-10-05', reason: '대체휴일', subjectNames: [] }]);
  assert.deepEqual(parsed.schoolEvents, [{ school: '다라고등학교', date: '2026-10-20', to: '2026-10-21', names: ['학생02'], reason: '학력평가', confirmed: true }]);
  assert.equal(parsed.semester.name, '2026학년도 2학기');
  assert.equal(parsed.settings.teacher, '홍길동');
  // 수정 후 적용: 학생 한 명 제거(기록 있음 → 수강취소), 새 학생 추가, 과목 시간 변경
  const ecoId = eco.id; const firstStudent = eco.students[0]; const firstId = firstStudent.id;
  peco.students = peco.students.slice(1).concat([{ school: '새고등학교', no: '10101', name: '신입생', dropDate: null }]);
  peco.schedule[0].start = '15:00';
  const summary = applySettings(sem, parsed, { todayISO: '2026-09-20' });
  const eco2 = sem.subjects.find((s) => s.name === '경제');
  assert.equal(eco2.id, ecoId);
  assert.equal(eco2.schedule[0].start, '15:00');
  assert.equal(eco2.students.find((s) => s.id === firstId).dropDate, '2026-09-20');
  assert.equal(summary.studentsDropped.length, 1);
  assert.equal(summary.studentsAdded, 1);
  assert.ok(eco2.students.find((s) => s.name === '신입생'));
  assert.equal(eco2.extras.filter((x) => x.source === 'import').length, 6);
  assert.ok(marks.getRecord(sem, ecoId, '2026-09-10').confirmed);
  assert.equal(sem.holidays.length, 1);
});

test('settings template: rejects non-template file', async () => {
  await assert.rejects(parseSettingsTemplate(fs.readFileSync(FIXTURE)), /설정 양식이 아닙니다/);
});

test('exporter: writes register in template layout', async () => {
  const draft = await parseAttendanceWorkbook(fs.readFileSync(FIXTURE));
  const sem = buildSemesterFromImport(draft, { todayISO: '2026-09-17' });
  sem.schoolEvents.push({ id: 'e', school: '다라고등학교', date: '2026-10-20', reason: '전국연합학력평가' });
  const pre = exportPrecheck(sem, { todayISO: '2026-09-17' });
  const ecoPre = pre.find((p) => p.subject === '경제');
  assert.equal(ecoPre.unconfirmed, 1); // 9/17 오늘 미확정
  const { buffer, stats } = await buildRegisterWorkbook(sem, { todayISO: '2026-09-17' });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['기후변화', '금융경제', '경제']);
  const ws = wb.getWorksheet('경제');
  assert.equal(ws.getCell('C2').value, '2026학년도 2학기 강원온라인학교 출석부');
  assert.equal(ws.getCell('B5').value, '경제');
  assert.equal(ws.getCell('D5').value, 2);
  assert.equal(ws.getCell('F5').value, '홍길동');
  assert.equal(ws.getCell('F7').value, '1차시');
  assert.equal(ws.getCell('F8').value.toISOString().slice(0, 10), '2026-08-13');
  assert.equal(ws.getCell('G8').value.toISOString().slice(0, 10), '2026-08-13');
  assert.equal(ws.getCell('E9').value, '학생08');
  assert.equal(ws.getCell('F9').value, 'O');
  assert.equal(ws.getCell('N9').value, '◎'); // 9/10 인정결석 확정
  // 9/17 (11~12차시) 은 미확정 → 빈칸, 날짜 셀 표시
  assert.equal(ws.getCell('P7').value, '11차시');
  assert.equal(ws.getCell('P9').value, null);
  assert.ok(ws.getCell('P8').fill && ws.getCell('P8').fill.fgColor);
  // 미래 주간 수업 날짜도 기재 (9/24)
  assert.equal(ws.getCell('R8').value.toISOString().slice(0, 10), '2026-09-24');
  // 2번째 블록 학생/제목 복제, 병합 유지
  assert.equal(ws.getCell('E44').value, '학생08');
  assert.equal(ws.getCell('B40').value, '경제');
  assert.ok(ws.model.merges.includes('S4:V5'));
  const clim = wb.getWorksheet('기후변화');
  assert.equal(clim.getCell('F10').value, 'X');
  assert.ok(String(clim.getCell('X8').value).includes('[다라고등학교]'));
  assert.equal(stats.find((s) => s.subject === '경제').periods, 2 * 6 + 2 * 15);
  fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'out', 'register-test.xlsx'), buffer);
});

test('exporter: adds blocks beyond 4 when periods exceed 68', async () => {
  const sem = model.newSemester({ name: 'T', start: '2026-03-02', end: '2026-12-31' });
  const sub = model.newSubject({ name: '많은과목', credits: 4 });
  sub.schedule = [{ dow: 1, start: '', end: '', periods: 2 }, { dow: 3, start: '', end: '', periods: 2 }];
  sub.students.push(model.newStudent({ school: 'A고', no: '1', name: '가' }));
  sem.subjects.push(sub);
  const { buffer } = await buildRegisterWorkbook(sem, { todayISO: '2026-03-01' });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.getWorksheet('많은과목');
  assert.equal(ws.getCell('F7').value, '1차시');
  assert.equal(ws.getCell('F147').value, '69차시');
  assert.equal(ws.getCell('B145').value, '많은과목');
  assert.equal(ws.getCell('E149').value, '가');
  assert.ok(ws.model.merges.includes('S144:V145'));
});

test('exporter: custom template file (full attendance workbook) is used and its sheets are dropped', async () => {
  const draft = await parseAttendanceWorkbook(fs.readFileSync(FIXTURE));
  const sem = buildSemesterFromImport(draft, { todayISO: '2026-09-17' });
  const { buffer, layout } = await buildRegisterWorkbook(sem, { todayISO: '2026-09-17', templatePath: FIXTURE, subjectIds: [sem.subjects[2].id] });
  assert.equal(layout, '표 4개 × 17차시, 학생 25명/표, 비고 칸 있음');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['경제']);
  const ws = wb.getWorksheet('경제');
  assert.equal(ws.getCell('B5').value, '경제');
  assert.equal(ws.getCell('E9').value, '학생08');
  assert.equal(ws.getCell('F9').value, 'O');
});

test('exporter: inspectTemplate rejects a non-register workbook', async () => {
  const buf = await buildSettingsTemplate(model.newSemester({ name: 'x', start: '2026-03-01', end: '2026-07-31' }), {});
  const r = await inspectTemplate(buf);
  assert.equal(r.ok, false);
  assert.ok(r.errors.length);
});
