'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const dates = require('../src/core/dates');
const model = require('../src/core/model');
const { listSessions, sessionsOn, seqLabel } = require('../src/core/schedule');
const marks = require('../src/core/marks');

function makeSemester() {
  const sem = model.newSemester({ name: '2026학년도 2학기', start: '2026-08-10', end: '2026-09-30' });
  const sub = model.newSubject({ name: '경제', credits: 2, teacher: '홍길동' });
  sub.schedule = [{ dow: 4, start: '14:00', end: '15:40', periods: 2 }]; // 목요일 2차시
  sub.students = [model.newStudent({ school: '가나고', no: '20101', name: '학생A' }), model.newStudent({ school: '다라고', no: '20102', name: '학생B' })];
  sem.subjects.push(sub);
  return { sem, sub };
}

test('dates: dow/parse', () => {
  assert.equal(dates.dow('2026-09-17'), 4);
  assert.equal(dates.dow('2026-09-20'), 7);
  assert.equal(dates.addDays('2026-08-31', 1), '2026-09-01');
  assert.equal(dates.parseDateLoose(new Date(Date.UTC(2026, 7, 10))), '2026-08-10');
  assert.equal(dates.parseDateLoose('2026.9.1'), '2026-09-01');
  assert.equal(dates.parseDateLoose('2026-09-01'), '2026-09-01');
  assert.equal(dates.parseDateLoose(46974), '2028-08-09');
  assert.equal(dates.parseDateLoose('◎'), null);
  assert.equal(dates.parseTimeLoose('14:00'), '14:00');
  assert.equal(dates.parseTimeLoose('9시'), '09:00');
  assert.equal(dates.parseTimeLoose(0.5), '12:00');
  assert.equal(dates.parseDow('목'), 4);
  assert.equal(dates.parseDow('일요일'), 7);
});

test('schedule: weekly sessions, holidays, cancels, extras, numbering', () => {
  const { sem, sub } = makeSemester();
  let list = listSessions(sem, sub);
  assert.deepEqual(list.map((s) => s.date), ['2026-08-13', '2026-08-20', '2026-08-27', '2026-09-03', '2026-09-10', '2026-09-17', '2026-09-24']);
  assert.equal(list[0].seq, 1); assert.equal(list[0].seqEnd, 2); assert.equal(list[1].seq, 3);
  assert.equal(seqLabel(list[1]), '3~4차시');
  // 전체 휴업일
  sem.holidays.push({ id: 'h1', date: '2026-08-20', reason: '휴업', subjectIds: null });
  list = listSessions(sem, sub);
  assert.ok(!list.find((s) => s.date === '2026-08-20'));
  assert.equal(list[1].date, '2026-08-27'); assert.equal(list[1].seq, 3);
  // 다른 과목만 휴업이면 영향 없음
  sem.holidays.push({ id: 'h2', date: '2026-08-27', reason: '', subjectIds: ['other'] });
  assert.ok(listSessions(sem, sub).find((s) => s.date === '2026-08-27'));
  // 취소 + 보강
  sub.cancels.push({ date: '2026-09-03', reason: '출장' });
  sub.extras.push({ date: '2026-09-05', periods: 2, start: '10:00', end: '11:40', reason: '보강', source: 'manual' });
  list = listSessions(sem, sub);
  assert.ok(!list.find((s) => s.date === '2026-09-03'));
  const extra = list.find((s) => s.date === '2026-09-05');
  assert.equal(extra.source, 'extra'); assert.equal(extra.seq, 5);
  // scheduleFrom 이전은 주간 시간표 미적용
  sub.scheduleFrom = '2026-09-01';
  list = listSessions(sem, sub);
  assert.equal(list[0].date, '2026-09-05');
  // 같은 날 보강은 주간 수업을 대체
  sub.scheduleFrom = null;
  sub.extras.push({ date: '2026-09-10', periods: 3, start: '', end: '', reason: '', source: 'manual' });
  assert.equal(listSessions(sem, sub).find((s) => s.date === '2026-09-10').periods, 3);
});

