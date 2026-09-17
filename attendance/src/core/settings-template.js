'use strict';
// 설정 양식(xlsx) 만들기/읽기/적용
const ExcelJS = require('exceljs');
const { parseDateLoose, parseTimeLoose, parseDow, dowKoFromNum, isISODate } = require('./dates');
const { resolveValue, isBlankish } = require('./xlsx-util');
const model = require('./model');

const SHEETS = {
  guide: '안내', semester: '학기', subjects: '과목', schedule: '시간표', students: '학생',
  holidays: '휴업일', extras: '보강', events: '소속교행사',
};

const HEADERS = {
  semester: ['항목', '값'],
  subjects: ['과목명', '학점', '담당교사', '메모'],
  schedule: ['과목명', '요일', '시작시각', '종료시각', '차시수'],
  students: ['과목명', '소속교', '학번', '이름', '수강취소일'],
  holidays: ['날짜', '사유', '적용과목'],
  extras: ['과목명', '날짜', '차시수', '시작시각', '종료시각', '사유'],
  events: ['소속교', '날짜', '사유'],
};

const GUIDE_TEXT = [
  '출석부 앱 설정 양식',
  '',
  '1. 이 파일의 각 시트를 채운 뒤 앱의 [설정 > 학기·명단] 에서 업로드하면 설정이 반영됩니다.',
  '2. 첫 행(제목 행)은 지우지 마세요. 값은 2행부터 적습니다.',
  '3. 날짜는 2026-09-01 처럼 "연-월-일" 형식으로, 시각은 14:00 처럼 "시:분" 형식으로 적습니다.',
  '4. [학기] 시트: 학기명, 시작일, 종료일, 학교명(출석부 제목에 쓰임).',
  '5. [과목] 시트: 과목명은 다른 시트에서 과목을 가리키는 열쇠이므로 시트마다 똑같이 적어야 합니다.',
  '6. [시간표] 시트: 과목마다 수업 요일 한 줄씩. 하루 두 차시 연강이면 차시수를 2로 적습니다.',
  '   요일은 월, 화, 수, 목, 금, 토, 일 중 하나입니다.',
  '7. [학생] 시트: 과목별 수강생. 중간에 수강을 취소한 학생은 삭제하지 말고 수강취소일을 적으세요.',
  '8. [휴업일] 시트: 수업이 없는 날. 적용과목이 비어 있으면 모든 과목에 적용됩니다.',
  '   특정 과목만이면 과목명을 쉼표로 구분해 적습니다.',
  '9. [보강] 시트: 정규 요일 외에 추가로 수업한 날. 같은 날짜에 정규 수업이 있으면 보강 내용으로 대체됩니다.',
  '10. [소속교행사] 시트: 소속교의 시험·행사일. 그 학교 학생은 해당 날짜에 인정결석(대기)으로 자동 표시됩니다.',
  '11. 업로드하면 과목명과 학생(소속교·학번·이름)이 같은 항목은 기존 기록을 그대로 유지합니다.',
  '    양식에서 빠진 학생은 기록이 없으면 삭제되고, 기록이 있으면 수강취소 처리됩니다.',
];

function addTable(wb, name, headers, rows, widths) {
  const ws = wb.addWorksheet(name);
  ws.addRow(headers);
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7EEF7' } };
  for (const r of rows) ws.addRow(r);
  headers.forEach((h, i) => { ws.getColumn(i + 1).width = (widths && widths[i]) || 14; });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  return ws;
}

