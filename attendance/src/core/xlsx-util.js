'use strict';
// exceljs 셀 값 정규화 도우미

function cellText(v) {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if (v.error) return '';
    if (v.text != null) return String(v.text);
    if (v instanceof Date) return v.toISOString();
    if ('result' in v) return cellText(v.result);
    return '';
  }
  return String(v);
}

// 단순 참조 수식(=C9)은 원본 셀을 따라간다. 그 외 수식은 캐시된 결과를 사용한다.
function resolveValue(ws, cell, depth = 0) {
  const v = cell.value;
  if (v == null) return null;
  if (typeof v === 'object' && !(v instanceof Date)) {
    if (v.error) return null;
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if (v.formula || v.sharedFormula) {
      const f = String(v.formula || '').replace(/^=/, '').trim();
      const m = f.match(/^\$?([A-Z]{1,3})\$?(\d+)$/);
      if (m && depth < 10) {
        try { return resolveValue(ws, ws.getCell(`${m[1]}${m[2]}`), depth + 1); } catch { /* fallthrough */ }
      }
      if (v.result == null) return null;
      if (typeof v.result === 'object' && v.result.error) return null;
      return v.result;
    }
    if (v.hyperlink) return v.text ?? null;
    return null;
  }
  return v;
}

function isBlankish(v) {
  if (v == null) return true;
  if (typeof v === 'number') return v === 0;
  const s = String(v).trim();
  return s === '' || s === '0' || s.startsWith('#');
}

module.exports = { cellText, resolveValue, isBlankish };
