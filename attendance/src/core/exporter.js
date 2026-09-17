'use strict';
// 출석부 xlsx 내보내기: 양식 시트의 구조를 읽어 그대로 채운다
const path = require('path');
const ExcelJS = require('exceljs');
const { registerMatrix } = require('./marks');
const { STATUS_SYMBOL } = require('./model');
const { resolveValue } = require('./xlsx-util');

const DEFAULT_TEMPLATE_PATH = path.join(__dirname, '..', '..', 'resources', 'template.xlsx');
const TEMPLATE_SHEET_NAMES = ['양식', '서식', 'template', 'Template'];
const PENDING_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2A8' } };
const UNCONFIRMED_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8D0D0' } };

function str(v) { return v == null ? '' : String(v).trim(); }

function pickTemplateSheet(wb) {
  return wb.worksheets.find((w) => TEMPLATE_SHEET_NAMES.includes(w.name.trim())) || wb.worksheets[0] || null;
}

// 양식 시트 구조 분석
// 반환: {headerRows, stride, studentRows, periodCols:{start,end,count}, cols:{seq,school,no,name}, subjectRow, subjectCols:{name,credits,teacher}, titleRow, titleCol, memo:{row,col}|null, errors[]}
function detectLayout(ws) {
  const errors = [];
  const headerRows = [];
  ws.eachRow((row, r) => {
    const b = str(resolveValue(ws, row.getCell(2)));
    let seqCol = null;
    for (let c = 1; c <= Math.min(ws.columnCount || 10, 10); c++) if (str(resolveValue(ws, row.getCell(c))) === '연번') { seqCol = c; break; }
    if (seqCol && headerRows[headerRows.length - 1] !== r - 1 && (headerRows.length === 0 || headerRows[headerRows.length - 1].row !== r - 1)) headerRows.push({ row: r, seqCol });
    void b;
  });
  // 병합(B7:B8)으로 인한 연속 행 제거
  const hdrs = [];
  for (const h of headerRows) if (!hdrs.length || hdrs[hdrs.length - 1].row !== h.row - 1) hdrs.push(h);
  if (!hdrs.length) { errors.push('"연번" 제목 칸을 찾지 못했습니다. 출석부 표 첫 열 제목이 "연번"이어야 합니다.'); return { errors }; }
  const first = hdrs[0];
  const hdrRow = ws.getRow(first.row);
  const cols = { seq: first.seqCol, school: null, no: null, name: null };
  const periodColsList = [];
  for (let c = 1; c <= (ws.columnCount || 40); c++) {
    const t = str(resolveValue(ws, hdrRow.getCell(c)));
    if (t === '소속교' || t === '학교') cols.school = c;
    else if (t === '학번') cols.no = c;
    else if (t === '이름' || t === '성명') cols.name = c;
    else if (/^\d+\s*차시$/.test(t)) periodColsList.push(c);
  }
  if (!cols.name) errors.push('"이름" 열을 찾지 못했습니다.');
  if (!periodColsList.length) errors.push('"1차시" 같은 차시 열 제목을 찾지 못했습니다.');
  if (errors.length) return { errors };
  const periodCols = { start: periodColsList[0], end: periodColsList[periodColsList.length - 1], count: periodColsList.length };
  if (periodCols.end - periodCols.start + 1 !== periodCols.count) errors.push('차시 열이 연속되어 있지 않습니다.');
  const stride = hdrs.length > 1 ? hdrs[1].row - hdrs[0].row : null;
  for (let i = 2; i < hdrs.length; i++) if (hdrs[i].row - hdrs[i - 1].row !== stride) errors.push('표 사이의 간격이 일정하지 않습니다.');
  // 학생 행 수: 다음 표 제목 위까지 번호가 이어지는 행
  let studentRows = 0;
  for (let r = first.row + 2; r <= ws.rowCount; r++) {
    const v = resolveValue(ws, ws.getCell(r, cols.seq));
    if (v == null || v === '' || isNaN(Number(v))) break;
    studentRows += 1;
  }
  if (!studentRows) errors.push('학생 행(연번 1, 2, 3…)을 찾지 못했습니다.');
  // 과목/학점/담당교사 위치: 제목 행 위쪽에서 라벨 찾기
  const subjectCols = { name: null, credits: null, teacher: null };
  let subjectRow = null;
  for (let r = first.row - 1; r >= Math.max(1, first.row - 6) && !subjectRow; r--) {
    const row = ws.getRow(r);
    for (let c = 1; c <= (ws.columnCount || 40); c++) {
      const t = str(resolveValue(ws, row.getCell(c)));
      if (t === '수업' || t === '과목' || t === '과목명') { subjectCols.name = c; subjectRow = r + 1; }
      else if (t === '학점') subjectCols.credits = c;
      else if (t === '담당교사' || t === '교사') subjectCols.teacher = c;
    }
  }
  // 제목: 헤더 위쪽에서 "출석부"가 들어간 셀
  let titleRow = null; let titleCol = null;
  for (let r = first.row - 1; r >= 1 && titleRow == null; r--) {
    const row = ws.getRow(r);
    for (let c = 1; c <= (ws.columnCount || 40); c++) {
      const t = str(resolveValue(ws, row.getCell(c)));
      if (t.includes('출석부')) { titleRow = r; titleCol = c; break; }
    }
  }
  // 메모 칸: 날짜 행에서 차시 열 오른쪽에 있는 병합 영역의 시작 셀
  // (첫 표에 없고 다른 표에만 병합이 있으면 그 위치를 첫 표 기준으로 옮겨 쓴다)
  let memo = null;
  const dateRow = first.row + 1;
  for (const m of (ws.model.merges || [])) {
    const mm = m.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
    if (!mm) continue;
    const r1 = Number(mm[2]); const r2 = Number(mm[4]); const c1 = colNum(mm[1]);
    if (c1 <= periodCols.end + 1) continue;
    const blockOffset = r1 - dateRow;
    if (blockOffset === 0 || (stride && blockOffset > 0 && blockOffset % stride === 0)) {
      memo = { row: dateRow, col: c1, mergeRange: blockOffset === 0 ? null : `${mm[1]}${dateRow}:${mm[3]}${r2 - blockOffset}` };
      if (blockOffset === 0) break;
    }
  }
  const blockStart = titleRow != null ? titleRow - 1 : first.row - 6; // 블록 복제 시 첫 행(여백 포함)
  return { errors, headerRows: hdrs.map((h) => h.row), stride, studentRows, periodCols, cols, subjectRow, subjectCols, titleRow, titleCol, memo, blockStart: Math.max(1, blockStart), blocks: hdrs.length };
}