// 현재 학기 설정을 미리 채운 양식 워크북(버퍼)
async function buildSettingsTemplate(semester, settings = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = '출석부';
  const guide = wb.addWorksheet(SHEETS.guide);
  GUIDE_TEXT.forEach((t, i) => { const r = guide.addRow([t]); if (i === 0) r.font = { bold: true, size: 14 }; });
  guide.getColumn(1).width = 110;

  const sem = semester || model.newSemester();
  addTable(wb, SHEETS.semester, HEADERS.semester, [
    ['학기명', sem.name || ''], ['시작일', sem.start || ''], ['종료일', sem.end || ''],
    ['학교명', sem.school || settings.school || '강원온라인학교'], ['담당교사', settings.teacher || ''],
  ], [14, 30]);
  addTable(wb, SHEETS.subjects, HEADERS.subjects, sem.subjects.map((s) => [s.name, s.credits ?? '', s.teacher || '', s.memo || '']), [28, 8, 12, 50]);
  const schedRows = [];
  for (const s of sem.subjects) for (const e of s.schedule) schedRows.push([s.name, dowKoFromNum(Number(e.dow)), e.start || '', e.end || '', e.periods || 1]);
  addTable(wb, SHEETS.schedule, HEADERS.schedule, schedRows, [28, 8, 10, 10, 8]);
  const stuRows = [];
  for (const s of sem.subjects) for (const st of s.students) stuRows.push([s.name, st.school, st.no, st.name, st.dropDate || '']);
  addTable(wb, SHEETS.students, HEADERS.students, stuRows, [28, 20, 10, 12, 12]);
  const subjName = (id) => (sem.subjects.find((s) => s.id === id) || {}).name || '';
  addTable(wb, SHEETS.holidays, HEADERS.holidays, sem.holidays.map((h) => [h.date, h.reason || '', (h.subjectIds || []).map(subjName).filter(Boolean).join(', ')]), [12, 30, 40]);
  const extraRows = [];
  for (const s of sem.subjects) for (const x of s.extras) if (x.source !== 'import') extraRows.push([s.name, x.date, x.periods, x.start || '', x.end || '', x.reason || '']);
  addTable(wb, SHEETS.extras, HEADERS.extras, extraRows, [28, 12, 8, 10, 10, 30]);
  addTable(wb, SHEETS.events, HEADERS.events, sem.schoolEvents.map((e) => [e.school, e.date, e.reason || '']), [20, 12, 40]);
  // 학번은 문자열로 유지
  wb.getWorksheet(SHEETS.students).getColumn(3).numFmt = '@';
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function readRows(ws, expectedHeaders, warnings) {
  if (!ws) return [];
  const header = ws.getRow(1);
  const names = expectedHeaders.map((h, i) => String(resolveValue(ws, header.getCell(i + 1)) || '').trim());
  expectedHeaders.forEach((h, i) => { if (names[i] && names[i] !== h) warnings.push(`[${ws.name}] 시트 ${i + 1}번째 열 제목이 "${h}"가 아닙니다("${names[i]}"). 열 순서를 확인하세요.`); });
  const rows = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const vals = expectedHeaders.map((h, i) => resolveValue(ws, row.getCell(i + 1)));
    if (vals.every((v) => v == null || String(v).trim() === '')) continue;
    rows.push({ r, vals });
  }
  return rows;
}

function s(v) { return v == null ? '' : String(v).trim(); }

function dateOrWarn(v, where, warnings) {
  if (v == null || s(v) === '') return null;
  const iso = parseDateLoose(v);
  if (!iso) warnings.push(`${where}: 날짜 "${s(v)}"를 읽지 못했습니다.`);
  return iso;
}

