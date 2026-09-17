'use strict';
const { recordKey, isEnrolledOn, STATUS_LIST } = require('./model');
const { listSessions } = require('./schedule');

function getRecord(semester, subjectId, date) {
  return semester.records[recordKey(subjectId, date)] || null;
}

// 인정결석 사전 등록(소속교 행사/공문) 중 학생·날짜에 해당하는 것
// 항목: {id, school, date(시작), to(종료), names:[이름] (비어 있으면 학교 전체), reason, confirmed(공문 접수 여부)}
function planFor(semester, student, date) {
  if (!student || !student.school) return null;
  const school = normalizeSchool(student.school);
  const hits = semester.schoolEvents.filter((e) => {
    if (!e.school || normalizeSchool(e.school) !== school) return false;
    const from = e.date; const to = e.to || e.date;
    if (date < from || date > to) return false;
    if (Array.isArray(e.names) && e.names.length && !e.names.map((n) => String(n).trim()).includes(student.name.trim())) return false;
    return true;
  });
  if (!hits.length) return null;
  // 학생 지정 항목이 학교 전체 항목보다 우선, 그다음 공문 접수된 항목 우선
  hits.sort((a, b) => ((b.names && b.names.length) ? 1 : 0) - ((a.names && a.names.length) ? 1 : 0) || (b.confirmed ? 1 : 0) - (a.confirmed ? 1 : 0));
  return hits[0];
}

function schoolEventFor(semester, school, date) {
  return planFor(semester, { school, name: '' }, date);
}

function normalizeSchool(s) {
  return String(s || '').replace(/\s+/g, '').replace(/등학교$/, '').replace(/학교$/, '');
}

function fillStatuses(s, periods) {
  const arr = Array.isArray(s) ? s.slice(0, periods) : [];
  while (arr.length < periods) arr.push(arr.length ? arr[arr.length - 1] : 'P');
  return arr.map((x) => (STATUS_LIST.includes(x) ? x : 'P'));
}

// 한 수업의 학생별 실효 상태
// 반환: {session, record, rows:[{student, enrolled, statuses[], reason, docNo, docDate, auto}], confirmed}
function sessionView(semester, subject, session) {
  const record = getRecord(semester, subject.id, session.date);
  const rows = subject.students.map((student) => {
    const enrolled = isEnrolledOn(student, session.date);
    const m = record && record.marks ? record.marks[student.id] : null;
    let statuses; let reason = ''; let docNo = ''; let docDate = ''; let auto = false; let planId = null;
    if (m) {
      statuses = fillStatuses(m.s, session.periods);
      reason = m.reason || ''; docNo = m.docNo || ''; docDate = m.docDate || '';
    } else {
      const ev = enrolled ? planFor(semester, student, session.date) : null;
      if (ev) { statuses = fillStatuses([ev.confirmed ? 'E' : 'W'], session.periods); reason = ev.reason || '소속교 행사'; auto = true; planId = ev.id; }
      else statuses = fillStatuses([], session.periods);
    }
    return { student, enrolled, statuses, reason, docNo, docDate, auto, planId };
  });
  return { session, record, confirmed: !!(record && record.confirmed), rows };
}

// 저장용 marks 정리: 전부 출석이고 부가정보 없으면 항목을 만들지 않는다.
function compactMarks(rows, periods) {
  const marks = {};
  for (const r of rows) {
    const statuses = fillStatuses(r.statuses, periods);
    const allP = statuses.every((s) => s === 'P');
    const hasInfo = (r.reason && r.reason.trim()) || (r.docNo && r.docNo.trim()) || (r.docDate && r.docDate.trim());
    if (allP && !hasInfo) continue;
    marks[r.studentId || r.student.id] = {
      s: statuses,
      reason: (r.reason || '').trim(),
      docNo: (r.docNo || '').trim(),
      docDate: (r.docDate || '').trim(),
    };
  }
  return marks;
}

function saveRecord(semester, subjectId, date, marks, { confirm, now } = {}) {
  const key = recordKey(subjectId, date);
  const prev = semester.records[key] || { confirmed: false, confirmedAt: null, marks: {} };
  const rec = { ...prev, marks, updatedAt: now || new Date().toISOString() };
  if (confirm === true) { rec.confirmed = true; rec.confirmedAt = now || new Date().toISOString(); }
  if (confirm === false) { rec.confirmed = false; rec.confirmedAt = null; }
  semester.records[key] = rec;
  return rec;
}

function summarize(view) {
  const c = { P: 0, X: 0, W: 0, E: 0, total: 0 };
  for (const r of view.rows) {
    if (!r.enrolled) continue;
    c.total += 1;
    // 학생 단위 요약: 결석이 하나라도 있으면 그 상태로 센다 (우선순위 X > W > E > P)
    const st = r.statuses.includes('X') ? 'X' : r.statuses.includes('W') ? 'W' : r.statuses.includes('E') ? 'E' : 'P';
    c[st] += 1;
  }
  return c;
}

