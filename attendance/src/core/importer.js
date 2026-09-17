'use strict';
// 기존 엑셀 출석부(강원온라인학교 양식) 가져오기
const ExcelJS = require('exceljs');
const { parseDateLoose, addDays, dow } = require('./dates');
const { resolveValue, isBlankish } = require('./xlsx-util');
const model = require('./model');

const PERIOD_COL_START = 6; // F
const PERIOD_COL_END = 22;  // V
const TEMPLATE_SHEET_NAMES = ['양식', '서식', 'template'];

function str(v) { return v == null ? '' : String(v).trim(); }

function parseSheet(ws, warnings) {
  const headerRows = [];
  ws.eachRow((row, rowNumber) => {
    const b = resolveValue(ws, row.getCell(2));
    // 병합 셀(B7:B8)은 두 행 모두 같은 값을 돌려주므로 바로 아래 행은 제외
    if (str(b) === '연번' && headerRows[headerRows.length - 1] !== rowNumber - 1) headerRows.push(rowNumber);
  });
  if (!headerRows.length) return null;

  const first = headerRows[0];
  const subject = {
    sheetName: ws.name,
    name: str(resolveValue(ws, ws.getCell(first - 2, 2))) || ws.name,
    credits: model.parseCredits(resolveValue(ws, ws.getCell(first - 2, 4))),
    teacher: str(resolveValue(ws, ws.getCell(first - 2, 6))),
    title: str(resolveValue(ws, ws.getCell(first - 5, 3))),
    memo: str(resolveValue(ws, ws.getCell(first + 1, 24))),
    students: [],
    sessions: [],
  };
  const studentIndex = new Map(); // key -> student
  let lastDate = null;
  let blockNo = 0;

  for (const hdr of headerRows) {
    blockNo += 1;
    const dateRow = hdr + 1;
    // 이 블록의 차시 열
    const cols = [];
    for (let c = PERIOD_COL_START; c <= PERIOD_COL_END; c++) {
      const raw = resolveValue(ws, ws.getCell(dateRow, c));
      const iso = parseDateLoose(raw);
      if (iso) cols.push({ col: c, date: iso });
      else if (!isBlankish(raw)) warnings.push(`${ws.name} 시트 ${blockNo}번째 표: 날짜를 읽지 못함 (${ws.getCell(dateRow, c).address}: ${str(raw)})`);
    }
    // 이전 표보다 앞선 날짜로 시작하는 표는 지난 학기 잔재로 보고 건너뛴다
    if (cols.length && lastDate && cols[0].date < lastDate) {
      warnings.push(`${ws.name} 시트 ${blockNo}번째 표는 앞 표보다 이른 날짜(${cols[0].date})로 시작해 건너뜀`);
      continue;
    }
    // 학생 행
    const rows = [];
    for (let r = hdr + 2; r <= ws.rowCount; r++) {
      const seqRaw = resolveValue(ws, ws.getCell(r, 2));
      if (seqRaw == null || seqRaw === '' || isNaN(Number(seqRaw))) break;
      const school = str(resolveValue(ws, ws.getCell(r, 3)));
      const no = resolveValue(ws, ws.getCell(r, 4));
      const name = str(resolveValue(ws, ws.getCell(r, 5)));
      if (isBlankish(name) || isBlankish(school)) continue;
      const st = { school, no: isBlankish(no) ? '' : str(no), name };
      const key = model.studentKey(st);
      if (!studentIndex.has(key)) { studentIndex.set(key, st); subject.students.push(st); }
      rows.push({ row: r, key });
    }
    // 날짜별로 묶어 수업 생성
    const byDate = new Map();
    for (const c of cols) {
      if (!byDate.has(c.date)) byDate.set(c.date, { date: c.date, cols: [] });
      byDate.get(c.date).cols.push(c.col);
    }
    for (const { date, cols: dcols } of byDate.values()) {
      const existing = subject.sessions.find((s) => s.date === date);
      const session = existing || { date, periods: 0, marks: {} };
      const baseIdx = session.periods;
      session.periods += dcols.length;
      for (const { row, key } of rows) {
        const statuses = session.marks[key] ? session.marks[key].slice() : new Array(baseIdx).fill('P');
        dcols.forEach((col, i) => {
          const raw = resolveValue(ws, ws.getCell(row, col));
          let st = model.normalizeStatus(raw);
          if (st == null) {
            warnings.push(`${ws.name} 시트 ${ws.getCell(row, col).address}: 알 수 없는 표기 "${str(raw)}" → 출석으로 처리`);
            st = 'P';
          }
          statuses[baseIdx + i] = st;
        });
        session.marks[key] = statuses;
      }
      if (!existing) subject.sessions.push(session);
      if (!lastDate || date > lastDate) lastDate = date;
    }
  }
  subject.sessions.sort((a, b) => a.date.localeCompare(b.date));
  if (!subject.students.length) warnings.push(`${ws.name} 시트: 학생을 찾지 못함`);
  return subject;
}