// 업로드한 양식 워크북 → 설정 초안
async function parseSettingsTemplate(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const warnings = [];
  const get = (name) => wb.getWorksheet(name);
  if (!get(SHEETS.subjects) && !get(SHEETS.students)) {
    throw new Error('설정 양식이 아닙니다. [과목] 또는 [학생] 시트가 없습니다.');
  }
  const out = { semester: {}, subjects: [], holidays: [], schoolEvents: [], warnings, settings: {} };

  for (const { vals } of readRows(get(SHEETS.semester), HEADERS.semester, warnings)) {
    const k = s(vals[0]); const v = vals[1];
    if (k === '학기명') out.semester.name = s(v);
    else if (k === '시작일') out.semester.start = dateOrWarn(v, '[학기] 시작일', warnings);
    else if (k === '종료일') out.semester.end = dateOrWarn(v, '[학기] 종료일', warnings);
    else if (k === '학교명') out.semester.school = s(v);
    else if (k === '담당교사') out.settings.teacher = s(v);
  }
  const subjByName = new Map();
  const ensureSubject = (name, where) => {
    const n = s(name);
    if (!n) return null;
    if (!subjByName.has(n)) {
      if (where) warnings.push(`${where}: [과목] 시트에 없는 과목 "${n}"이(가) 있어 과목을 새로 추가합니다.`);
      const sub = { name: n, credits: null, teacher: '', memo: '', schedule: [], students: [], extras: [] };
      subjByName.set(n, sub); out.subjects.push(sub);
    }
    return subjByName.get(n);
  };
  for (const { r, vals } of readRows(get(SHEETS.subjects), HEADERS.subjects, warnings)) {
    const sub = ensureSubject(vals[0]);
    if (!sub) { warnings.push(`[과목] ${r}행: 과목명이 비어 있어 건너뜀`); continue; }
    sub.credits = model.parseCredits(vals[1]);
    sub.teacher = s(vals[2]); sub.memo = s(vals[3]);
  }
  for (const { r, vals } of readRows(get(SHEETS.schedule), HEADERS.schedule, warnings)) {
    const sub = ensureSubject(vals[0], `[시간표] ${r}행`);
    if (!sub) { warnings.push(`[시간표] ${r}행: 과목명이 비어 있어 건너뜀`); continue; }
    const dow = parseDow(vals[1]);
    if (!dow) { warnings.push(`[시간표] ${r}행: 요일 "${s(vals[1])}"을 읽지 못해 건너뜀`); continue; }
    const start = parseTimeLoose(vals[2]); const end = parseTimeLoose(vals[3]);
    if (s(vals[2]) && !start) warnings.push(`[시간표] ${r}행: 시작시각 "${s(vals[2])}"을 읽지 못함`);
    if (s(vals[3]) && !end) warnings.push(`[시간표] ${r}행: 종료시각 "${s(vals[3])}"을 읽지 못함`);
    const periods = Math.max(1, Math.round(Number(vals[4]) || 1));
    sub.schedule.push({ dow, start: start || '', end: end || '', periods });
  }
  for (const { r, vals } of readRows(get(SHEETS.students), HEADERS.students, warnings)) {
    const sub = ensureSubject(vals[0], `[학생] ${r}행`);
    if (!sub) { warnings.push(`[학생] ${r}행: 과목명이 비어 있어 건너뜀`); continue; }
    const st = { school: s(vals[1]), no: isBlankish(vals[2]) && s(vals[2]) !== '0' ? s(vals[2]) : s(vals[2]), name: s(vals[3]), dropDate: dateOrWarn(vals[4], `[학생] ${r}행 수강취소일`, warnings) };
    if (!st.name) { warnings.push(`[학생] ${r}행: 이름이 비어 있어 건너뜀`); continue; }
    if (sub.students.some((x) => model.studentKey(x) === model.studentKey(st))) { warnings.push(`[학생] ${r}행: 같은 학생이 중복되어 건너뜀 (${st.school} ${st.no} ${st.name})`); continue; }
    sub.students.push(st);
  }
  for (const { r, vals } of readRows(get(SHEETS.holidays), HEADERS.holidays, warnings)) {
    const date = dateOrWarn(vals[0], `[휴업일] ${r}행`, warnings);
    if (!date) continue;
    const names = s(vals[2]) ? s(vals[2]).split(/[,，、]/).map((x) => x.trim()).filter(Boolean) : [];
    for (const n of names) if (!subjByName.has(n)) warnings.push(`[휴업일] ${r}행: 과목 "${n}"을 찾지 못해 무시`);
    out.holidays.push({ date, reason: s(vals[1]), subjectNames: names.filter((n) => subjByName.has(n)) });
  }
  for (const { r, vals } of readRows(get(SHEETS.extras), HEADERS.extras, warnings)) {
    const sub = ensureSubject(vals[0], `[보강] ${r}행`);
    const date = dateOrWarn(vals[1], `[보강] ${r}행`, warnings);
    if (!sub || !date) continue;
    sub.extras.push({ date, periods: Math.max(1, Math.round(Number(vals[2]) || 1)), start: parseTimeLoose(vals[3]) || '', end: parseTimeLoose(vals[4]) || '', reason: s(vals[5]), source: 'manual' });
  }
  for (const { r, vals } of readRows(get(SHEETS.events), HEADERS.events, warnings)) {
    const date = dateOrWarn(vals[1], `[소속교행사] ${r}행`, warnings);
    if (!date || !s(vals[0])) { if (!s(vals[0])) warnings.push(`[소속교행사] ${r}행: 소속교가 비어 있어 건너뜀`); continue; }
    out.schoolEvents.push({ school: s(vals[0]), date, reason: s(vals[2]) });
  }
  return out;
}