test('schedule: sessionsOn sorts by time', () => {
  const { sem, sub } = makeSemester();
  const sub2 = model.newSubject({ name: '심리학' });
  sub2.schedule = [{ dow: 4, start: '09:00', end: '09:50', periods: 1 }];
  sem.subjects.push(sub2);
  const on = sessionsOn(sem, '2026-09-17');
  assert.deepEqual(on.map((x) => x.subject.name), ['심리학', '경제']);
  assert.equal(sessionsOn(sem, '2026-09-18').length, 0);
});

test('marks: default present, school event auto pending, save/confirm, pending list', () => {
  const { sem, sub } = makeSemester();
  const session = listSessions(sem, sub)[0];
  let view = marks.sessionView(sem, sub, session);
  assert.equal(view.confirmed, false);
  assert.deepEqual(view.rows[0].statuses, ['P', 'P']);
  sem.schoolEvents.push({ id: 'e1', school: '다라고등학교', date: '2026-08-13', reason: '1회고사' });
  view = marks.sessionView(sem, sub, session);
  assert.deepEqual(view.rows[1].statuses, ['W', 'W']);
  assert.equal(view.rows[1].auto, true);
  assert.equal(view.rows[1].reason, '1회고사');
  // 저장 (학생A 1교시만 미인정)
  const rows = view.rows.map((r) => ({ studentId: r.student.id, statuses: r.statuses.slice(), reason: r.reason, docNo: '', docDate: '' }));
  rows[0].statuses = ['X', 'P'];
  const compact = marks.compactMarks(rows, 2);
  assert.deepEqual(Object.keys(compact).length, 2);
  marks.saveRecord(sem, sub.id, session.date, compact, { confirm: true });
  view = marks.sessionView(sem, sub, session);
  assert.equal(view.confirmed, true);
  assert.deepEqual(view.rows[0].statuses, ['X', 'P']);
  assert.deepEqual(marks.summarize(view), { P: 0, X: 1, W: 1, E: 0, total: 2 });
  const pending = marks.pendingList(sem);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].student.name, '학생B');
  assert.ok(marks.resolvePending(sem, sub.id, session.date, sub.students[1].id, 'E'));
  assert.equal(marks.pendingList(sem).length, 0);
  assert.deepEqual(marks.sessionView(sem, sub, session).rows[1].statuses, ['E', 'E']);
  assert.equal(marks.sessionView(sem, sub, session).rows[1].reason, '1회고사');
  // 대기 → 출석으로 되돌리면 항목 삭제
  marks.saveRecord(sem, sub.id, '2026-08-20', { [sub.students[0].id]: { s: ['W', 'W'], reason: '', docNo: '', docDate: '' } }, { confirm: true });
  marks.resolvePending(sem, sub.id, '2026-08-20', sub.students[0].id, 'P');
  assert.equal(sem.records[model.recordKey(sub.id, '2026-08-20')].marks[sub.students[0].id], undefined);
});