// 워크북(버퍼) → 가져오기 초안
async function parseAttendanceWorkbook(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const warnings = [];
  const subjects = [];
  for (const ws of wb.worksheets) {
    if (TEMPLATE_SHEET_NAMES.includes(ws.name.trim())) continue;
    const s = parseSheet(ws, warnings);
    if (!s) { warnings.push(`${ws.name} 시트: 출석부 표를 찾지 못해 건너뜀`); continue; }
    if (subjects.some((x) => x.name === s.name)) {
      warnings.push(`${ws.name} 시트의 과목명 "${s.name}"이(가) 다른 시트와 겹쳐 "${s.name} (${ws.name})"으로 가져옵니다. 설정에서 과목명을 고쳐 주세요.`);
      s.name = `${s.name} (${ws.name})`;
    }
    subjects.push(s);
  }
  const dates = subjects.flatMap((s) => s.sessions.map((x) => x.date)).sort();
  let semester = { name: '', start: '', end: '', school: '강원온라인학교' };
  if (dates.length) {
    semester = Object.assign(semester, model.guessSemesterInfo(dates[0]));
    const title = subjects.map((s) => s.title).find((t) => t);
    if (title) {
      const m = title.match(/(\d{4})학년도\s*(\d)학기/);
      if (m) {
        const guessed = semester.name;
        const fromTitle = `${m[1]}학년도 ${m[2]}학기`;
        if (fromTitle !== guessed) warnings.push(`제목의 학기 표기(${fromTitle})와 날짜로 추정한 학기(${guessed})가 다릅니다. 확인 후 수정하세요.`);
      }
      const sm = title.match(/학기\s*(.+?)\s*출석부/);
      if (sm) semester.school = sm[1].trim();
    }
  }
  return { semester, subjects, warnings, sheetCount: wb.worksheets.length };
}

// 가져온 수업일에서 주간 시간표를 추정한다
function guessWeeklySchedule(sessions) {
  if (!sessions.length) return [];
  const weeks = new Set();
  const perDow = new Map(); // dow -> {count, periodsCounts:{}}
  for (const s of sessions) {
    const d = dow(s.date);
    const monday = addDays(s.date, -(d - 1));
    weeks.add(monday);
    if (!perDow.has(d)) perDow.set(d, { count: 0, periods: {} });
    const e = perDow.get(d);
    e.count += 1;
    e.periods[s.periods] = (e.periods[s.periods] || 0) + 1;
  }
  const weekCount = weeks.size;
  const out = [];
  for (const [d, e] of perDow) {
    if (e.count < Math.max(1, Math.ceil(weekCount * 0.4))) continue;
    const periods = Number(Object.entries(e.periods).sort((a, b) => b[1] - a[1])[0][0]);
    out.push({ dow: d, start: '', end: '', periods });
  }
  out.sort((a, b) => a.dow - b.dow);
  return out;
}

// 초안 → 학기 데이터
function buildSemesterFromImport(draft, { name, start, end, school, todayISO, defaultTeacher } = {}) {
  const sem = model.newSemester({
    name: name || draft.semester.name,
    start: start || draft.semester.start,
    end: end || draft.semester.end,
    school: school || draft.semester.school,
  });
  for (const ds of draft.subjects) {
    const sub = model.newSubject({ name: ds.name, credits: ds.credits, teacher: ds.teacher || defaultTeacher || '', memo: ds.memo });
    sub.sheetName = ds.sheetName;
    const keyToId = new Map();
    for (const st of ds.students) {
      const s = model.newStudent(st);
      sub.students.push(s);
      keyToId.set(model.studentKey(st), s.id);
    }
    sub.schedule = guessWeeklySchedule(ds.sessions);
    let last = null;
    for (const ses of ds.sessions) {
      sub.extras.push({ date: ses.date, periods: ses.periods, start: '', end: '', reason: '', source: 'import' });
      if (!last || ses.date > last) last = ses.date;
      const isPast = todayISO ? ses.date < todayISO : true;
      const marks = {};
      for (const [key, statuses] of Object.entries(ses.marks)) {
        const id = keyToId.get(key);
        if (!id) continue;
        const s = statuses.map((x) => (x === 'E' && !isPast ? 'W' : x));
        if (s.every((x) => x === 'P')) continue;
        marks[id] = { s, reason: '', docNo: '', docDate: '' };
      }
      if (isPast || Object.keys(marks).length) {
        sem.records[model.recordKey(sub.id, ses.date)] = {
          confirmed: isPast, confirmedAt: isPast ? new Date().toISOString() : null, marks, source: 'import',
        };
      }
    }
    sub.scheduleFrom = last ? addDays(last, 1) : null;
    sem.subjects.push(sub);
  }
  return sem;
}

module.exports = { parseAttendanceWorkbook, buildSemesterFromImport, guessWeeklySchedule, parseSheet };