// 초안을 학기에 적용 (id와 기록 보존). 반환: 변경 요약
function applySettings(semester, parsed, { todayISO } = {}) {
  const summary = { subjectsAdded: [], subjectsRemoved: [], studentsAdded: 0, studentsRemoved: 0, studentsDropped: [], warnings: [...parsed.warnings] };
  if (parsed.semester.name) semester.name = parsed.semester.name;
  if (parsed.semester.start && isISODate(parsed.semester.start)) semester.start = parsed.semester.start;
  if (parsed.semester.end && isISODate(parsed.semester.end)) semester.end = parsed.semester.end;
  if (parsed.semester.school) semester.school = parsed.semester.school;

  const kept = [];
  for (const ps of parsed.subjects) {
    let sub = semester.subjects.find((x) => x.name === ps.name);
    if (!sub) { sub = model.newSubject({ name: ps.name }); summary.subjectsAdded.push(ps.name); }
    sub.credits = ps.credits; sub.teacher = ps.teacher; sub.memo = ps.memo;
    sub.schedule = ps.schedule.map((e) => ({ ...e }));
    // 보강: 가져온 수업(import)은 유지, 수동 보강은 양식 내용으로 교체
    sub.extras = sub.extras.filter((x) => x.source === 'import').concat(ps.extras);
    // 학생 병합
    const newStudents = [];
    for (const pst of ps.students) {
      const key = model.studentKey(pst);
      let st = sub.students.find((x) => model.studentKey(x) === key)
        || sub.students.find((x) => x.name === pst.name && x.school === pst.school && (!x.no || !pst.no));
      if (!st) { st = model.newStudent(pst); summary.studentsAdded += 1; }
      else { st.school = pst.school; st.no = pst.no; st.name = pst.name; }
      st.dropDate = pst.dropDate || null;
      newStudents.push(st);
    }
    for (const old of sub.students) {
      if (newStudents.includes(old)) continue;
      const hasRecords = Object.entries(semester.records).some(([k, r]) => k.startsWith(sub.id + '|') && r.marks && r.marks[old.id]);
      if (hasRecords) {
        old.dropDate = old.dropDate || todayISO || new Date().toISOString().slice(0, 10);
        newStudents.push(old);
        summary.studentsDropped.push(`${sub.name} ${old.name}`);
      } else summary.studentsRemoved += 1;
    }
    sub.students = newStudents;
    kept.push(sub);
  }
  for (const old of semester.subjects) {
    if (kept.includes(old)) continue;
    const hasRecords = Object.keys(semester.records).some((k) => k.startsWith(old.id + '|'));
    if (hasRecords) { kept.push(old); summary.warnings.push(`과목 "${old.name}"은 양식에 없지만 출결 기록이 있어 유지했습니다. 삭제하려면 설정 화면에서 직접 삭제하세요.`); }
    else summary.subjectsRemoved.push(old.name);
  }
  semester.subjects = kept;
  const idByName = new Map(kept.map((x) => [x.name, x.id]));
  semester.holidays = parsed.holidays.map((h) => ({ id: model.newId('hol'), date: h.date, reason: h.reason, subjectIds: h.subjectNames.length ? h.subjectNames.map((n) => idByName.get(n)).filter(Boolean) : null }));
  semester.schoolEvents = parsed.schoolEvents.map((e) => ({ id: model.newId('evt'), school: e.school, date: e.date, reason: e.reason }));
  return summary;
}

module.exports = { buildSettingsTemplate, parseSettingsTemplate, applySettings, SHEETS, HEADERS };
