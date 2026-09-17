'use strict';
const { addDays, dow, toMinutes, fromMinutes, compareISO } = require('./dates');

function holidayApplies(h, subjectId) {
  return !h.subjectIds || h.subjectIds.length === 0 || h.subjectIds.includes(subjectId);
}

// 과목의 실제 수업일 목록을 날짜순으로 만든다. 각 항목: {date, periods, start, end, seq, seqEnd, source}
// - 주간 시간표는 semester.start~end 사이, subject.scheduleFrom 이후에만 적용
// - 휴업일(전체/과목별), 취소일은 제외
// - 보강/가져온 수업(extras)은 항상 포함되며 같은 날짜의 주간 수업을 대체한다
function listSessions(semester, subject) {
  const byDate = new Map();
  if (semester.start && semester.end && subject.schedule.length) {
    const from = subject.scheduleFrom && subject.scheduleFrom > semester.start ? subject.scheduleFrom : semester.start;
    for (let d = from; d <= semester.end; d = addDays(d, 1)) {
      const wd = dow(d);
      const entries = subject.schedule.filter((e) => Number(e.dow) === wd);
      if (!entries.length) continue;
      if (semester.holidays.some((h) => h.date === d && holidayApplies(h, subject.id))) continue;
      if (subject.cancels.some((c) => c.date === d)) continue;
      const starts = entries.map((e) => toMinutes(e.start)).filter((x) => x != null);
      const ends = entries.map((e) => toMinutes(e.end)).filter((x) => x != null);
      byDate.set(d, {
        date: d,
        periods: entries.reduce((a, e) => a + (Number(e.periods) || 1), 0),
        start: starts.length ? fromMinutes(Math.min(...starts)) : '',
        end: ends.length ? fromMinutes(Math.max(...ends)) : '',
        source: 'weekly',
      });
    }
  }
  for (const x of subject.extras) {
    if (!x.date) continue;
    // 시각이 없는 보강/가져온 수업은 같은 요일의 주간 시간표 시각을 빌려 쓴다
    let start = x.start || ''; let end = x.end || '';
    if (!start) {
      const wd = dow(x.date);
      const entries = subject.schedule.filter((e) => Number(e.dow) === wd);
      const starts = entries.map((e) => toMinutes(e.start)).filter((v) => v != null);
      const ends = entries.map((e) => toMinutes(e.end)).filter((v) => v != null);
      if (starts.length) start = fromMinutes(Math.min(...starts));
      if (ends.length) end = fromMinutes(Math.max(...ends));
    }
    byDate.set(x.date, {
      date: x.date,
      periods: Number(x.periods) || 1,
      start, end,
      source: x.source === 'import' ? 'import' : 'extra',
      reason: x.reason || '',
    });
  }
  const list = [...byDate.values()].sort((a, b) => compareISO(a.date, b.date));
  let seq = 1;
  for (const s of list) {
    s.seq = seq;
    s.seqEnd = seq + s.periods - 1;
    seq += s.periods;
  }
  return list;
}

function findSession(semester, subject, date) {
  return listSessions(semester, subject).find((s) => s.date === date) || null;
}

// 특정 날짜의 모든 과목 수업
function sessionsOn(semester, date) {
  const out = [];
  for (const sub of semester.subjects) {
    const s = findSession(semester, sub, date);
    if (s) out.push({ subject: sub, session: s });
  }
  out.sort((a, b) => {
    const am = toMinutes(a.session.start) ?? 9999;
    const bm = toMinutes(b.session.start) ?? 9999;
    return am - bm || a.subject.name.localeCompare(b.subject.name, 'ko');
  });
  return out;
}

function seqLabel(session) {
  if (!session) return '';
  return session.periods > 1 ? `${session.seq}~${session.seqEnd}차시` : `${session.seq}차시`;
}

function timeLabel(session) {
  if (!session || !session.start) return '';
  return session.end ? `${session.start}~${session.end}` : session.start;
}

// 총 차시 수 (학점 대비 진도 표시에 사용)
function totalPeriods(sessions) {
  return sessions.reduce((a, s) => a + s.periods, 0);
}

module.exports = { listSessions, findSession, sessionsOn, seqLabel, timeLabel, totalPeriods, holidayApplies };
