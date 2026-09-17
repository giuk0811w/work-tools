'use strict';
// 날짜는 항상 "YYYY-MM-DD" 문자열(로컬 기준)로 다룬다.

const DOW_KO = ['일', '월', '화', '수', '목', '금', '토'];

function pad2(n) { return String(n).padStart(2, '0'); }

function toISO(d) {
  if (typeof d === 'string') return d.slice(0, 10);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function fromISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function isISODate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = fromISO(s);
  return toISO(d) === s;
}

function today() { return toISO(new Date()); }

function addDays(iso, n) {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

// 1=월 ... 7=일
function dow(iso) {
  const js = fromISO(iso).getDay();
  return js === 0 ? 7 : js;
}

function dowKo(iso) { return DOW_KO[fromISO(iso).getDay()]; }

function dowKoFromNum(n) { return DOW_KO[n % 7]; }

function fmtKo(iso, withDow = true) {
  const d = fromISO(iso);
  const base = `${d.getMonth() + 1}월 ${d.getDate()}일`;
  return withDow ? `${base}(${DOW_KO[d.getDay()]})` : base;
}

function fmtKoFull(iso) {
  const d = fromISO(iso);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${DOW_KO[d.getDay()]})`;
}

// "HH:MM" -> 분
function toMinutes(hhmm) {
  if (!hhmm || typeof hhmm !== 'string') return null;
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function fromMinutes(min) {
  if (min == null) return '';
  return `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;
}

function nowHHMM(d = new Date()) { return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }

// 엑셀 등에서 들어오는 다양한 날짜 표현을 ISO로 정규화. 실패하면 null.
function parseDateLoose(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    // exceljs는 날짜를 UTC 자정으로 읽는 경우가 있어 UTC 성분을 우선 사용한다.
    if (v.getUTCHours() === 0 && v.getUTCMinutes() === 0) {
      return `${v.getUTCFullYear()}-${pad2(v.getUTCMonth() + 1)}-${pad2(v.getUTCDate())}`;
    }
    return toISO(v);
  }
  if (typeof v === 'number') {
    // 엑셀 일련번호
    if (v > 20000 && v < 80000) {
      const ms = Math.round((v - 25569) * 86400 * 1000);
      const d = new Date(ms);
      return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
    }
    return null;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-./년]\s*(\d{1,2})[-./월]\s*(\d{1,2})일?\.?$/);
  if (m) {
    const iso = `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
    return isISODate(iso) ? iso : null;
  }
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) {
    const iso = `${m[1]}-${m[2]}-${m[3]}`;
    return isISODate(iso) ? iso : null;
  }
  return null;
}

function parseTimeLoose(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    return `${pad2(v.getUTCHours())}:${pad2(v.getUTCMinutes())}`;
  }
  if (typeof v === 'number' && v >= 0 && v < 1) {
    const min = Math.round(v * 24 * 60);
    return fromMinutes(min);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})\s*[:시]\s*(\d{1,2})?\s*분?$/);
  if (m) {
    const h = Number(m[1]); const mi = Number(m[2] || 0);
    if (h > 23 || mi > 59) return null;
    return `${pad2(h)}:${pad2(mi)}`;
  }
  m = s.match(/^(\d{1,2})(\d{2})$/);
  if (m) {
    const h = Number(m[1]); const mi = Number(m[2]);
    if (h > 23 || mi > 59) return null;
    return `${pad2(h)}:${pad2(mi)}`;
  }
  return null;
}

// "월", "월요일", "Mon", 1 -> 1..7
function parseDow(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && v >= 1 && v <= 7) return v;
  const s = String(v).trim();
  const idx = DOW_KO.indexOf(s[0]);
  if (idx >= 0) return idx === 0 ? 7 : idx;
  const en = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].indexOf(s.slice(0, 3).toLowerCase());
  if (en >= 0) return en + 1;
  const n = Number(s);
  if (n >= 1 && n <= 7) return n;
  return null;
}

function compareISO(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

module.exports = {
  DOW_KO, pad2, toISO, fromISO, isISODate, today, addDays, dow, dowKo, dowKoFromNum,
  fmtKo, fmtKoFull, toMinutes, fromMinutes, nowHHMM, parseDateLoose, parseTimeLoose, parseDow, compareISO,
};
