'use strict';
// 출석부 xlsx 내보내기 (기존 양식 그대로)
const path = require('path');
const ExcelJS = require('exceljs');
const { registerMatrix } = require('./marks');
const { STATUS_SYMBOL } = require('./model');

const TEMPLATE_PATH = path.join(__dirname, '..', '..', 'resources', 'template.xlsx');
const BLOCK_ROWS = 35;           // 한 표(페이지)의 높이
const BLOCK_TITLE_ROW = 2;       // 첫 블록 기준
const BLOCK_HEADER_ROW = 7;
const BLOCK_STUDENT_ROWS = 25;
const PERIODS_PER_BLOCK = 17;
const PERIOD_COL_START = 6;      // F
const TEMPLATE_BLOCKS = 4;
const PENDING_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2A8' } };
const UNCONFIRMED_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8D0D0' } };

function safeSheetName(name, used) {
  let base = String(name || '과목').replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 28) || '과목';
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

// 블록 수가 4개를 넘으면 마지막 블록을 복제한다
function ensureBlocks(ws, merges, blocksNeeded, colCount) {
  for (let b = TEMPLATE_BLOCKS; b < blocksNeeded; b++) {
    const srcStart = (b - 1) * BLOCK_ROWS + 1; // 이전 블록의 첫 행(제목 위 여백 포함)
    const dstStart = b * BLOCK_ROWS + 1;
    for (let i = 0; i < BLOCK_ROWS; i++) copyRowStyles(ws, srcStart + i, dstStart + i, colCount);
    for (const m of merges) {
      const mm = m.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
      if (!mm) continue;
      const r1 = Number(mm[2]); const r2 = Number(mm[4]);
      if (r1 >= srcStart && r2 < srcStart + BLOCK_ROWS) {
        try { ws.mergeCells(`${mm[1]}${r1 + BLOCK_ROWS}:${mm[3]}${r2 + BLOCK_ROWS}`); } catch { /* 이미 병합됨 */ }
      }
    }
  }
}

function fillSheet(ws, tplMerges, semester, subject, matrix, opts) {
  const { todayISO, presentSymbol = 'O' } = opts;
  for (const m of tplMerges) { try { ws.mergeCells(m); } catch { /* ignore */ } }
  const cols = matrix.columns;
  const blocksNeeded = Math.max(TEMPLATE_BLOCKS, Math.ceil(cols.length / PERIODS_PER_BLOCK));
  ensureBlocks(ws, tplMerges, blocksNeeded, ws.columnCount || 29);
  const title = `${semester.name} ${semester.school} 출석부`.trim();
  const students = matrix.students;
  if (students.length > BLOCK_STUDENT_ROWS) opts.warnings.push(`${subject.name}: 학생이 ${students.length}명이라 양식의 ${BLOCK_STUDENT_ROWS}행을 넘는 학생은 출력되지 않습니다.`);
  const memoLines = [];
  if (subject.memo) memoLines.push(subject.memo);
  const evs = semester.schoolEvents.filter((e) => subject.students.some((s) => s.school === e.school));
  const bySchool = new Map();
  for (const e of evs) { if (!bySchool.has(e.school)) bySchool.set(e.school, []); bySchool.get(e.school).push(e); }
  for (const [school, list] of bySchool) {
    memoLines.push(`[${school}]`);
    for (const e of list.sort((a, b) => a.date.localeCompare(b.date))) memoLines.push(`${Number(e.date.slice(5, 7))}.${Number(e.date.slice(8, 10))}. ${e.reason || ''}`.trim());
  }

  for (let b = 0; b < blocksNeeded; b++) {
    const off = b * BLOCK_ROWS;
    ws.getCell(BLOCK_TITLE_ROW + off, 3).value = title;
    ws.getCell(BLOCK_TITLE_ROW + 3 + off, 2).value = subject.name;
    ws.getCell(BLOCK_TITLE_ROW + 3 + off, 4).value = subject.credits == null ? null : Number(subject.credits);
    ws.getCell(BLOCK_TITLE_ROW + 3 + off, 6).value = subject.teacher || '';
    const hdr = BLOCK_HEADER_ROW + off;
    if (b === 0) ws.getCell(hdr + 1, 24).value = memoLines.join('\n');
    students.slice(0, BLOCK_STUDENT_ROWS).forEach((st, i) => {
      const r = hdr + 2 + i;
      ws.getCell(r, 2).value = i + 1;
      ws.getCell(r, 3).value = st.school;
      ws.getCell(r, 4).value = st.no === '' ? null : (/^\d+$/.test(st.no) ? st.no : st.no);
      ws.getCell(r, 4).numFmt = '@';
      ws.getCell(r, 5).value = st.name;
    });
    for (let p = 0; p < PERIODS_PER_BLOCK; p++) {
      const idx = b * PERIODS_PER_BLOCK + p;
      const c = PERIOD_COL_START + p;
      ws.getCell(hdr, c).value = `${idx + 1}차시`;
      const col = cols[idx];
      const dateCell = ws.getCell(hdr + 1, c);
      if (!col) { dateCell.value = null; continue; }
      const [y, m, d] = col.date.split('-').map(Number);
      dateCell.value = new Date(Date.UTC(y, m - 1, d));
      const isPastUnconfirmed = !col.confirmed && todayISO && col.date <= todayISO;
      if (isPastUnconfirmed) dateCell.fill = UNCONFIRMED_FILL;
      students.slice(0, BLOCK_STUDENT_ROWS).forEach((st, i) => {
        const cell = ws.getCell(hdr + 2 + i, c);
        const cellInfo = col.cells.find((x) => x.studentId === st.id);
        if (!cellInfo || !cellInfo.enrolled || !col.confirmed) { cell.value = null; return; }
        const sym = STATUS_SYMBOL[cellInfo.status] || '';
        cell.value = cellInfo.status === 'P' ? presentSymbol : sym;
        if (cellInfo.status === 'W') cell.fill = PENDING_FILL;
      });
    }
  }
  // 페이지 나누기
  for (let b = 1; b < blocksNeeded; b++) ws.getRow(b * BLOCK_ROWS).addPageBreak();
  ws.pageSetup.printArea = `A1:AD${blocksNeeded * BLOCK_ROWS}`;
}

// 출석부 워크북(버퍼) 생성
async function buildRegisterWorkbook(semester, { todayISO, subjectIds, presentSymbol = 'O', templatePath = TEMPLATE_PATH } = {}) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(templatePath);
  const tpl = wb.getWorksheet('양식');
  if (!tpl) throw new Error('양식 시트를 찾을 수 없습니다.');
  const tplMerges = tpl.model.merges.slice();
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
    fillSheet(ws, tplMerges, semester, subject, matrix, { todayISO, presentSymbol, warnings });
    const pending = matrix.columns.reduce((a, c) => a + c.cells.filter((x) => x.status === 'W').length, 0);
    const unconfirmed = matrix.sessions.filter((s) => todayISO && s.date <= todayISO && !matrix.columns.find((c) => c.date === s.date).confirmed).length;
    stats.push({ subject: subject.name, sheet: name, periods: matrix.columns.length, pending, unconfirmed });
  }
  wb.removeWorksheet(tpl.id);
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer, warnings, stats };
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

module.exports = { buildRegisterWorkbook, exportPrecheck, TEMPLATE_PATH };