function colNum(letters) { let n = 0; for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64); return n; }

function layoutSummary(L) {
  if (!L || L.errors.length) return '';
  return `표 ${L.blocks}개 × ${L.periodCols.count}차시, 학생 ${L.studentRows}명/표${L.memo ? ', 비고 칸 있음' : ''}`;
}

// 업로드한 양식 파일 검사
async function inspectTemplate(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = pickTemplateSheet(wb);
  if (!ws) return { ok: false, errors: ['시트가 없습니다.'] };
  const L = detectLayout(ws);
  return { ok: L.errors.length === 0, errors: L.errors, sheet: ws.name, sheets: wb.worksheets.map((w) => w.name), summary: layoutSummary(L), layout: L.errors.length ? null : { blocks: L.blocks, periods: L.periodCols.count, studentRows: L.studentRows, stride: L.stride, memo: !!L.memo } };
}

function safeSheetName(name, used) {
  const base = String(name || '과목').replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 28) || '과목';
  let n = base; let i = 2;
  while (used.has(n)) { n = `${base}(${i})`; i += 1; }
  used.add(n);
  return n;
}

function copyRowStyles(ws, fromRow, toRow, colCount) {
  const src = ws.getRow(fromRow); const dst = ws.getRow(toRow);
  dst.height = src.height;
  for (let c = 1; c <= colCount; c++) {
    const sc = src.getCell(c); const dc = dst.getCell(c);
    dc.style = JSON.parse(JSON.stringify(sc.style || {}));
    if (sc.value != null && typeof sc.value !== 'object') dc.value = sc.value;
  }
}