test('marks: advance plans (range, named students, confirmed), derived pending, plan confirm', () => {
  const { sem, sub } = makeSemester();
  // 다라고 전체, 9/3~9/10 시험 (공문 미접수)
  sem.schoolEvents.push({ id: 'p1', school: '다라고', date: '2026-09-03', to: '2026-09-10', names: [], reason: '2회고사', confirmed: false });
  // 가나고 학생A 개별 공문 (접수됨) 9/17
  sem.schoolEvents.push({ id: 'p2', school: '가나고', date: '2026-09-17', to: '2026-09-17', names: ['학생A'], reason: '병원 진료', confirmed: true });
  const sessions = listSessions(sem, sub);
  const v903 = marks.sessionView(sem, sub, sessions.find((s) => s.date === '2026-09-03'));
  assert.deepEqual(v903.rows[1].statuses, ['W', 'W']); assert.equal(v903.rows[1].planId, 'p1');
  assert.deepEqual(v903.rows[0].statuses, ['P', 'P']);
  const v910 = marks.sessionView(sem, sub, sessions.find((s) => s.date === '2026-09-10'));
  assert.deepEqual(v910.rows[1].statuses, ['W', 'W']);
  const v917 = marks.sessionView(sem, sub, sessions.find((s) => s.date === '2026-09-17'));
  assert.deepEqual(v917.rows[0].statuses, ['E', 'E']); assert.equal(v917.rows[0].reason, '병원 진료');
  assert.deepEqual(v917.rows[1].statuses, ['P', 'P']);
  // 파생 대기 목록 (미래 포함): 9/3, 9/10 학생B
  let pending = marks.pendingList(sem);
  assert.deepEqual(pending.map((p) => `${p.session.date}:${p.student.name}:${p.stored}`), ['2026-09-03:학생B:false', '2026-09-10:학생B:false']);
  // 파생 항목 체크 → 기록 생성 + E
  assert.ok(marks.resolvePending(sem, sub.id, '2026-09-03', sub.students[1].id, 'E'));
  assert.deepEqual(marks.sessionView(sem, sub, sessions.find((s) => s.date === '2026-09-03')).rows[1].statuses, ['E', 'E']);
  assert.equal(marks.pendingList(sem).length, 1);
  // 9/10 수업을 대기 상태로 확정 저장한 뒤 항목 공문 접수 → 저장된 W도 E로
  const v = marks.sessionView(sem, sub, sessions.find((s) => s.date === '2026-09-10'));
  marks.saveRecord(sem, sub.id, '2026-09-10', marks.compactMarks(v.rows, 2), { confirm: true });
  assert.equal(marks.pendingList(sem)[0].stored, true);
  assert.equal(marks.setPlanConfirmed(sem, 'p1', true), 1);
  assert.equal(marks.pendingList(sem).length, 0);
  assert.deepEqual(marks.sessionView(sem, sub, sessions.find((s) => s.date === '2026-09-10')).rows[1].statuses, ['E', 'E']);
  // migrate가 옛 형식 항목을 보정
  const d = model.migrate({ semesters: [{ id: 's', subjects: [], schoolEvents: [{ id: 'x', school: 'A', date: '2026-01-01', reason: '' }] }] });
  assert.deepEqual(d.semesters[0].schoolEvents[0], { id: 'x', school: 'A', date: '2026-01-01', reason: '', to: '2026-01-01', names: [], confirmed: false });
});

test('marks: unconfirmed sessions and register matrix', () => {
  const { sem, sub } = makeSemester();
  const un = marks.unconfirmedSessions(sem, '2026-08-28');
  assert.deepEqual(un.map((u) => u.session.date), ['2026-08-13', '2026-08-20', '2026-08-27']);
  marks.saveRecord(sem, sub.id, '2026-08-13', {}, { confirm: true });
  assert.equal(marks.unconfirmedSessions(sem, '2026-08-28').length, 2);
  sub.students[1].dropDate = '2026-08-20';
  const mx = marks.registerMatrix(sem, sub, { todayISO: '2026-08-28' });
  assert.equal(mx.columns.length, 14);
  assert.equal(mx.columns[0].confirmed, true);
  assert.equal(mx.columns[0].cells[0].status, 'P');
  assert.equal(mx.columns[2].confirmed, false);
  assert.equal(mx.columns[2].cells[0].status, null);
  assert.equal(mx.columns[2].cells[1].enrolled, false);
  assert.equal(mx.columns[12].future, true);
});

test('model: migrate fills defaults and normalizeStatus', () => {
  const d = model.migrate({ semesters: [{ id: 's', subjects: [{ id: 'x', students: [{ id: 'y', no: 3 }] }] }] });
  assert.equal(d.currentSemesterId, 's');
  assert.deepEqual(d.semesters[0].holidays, []);
  assert.equal(d.semesters[0].subjects[0].students[0].no, '3');
  assert.equal(model.normalizeStatus('x'), 'X');
  assert.equal(model.normalizeStatus('◎'), 'E');
  assert.equal(model.normalizeStatus(''), 'P');
  assert.equal(model.normalizeStatus('?'), 'W');
  assert.equal(model.normalizeStatus('ㅁ'), null);
  assert.equal(model.parseCredits('2학점'), 2);
});
