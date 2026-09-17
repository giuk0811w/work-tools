'use strict';
const { recordKey, isEnrolledOn, STATUS_LIST } = require('./model');
const { listSessions } = require('./schedule');

function getRecord(semester, subjectId, date) {
  return semester.records[recordKey(subjectId, date)] || null;
}

function schoolEventFor(semester, school, date) {
  return semester.schoolEvents.find((e) => e.date === date && e.school && school && normalizeSchool(e.school) === normalizeSchool(school)) || null;
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
    let statuses; let reason = ''; let docNo = ''; let docDate = ''; let auto = false;
    if (m) {
      statuses = fillStatuses(m.s, session.periods);
      reason = m.reason || ''; docNo = m.docNo || ''; docDate = m.docDate || '';
    } else {
      const ev = enrolled ? schoolEventFor(semester, student.school, session.date) : null;
      if (ev) { statuses = fillStatuses(['W'], session.periods); reason = ev.reason || '소속교 행사'; auto = true; }
      else statuses = fillStatuses([], session.periods);
    }
    return { student, enrolled, statuses, reason, docNo, docDate, auto };
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

// 전체 대기 목록
function pendingList(semester) {
  const out = [];
  for (const subject of semester.subjects) {
    const sessions = listSessions(semester, subject);
    for (const session of sessions) {
      const rec = getRecord(semester, subject.id, session.date);
      if (!rec || !rec.marks) continue;
      for (const [studentId, m] of Object.entries(rec.marks)) {
        if (!m.s || !m.s.includes('W')) continue;
        const student = subject.students.find((s) => s.id === studentId);
        if (!student) continue;
        out.push({ subject, session, student, mark: m, confirmed: rec.confirmed });
      }
    }
  }
  out.sort((a, b) => (a.session.date < b.session.date ? -1 : a.session.date > b.session.date ? 1 : 0));
  return out;
}

// 대기 → 확정/출석/미인정 전환
function resolvePending(semester, subjectId, date, studentId, newStatus, { docNo, docDate, reason } = {}) {
  const rec = getRecord(semester, subjectId, date);
  if (!rec || !rec.marks || !rec.marks[studentId]) return false;
  const m = rec.marks[studentId];
  m.s = m.s.map((x) => (x === 'W' ? newStatus : x));
  if (docNo != null) m.docNo = docNo;
  if (docDate != null) m.docDate = docDate;
  if (reason != null) m.reason = reason;
  if (m.s.every((x) => x === 'P') && !m.reason && !m.docNo && !m.docDate) delete rec.marks[studentId];
  rec.updatedAt = new Date().toISOString();
  return true;
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
  getRecord, sessionView, compactMarks, saveRecord, summarize, pendingList, resolvePending,
  unconfirmedSessions, registerMatrix, fillStatuses, schoolEventFor, normalizeSchool,
};