// 표가 모자라면 마지막 표를 복제한다
function ensureBlocks(ws, merges, L, blocksNeeded, colCount) {
  if (!L.stride) return;
  for (let b = L.blocks; b < blocksNeeded; b++) {
    const srcStart = L.blockStart + (b - 1) * L.stride;
    const dstStart = L.blockStart + b * L.stride;
    for (let i = 0; i < L.stride; i++) copyRowStyles(ws, srcStart + i, dstStart + i, colCount);
    for (const m of merges) {
      const mm = m.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
      if (!mm) continue;
      const r1 = Number(mm[2]); const r2 = Number(mm[4]);
      if (r1 >= srcStart && r2 < srcStart + L.stride) {
        try { ws.mergeCells(`${mm[1]}${r1 + L.stride}:${mm[3]}${r2 + L.stride}`); } catch { /* 이미 병합됨 */ }
      }
    }
  }
}

function fillSheet(ws, tplMerges, L, semester, subject, matrix, opts) {
  const { todayISO, presentSymbol = 'O' } = opts;
  for (const m of tplMerges) { try { ws.mergeCells(m); } catch { /* ignore */ } }
  if (L.memo && L.memo.mergeRange) { try { ws.mergeCells(L.memo.mergeRange); } catch { /* ignore */ } }
  const cols = matrix.columns;
  const perBlock = L.periodCols.count;
  const blocksNeeded = L.stride ? Math.max(L.blocks, Math.ceil(cols.length / perBlock)) : L.blocks;
  if (!L.stride && cols.length > perBlock * L.blocks) opts.warnings.push(`${subject.name}: 양식에 표가 하나뿐이라 ${perBlock}차시까지만 출력됩니다.`);
  ensureBlocks(ws, tplMerges, L, blocksNeeded, ws.columnCount || 30);
  const title = `${semester.name} ${semester.school} 출석부`.trim();
  const students = matrix.students;
  if (students.length > L.studentRows) opts.warnings.push(`${subject.name}: 학생이 ${students.length}명이라 양식의 ${L.studentRows}행을 넘는 학생은 출력되지 않습니다.`);
  const memoLines = [];
  if (subject.memo) memoLines.push(subject.memo);
  const evs = semester.schoolEvents.filter((e) => (!e.names || !e.names.length) && subject.students.some((s) => s.school === e.school));
  const bySchool = new Map();
  for (const e of evs) { if (!bySchool.has(e.school)) bySchool.set(e.school, []); bySchool.get(e.school).push(e); }
  for (const [school, list] of bySchool) {
    memoLines.push(`[${school}]`);
    for (const e of list.sort((a, b) => a.date.localeCompare(b.date))) {
      const d = (iso) => `${Number(iso.slice(5, 7))}.${Number(iso.slice(8, 10))}.`;
      memoLines.push(`${d(e.date)}${e.to && e.to !== e.date ? '~' + d(e.to) : ''} ${e.reason || ''}`.trim());
    }
  }

  for (let b = 0; b < blocksNeeded; b++) {
    const off = b * (L.stride || 0);
    const hdr = L.headerRows[0] + off;
    if (L.titleRow != null) ws.getCell(L.titleRow + off, L.titleCol).value = title;
    if (L.subjectRow != null) {
      if (L.subjectCols.name) ws.getCell(L.subjectRow + off, L.subjectCols.name).value = subject.name;
      if (L.subjectCols.credits) ws.getCell(L.subjectRow + off, L.subjectCols.credits).value = subject.credits == null ? null : Number(subject.credits);
      if (L.subjectCols.teacher) ws.getCell(L.subjectRow + off, L.subjectCols.teacher).value = subject.teacher || '';
    }
    if (b === 0 && L.memo) ws.getCell(L.memo.row, L.memo.col).value = memoLines.join('\n');
    students.slice(0, L.studentRows).forEach((st, i) => {
      const r = hdr + 2 + i;
      ws.getCell(r, L.cols.seq).value = i + 1;
      if (L.cols.school) ws.getCell(r, L.cols.school).value = st.school;
      if (L.cols.no) { ws.getCell(r, L.cols.no).value = st.no === '' ? null : st.no; ws.getCell(r, L.cols.no).numFmt = '@'; }
      ws.getCell(r, L.cols.name).value = st.name;
    });
    for (let p = 0; p < perBlock; p++) {
      const idx = b * perBlock + p;
      const c = L.periodCols.start + p;
      ws.getCell(hdr, c).value = `${idx + 1}차시`;
      const col = cols[idx];
      const dateCell = ws.getCell(hdr + 1, c);
      if (!col) { dateCell.value = null; for (let i = 0; i < Math.min(students.length, L.studentRows); i++) ws.getCell(hdr + 2 + i, c).value = null; continue; }
      const [y, m, d] = col.date.split('-').map(Number);
      dateCell.value = new Date(Date.UTC(y, m - 1, d));
      const isPastUnconfirmed = !col.confirmed && todayISO && col.date <= todayISO;
      if (isPastUnconfirmed) dateCell.fill = UNCONFIRMED_FILL;
      students.slice(0, L.studentRows).forEach((st, i) => {
        const cell = ws.getCell(hdr + 2 + i, c);
        const cellInfo = col.cells.find((x) => x.studentId === st.id);
        if (!cellInfo || !cellInfo.enrolled || !col.confirmed) { cell.value = null; return; }
        const sym = STATUS_SYMBOL[cellInfo.status] || '';
        cell.value = cellInfo.status === 'P' ? presentSymbol : sym;
        if (cellInfo.status === 'W') cell.fill = PENDING_FILL;
      });
    }
  }
  if (L.stride) {
    for (let b = 1; b < blocksNeeded; b++) ws.getRow(L.blockStart + b * L.stride - 1).addPageBreak();
    ws.pageSetup.printArea = `A1:${colLetters(ws.columnCount || 30)}${L.blockStart + blocksNeeded * L.stride - 1}`;
  }
}