// 전체 대기 목록: 저장된 대기 표기 + 사전 등록에서 파생된 대기(아직 저장되지 않은 것, 미래 수업 포함)
function pendingList(semester) {
  const out = [];
  for (const subject of semester.subjects) {
    for (const session of listSessions(semester, subject)) {
      const view = sessionView(semester, subject, session);
      for (const r of view.rows) {
        if (!r.enrolled || !r.statuses.includes('W')) continue;
        const stored = !!(view.record && view.record.marks && view.record.marks[r.student.id]);
        out.push({ subject, session, student: r.student, statuses: r.statuses, reason: r.reason, stored, planId: r.planId || null, confirmed: view.confirmed });
      }
    }
  }
  out.sort((a, b) => a.session.date.localeCompare(b.session.date) || a.subject.name.localeCompare(b.subject.name, 'ko'));
  return out;
}

// 대기 → 인정결석 확정(E) 또는 출석(P)으로 전환. 저장되지 않은(사전 등록 파생) 항목이면 기록을 만들어 저장한다.
function resolvePending(semester, subjectId, date, studentId, newStatus, { reason } = {}) {
  const subject = semester.subjects.find((s) => s.id === subjectId);
  if (!subject) return false;
  const student = subject.students.find((s) => s.id === studentId);
  if (!student) return false;
  const session = listSessions(semester, subject).find((s) => s.date === date);
  if (!session) return false;
  const key = recordKey(subjectId, date);
  const rec = semester.records[key] || (semester.records[key] = { confirmed: false, confirmedAt: null, marks: {} });
  if (!rec.marks) rec.marks = {};
  let m = rec.marks[studentId];
  if (!m) {
    const plan = planFor(semester, student, date);
    m = { s: fillStatuses([plan ? 'W' : 'P'], session.periods), reason: (plan && plan.reason) || '', docNo: '', docDate: '' };
    rec.marks[studentId] = m;
  }
  m.s = m.s.map((x) => (x === 'W' ? newStatus : x));
  if (reason != null) m.reason = reason;
  if (m.s.every((x) => x === 'P') && !m.docNo && !m.docDate) delete rec.marks[studentId];
  rec.updatedAt = new Date().toISOString();
  return true;
}

// 사전 등록 항목의 공문 접수 여부 변경. 접수로 바꾸면 이미 저장된 대기 표기도 인정결석으로 바꾼다.
function setPlanConfirmed(semester, planId, confirmed) {
  const plan = semester.schoolEvents.find((e) => e.id === planId);
  if (!plan) return 0;
  plan.confirmed = !!confirmed;
  if (!confirmed) return 0;
  let changed = 0;
  for (const subject of semester.subjects) {
    for (const student of subject.students) {
      for (const [key, rec] of Object.entries(semester.records)) {
        if (!key.startsWith(subject.id + '|') || !rec.marks || !rec.marks[student.id]) continue;
        const date = key.split('|')[1];
        if (planFor(semester, student, date) !== plan) continue;
        const m = rec.marks[student.id];
        if (m.s.includes('W')) { m.s = m.s.map((x) => (x === 'W' ? 'E' : x)); changed += 1; }
      }
    }
  }
  return changed;
}

// 미확정 지난 수업 목록 (오늘 포함 여부 선택)
function unconfirmedSessions(semester, todayISO, { includeToday = false } = {}) {
  const out = [];
  for (const subject of semester.subjects) {
    for (const session of listSessions(semester, subject)) {
      if (session.date > todayISO) continue;
      if (session.date === todayISO && !includeToday) continue;
      const rec = getRecord(semester, subject.id, session.date);
      if (!rec || !rec.confirmed) out.push({ subject, session });
    }
  }
  out.sort((a, b) => a.session.date.localeCompare(b.session.date));
  return out;
}

// 출석부 행렬: 과목별 학생 × 차시
function registerMatrix(semester, subject, { from, to, todayISO } = {}) {
  const sessions = listSessions(semester, subject).filter((s) => (!from || s.date >= from) && (!to || s.date <= to));
  const columns = [];
  for (const session of sessions) {
    const view = sessionView(semester, subject, session);
    for (let p = 0; p < session.periods; p++) {
      columns.push({
        seq: session.seq + p, date: session.date, period: p, periods: session.periods, session,
        confirmed: view.confirmed,
        future: todayISO ? session.date > todayISO : false,
        cells: view.rows.map((r) => ({
          studentId: r.student.id,
          enrolled: r.enrolled,
          status: view.confirmed ? r.statuses[p] : null,
          draft: view.confirmed ? null : r.statuses[p],
          reason: r.reason, docNo: r.docNo,
        })),
      });
    }
  }
  return { subject, sessions, columns, students: subject.students };
}

module.exports = {
  getRecord, sessionView, compactMarks, saveRecord, summarize, pendingList, resolvePending, setPlanConfirmed,
  unconfirmedSessions, registerMatrix, fillStatuses, schoolEventFor, planFor, normalizeSchool,
};
