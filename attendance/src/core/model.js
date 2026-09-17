'use strict';
const { addDays } = require('./dates');

// 출결 상태 코드
const STATUS = {
  P: 'P', // 출석 (기본)
  X: 'X', // 미인정결석
  W: 'W', // 인정결석 (대기: 공문 미접수)
  E: 'E', // 인정결석 (확정)
};
const STATUS_LABEL = { P: '출석', X: '미인정결석', W: '인정결석(대기)', E: '인정결석' };
const STATUS_SYMBOL = { P: 'O', X: 'X', W: '◎', E: '◎' };
const STATUS_LIST = ['P', 'X', 'W', 'E'];

let idCounter = 0;
function newId(prefix = 'id') {
  idCounter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${rand}`;
}

function newDataFile() {
  return {
    version: 1,
    settings: { teacher: '', school: '강원온라인학교', autoLaunch: false },
    currentSemesterId: null,
    semesters: [],
  };
}

function guessSemesterInfo(startISO) {
  const y = Number(startISO.slice(0, 4));
  const m = Number(startISO.slice(5, 7));
  if (m >= 7) {
    return { name: `${y}학년도 2학기`, start: startISO, end: `${y}-12-31` };
  }
  return { name: `${y}학년도 1학기`, start: startISO, end: `${y}-07-31` };
}

function newSemester({ name, start, end, school, id } = {}) {
  return {
    id: id || newId('sem'),
    name: name || '',
    school: school || '강원온라인학교',
    start: start || '',
    end: end || '',
    createdAt: new Date().toISOString(),
    subjects: [],
    holidays: [],      // {id, date, reason, subjectIds: null | [id]}
    schoolEvents: [],  // {id, school, date, reason}
    records: {},       // "subjectId|date" -> {confirmed, confirmedAt, marks:{studentId:{s:[...], reason, docNo, docDate}}}
  };
}

function newSubject({ name, credits, teacher, memo, id } = {}) {
  return {
    id: id || newId('sub'),
    name: name || '',
    credits: credits == null ? null : credits,
    teacher: teacher || '',
    memo: memo || '',
    schedule: [],      // {dow:1..7, start:'HH:MM', end:'HH:MM', periods:n}
    scheduleFrom: null,
    extras: [],        // {date, periods, start, end, reason, source}
    cancels: [],       // {date, reason}
    students: [],      // {id, school, no, name, dropDate}
  };
}

function newStudent({ school, no, name, dropDate, id } = {}) {
  return {
    id: id || newId('stu'),
    school: (school || '').trim(),
    no: no == null ? '' : String(no).trim(),
    name: (name || '').trim(),
    dropDate: dropDate || null,
  };
}

function recordKey(subjectId, date) { return `${subjectId}|${date}`; }

function parseCredits(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  const m = String(v).match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

function normalizeStatus(v) {
  if (v == null) return 'P';
  const s = String(v).trim().toUpperCase();
  if (s === '' || s === 'O' || s === '○' || s === '0' || s === 'P') return 'P';
  if (s === 'X' || s === '×' || s === 'ㅌ') return 'X';
  if (s === '◎' || s === 'E') return 'E';
  if (s === 'W' || s === '△' || s === '?') return 'W';
  return null;
}

function studentKey(st) {
  return `${(st.school || '').trim()}|${String(st.no || '').trim()}|${(st.name || '').trim()}`;
}

function findSemester(data, id) { return data.semesters.find((s) => s.id === id) || null; }
function currentSemester(data) { return findSemester(data, data.currentSemesterId); }
function findSubject(sem, id) { return sem.subjects.find((s) => s.id === id) || null; }
function findStudent(sub, id) { return sub.students.find((s) => s.id === id) || null; }

function isEnrolledOn(student, date) {
  if (!student.dropDate) return true;
  return date < student.dropDate;
}

// 데이터 파일 구조 보정 (버전 이행/누락 필드 채우기)
function migrate(data) {
  if (!data || typeof data !== 'object') return newDataFile();
  const base = newDataFile();
  data.version = data.version || 1;
  data.settings = Object.assign(base.settings, data.settings || {});
  data.semesters = Array.isArray(data.semesters) ? data.semesters : [];
  for (const sem of data.semesters) {
    const b = newSemester({ id: sem.id });
    for (const k of Object.keys(b)) if (sem[k] === undefined) sem[k] = b[k];
    for (const sub of sem.subjects) {
      const bs = newSubject({ id: sub.id });
      for (const k of Object.keys(bs)) if (sub[k] === undefined) sub[k] = bs[k];
      for (const st of sub.students) {
        const bt = newStudent({ id: st.id });
        for (const k of Object.keys(bt)) if (st[k] === undefined) st[k] = bt[k];
        st.no = st.no == null ? '' : String(st.no);
      }
    }
  }
  if (data.currentSemesterId && !findSemester(data, data.currentSemesterId)) data.currentSemesterId = null;
  if (!data.currentSemesterId && data.semesters.length) data.currentSemesterId = data.semesters[data.semesters.length - 1].id;
  return data;
}

module.exports = {
  STATUS, STATUS_LABEL, STATUS_SYMBOL, STATUS_LIST, newId, newDataFile, newSemester, newSubject, newStudent,
  recordKey, parseCredits, normalizeStatus, studentKey, findSemester, currentSemester, findSubject, findStudent,
  isEnrolledOn, migrate, guessSemesterInfo, addDays,
};