function colLetters(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }

// 출석부 워크북(버퍼) 생성
async function buildRegisterWorkbook(semester, { todayISO, subjectIds, presentSymbol = 'O', templatePath = DEFAULT_TEMPLATE_PATH } = {}) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(templatePath);
  const tpl = pickTemplateSheet(wb);
  if (!tpl) throw new Error('양식 시트를 찾을 수 없습니다.');
  const L = detectLayout(tpl);
  if (L.errors.length) throw new Error(`출석부 양식을 읽지 못했습니다: ${L.errors.join(' ')}`);
  const tplMerges = tpl.model.merges.slice();
  const originalIds = wb.worksheets.map((w) => w.id);
  // 양식 파일에 든 기존 시트와 과목 시트 이름이 겹치지 않도록 임시 이름으로 바꾼다
  wb.worksheets.forEach((w, i) => { w.name = `__tpl${i}`; });
  const subjects = semester.subjects.filter((s) => !subjectIds || subjectIds.includes(s.id));
  const used = new Set();
  const warnings = [];
  const stats = [];
  for (const subject of subjects) {
    const matrix = registerMatrix(semester, subject, { todayISO });
    const name = safeSheetName(subject.sheetName || subject.name, used);
    const ws = wb.addWorksheet(name);
    ws.model = Object.assign({}, tpl.model, { name, id: ws.id, merges: [] });
    ws.name = name;
    fillSheet(ws, tplMerges, L, semester, subject, matrix, { todayISO, presentSymbol, warnings });
    const pending = matrix.columns.reduce((a, c) => a + c.cells.filter((x) => x.status === 'W').length, 0);
    const unconfirmed = matrix.sessions.filter((s) => todayISO && s.date <= todayISO && !matrix.columns.find((c) => c.date === s.date).confirmed).length;
    stats.push({ subject: subject.name, sheet: name, periods: matrix.columns.length, pending, unconfirmed });
  }
  for (const id of originalIds) wb.removeWorksheet(id);
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer, warnings, stats, layout: layoutSummary(L) };
}

// 내보내기 전 점검 (대기/미확정 건수)
function exportPrecheck(semester, { todayISO } = {}) {
  const out = [];
  for (const subject of semester.subjects) {
    const matrix = registerMatrix(semester, subject, { todayISO });
    const pending = matrix.columns.reduce((a, c) => a + c.cells.filter((x) => x.status === 'W').length, 0);
    const unconfirmed = matrix.sessions.filter((s) => todayISO && s.date <= todayISO && !matrix.columns.find((c) => c.date === s.date).confirmed).length;
    out.push({ subjectId: subject.id, subject: subject.name, periods: matrix.columns.length, pending, unconfirmed });
  }
  return out;
}

module.exports = { buildRegisterWorkbook, exportPrecheck, detectLayout, inspectTemplate, layoutSummary, DEFAULT_TEMPLATE_PATH, TEMPLATE_PATH: DEFAULT_TEMPLATE_PATH };
