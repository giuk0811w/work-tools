'use strict';
// 렌더러가 호출하는 API 핸들러 모음 (ipc 'api' 채널)
const fs = require('fs');
const path = require('path');
const { dialog, shell, app } = require('electron');
const dates = require('../core/dates');
const model = require('../core/model');
const schedule = require('../core/schedule');
const marks = require('../core/marks');
const importer = require('../core/importer');
const settingsTemplate = require('../core/settings-template');
const exporter = require('../core/exporter');

function createApi({ store, getWindow, getAutoLaunch, setAutoLaunch, isPortable }) {
  const drafts = new Map(); // 가져오기/양식 업로드 임시 보관
  const data = () => store.data;
  const sem = () => {
    const s = model.currentSemester(data());
    if (!s) throw new Error('학기가 없습니다. 설정에서 학기를 만들거나 기존 출석부를 가져오세요.');
    return s;
  };
  const subject = (id) => {
    const s = model.findSubject(sem(), id);
    if (!s) throw new Error('과목을 찾을 수 없습니다.');
    return s;
  };
  const save = () => store.save();
  const today = () => dates.today();

  function subjectMeta(sub) {
    return { id: sub.id, name: sub.name, credits: sub.credits, teacher: sub.teacher, memo: sub.memo, schedule: sub.schedule, scheduleFrom: sub.scheduleFrom, students: sub.students, extras: sub.extras, cancels: sub.cancels, sheetName: sub.sheetName || '' };
  }

  function sessionSummary(s, sub, session) {
    const view = marks.sessionView(s, sub, session);
    return {
      subjectId: sub.id, subjectName: sub.name, credits: sub.credits, teacher: sub.teacher,
      session, seqLabel: schedule.seqLabel(session), timeLabel: schedule.timeLabel(session),
      confirmed: view.confirmed, summary: marks.summarize(view), studentCount: view.rows.filter((r) => r.enrolled).length,
      hasRecord: !!view.record,
    };
  }

  function snapshot() {
    const d = data();
    const cur = model.currentSemester(d);
    return {
      settings: d.settings,
      today: today(),
      now: dates.nowHHMM(),
      currentSemesterId: d.currentSemesterId,
      semesters: d.semesters.map((s) => ({ id: s.id, name: s.name, start: s.start, end: s.end, school: s.school, subjectCount: s.subjects.length })),
      semester: cur ? {
        id: cur.id, name: cur.name, start: cur.start, end: cur.end, school: cur.school,
        subjects: cur.subjects.map(subjectMeta), holidays: cur.holidays, schoolEvents: cur.schoolEvents,
      } : null,
      pendingCount: cur ? marks.pendingList(cur).length : 0,
      unconfirmedCount: cur ? marks.unconfirmedSessions(cur, today()).length : 0,
      loadError: store.loadError || null,
    };
  }

  const handlers = {
    // ----- 앱/상태 -----
    'app.info': () => ({
      version: app.getVersion(), dataDir: store.dataDir, dataFile: store.dataFile, backupDir: store.backupDir,
      lastBackupAt: store.lastBackupAt, autoLaunch: getAutoLaunch(), portable: isPortable(), platform: process.platform,
      backups: store.listBackups().slice(0, 40),
    }),
    'state.get': () => snapshot(),

    // ----- 홈 -----
    'home.get': ({ date } = {}) => {
      const s = sem();
      const d = date || today();
      const list = schedule.sessionsOn(s, d).map(({ subject: sub, session }) => sessionSummary(s, sub, session));
      const nowMin = dates.toMinutes(dates.nowHHMM());
      const isToday = d === today();
      for (const it of list) {
        const st = dates.toMinutes(it.session.start); const en = dates.toMinutes(it.session.end);
        it.state = 'none';
        if (isToday && st != null) {
          const endMin = en != null ? en : st + 50 * it.session.periods;
          if (nowMin >= st - 30 && nowMin <= endMin + 30) it.state = 'now';
          else if (nowMin < st) it.state = 'later';
          else it.state = 'done';
        }
      }
      const unconfirmed = marks.unconfirmedSessions(s, today()).map(({ subject: sub, session }) => sessionSummary(s, sub, session));
      // 주간 미리보기 (해당 주 월~일)
      const wd = dates.dow(d); const monday = dates.addDays(d, -(wd - 1));
      const week = [];
      for (let i = 0; i < 7; i++) {
        const dd = dates.addDays(monday, i);
        week.push({ date: dd, dowKo: dates.dowKo(dd), sessions: schedule.sessionsOn(s, dd).map(({ subject: sub, session }) => ({ subjectId: sub.id, subjectName: sub.name, seqLabel: schedule.seqLabel(session), timeLabel: schedule.timeLabel(session), confirmed: !!(marks.getRecord(s, sub.id, dd) || {}).confirmed })) });
      }
      return { date: d, isToday, sessions: list, unconfirmed, pendingCount: marks.pendingList(s).length, week };
    },

    // ----- 출석 입력 -----
    'session.get': ({ subjectId, date }) => {
      const s = sem(); const sub = subject(subjectId);
      const session = schedule.findSession(s, sub, date);
      if (!session) return { subject: subjectMeta(sub), session: null, date };
      const view = marks.sessionView(s, sub, session);
      return {
        subject: subjectMeta(sub), session, seqLabel: schedule.seqLabel(session), timeLabel: schedule.timeLabel(session),
        confirmed: view.confirmed, confirmedAt: view.record ? view.record.confirmedAt : null,
        rows: view.rows.map((r) => ({ studentId: r.student.id, student: r.student, enrolled: r.enrolled, statuses: r.statuses, reason: r.reason, docNo: r.docNo, docDate: r.docDate, auto: r.auto })),
        summary: marks.summarize(view),
      };
    },
    'session.save': ({ subjectId, date, rows, confirm }) => {
      const s = sem(); const sub = subject(subjectId);
      const session = schedule.findSession(s, sub, date);
      if (!session) throw new Error('해당 날짜에 수업이 없습니다.');
      const compact = marks.compactMarks(rows, session.periods);
      marks.saveRecord(s, subjectId, date, compact, { confirm });
      save();
      return handlers['session.get']({ subjectId, date });
    },
    'session.unconfirm': ({ subjectId, date }) => {
      const s = sem();
      const rec = marks.getRecord(s, subjectId, date);
      if (rec) { rec.confirmed = false; rec.confirmedAt = null; save(); }
      return handlers['session.get']({ subjectId, date });
    },
    'session.search': ({ subjectId, from, to } = {}) => {
      const s = sem();
      const subs = subjectId ? [subject(subjectId)] : s.subjects;
      const out = [];
      for (const sub of subs) {
        for (const session of schedule.listSessions(s, sub)) {
          if (from && session.date < from) continue;
          if (to && session.date > to) continue;
          out.push(sessionSummary(s, sub, session));
        }
      }
      out.sort((a, b) => a.session.date.localeCompare(b.session.date) || (dates.toMinutes(a.session.start) ?? 0) - (dates.toMinutes(b.session.start) ?? 0));
      return out;
    },

    // ----- 대기 목록 -----
    'pending.list': () => marks.pendingList(sem()).map((p) => ({
      subjectId: p.subject.id, subjectName: p.subject.name, date: p.session.date, seqLabel: schedule.seqLabel(p.session),
      studentId: p.student.id, student: p.student, reason: p.reason || '', stored: p.stored, planId: p.planId, sessionConfirmed: p.confirmed,
      future: p.session.date > today(),
      periods: p.statuses.map((x, i) => (x === 'W' ? i + 1 : null)).filter(Boolean),
    })),
    'pending.resolve': ({ subjectId, date, studentId, status }) => {
      const s = sem();
      if (!['E', 'P'].includes(status)) throw new Error('잘못된 상태입니다.');
      if (!marks.resolvePending(s, subjectId, date, studentId, status)) throw new Error('대기 항목을 찾을 수 없습니다.');
      save();
      return true;
    },
    'pending.resolveMany': ({ items, status }) => {
      const s = sem();
      if (!['E', 'P'].includes(status)) throw new Error('잘못된 상태입니다.');
      let n = 0;
      for (const it of items || []) if (marks.resolvePending(s, it.subjectId, it.date, it.studentId, status)) n += 1;
      save();
      return n;
    },
    'plan.confirm': ({ id, confirmed }) => {
      const s = sem();
      if (!s.schoolEvents.find((e) => e.id === id)) throw new Error('항목을 찾을 수 없습니다.');
      const changed = marks.setPlanConfirmed(s, id, !!confirmed);
      save();
      return { changed };
    },

    // ----- 출석부 열람 -----
    'register.get': ({ subjectId, from, to }) => {
      const s = sem(); const sub = subject(subjectId);
      const mx = marks.registerMatrix(s, sub, { from, to, todayISO: today() });
      return {
        subject: subjectMeta(sub), semester: { name: s.name, school: s.school },
        students: sub.students, sessions: mx.sessions,
        columns: mx.columns.map((c) => ({ seq: c.seq, date: c.date, period: c.period, periods: c.periods, confirmed: c.confirmed, future: c.future, cells: c.cells })),
        totalPeriods: mx.columns.length,
      };
    },
    'day.get': ({ date }) => {
      const s = sem();
      return schedule.sessionsOn(s, date).map(({ subject: sub, session }) => {
        const view = marks.sessionView(s, sub, session);
        return {
          ...sessionSummary(s, sub, session),
          rows: view.rows.map((r) => ({ student: r.student, enrolled: r.enrolled, statuses: r.statuses, reason: r.reason, docNo: r.docNo })),
        };
      });
    },

    // ----- 학기 -----
    'semester.select': ({ id }) => { if (!model.findSemester(data(), id)) throw new Error('학기를 찾을 수 없습니다.'); data().currentSemesterId = id; save(); return snapshot(); },
    'semester.create': ({ name, start, end, school, copyFromId }) => {
      if (!name || !dates.isISODate(start) || !dates.isISODate(end)) throw new Error('학기명, 시작일, 종료일을 확인하세요.');
      store.backup('before-new-semester');
      const ns = model.newSemester({ name, start, end, school: school || data().settings.school });
      if (copyFromId) {
        const src = model.findSemester(data(), copyFromId);
        if (src) {
          for (const sub of src.subjects) {
            const c = model.newSubject({ name: sub.name, credits: sub.credits, teacher: sub.teacher, memo: '' });
            c.schedule = sub.schedule.map((e) => ({ ...e }));
            c.students = sub.students.filter((st) => !st.dropDate).map((st) => model.newStudent({ school: st.school, no: st.no, name: st.name }));
            ns.subjects.push(c);
          }
        }
      }
      data().semesters.push(ns);
      data().currentSemesterId = ns.id;
      save();
      return snapshot();
    },
    'semester.update': ({ id, name, start, end, school }) => {
      const s = model.findSemester(data(), id); if (!s) throw new Error('학기를 찾을 수 없습니다.');
      if (name != null) s.name = String(name).trim();
      if (start != null) { if (!dates.isISODate(start)) throw new Error('시작일 형식이 잘못되었습니다.'); s.start = start; }
      if (end != null) { if (!dates.isISODate(end)) throw new Error('종료일 형식이 잘못되었습니다.'); s.end = end; }
      if (school != null) s.school = String(school).trim();
      save(); return snapshot();
    },
    'semester.delete': ({ id }) => {
      const d = data();
      const idx = d.semesters.findIndex((s) => s.id === id);
      if (idx < 0) throw new Error('학기를 찾을 수 없습니다.');
      store.backup('before-delete-semester');
      d.semesters.splice(idx, 1);
      if (d.currentSemesterId === id) d.currentSemesterId = d.semesters.length ? d.semesters[d.semesters.length - 1].id : null;
      save(); return snapshot();
    },

    // ----- 과목/학생/일정 편집 -----
    'subject.save': ({ id, name, credits, teacher, memo, schedule: sch, scheduleFrom }) => {
      const s = sem();
      if (!name || !String(name).trim()) throw new Error('과목명을 입력하세요.');
      let sub = id ? model.findSubject(s, id) : null;
      if (!sub) { sub = model.newSubject({}); s.subjects.push(sub); }
      if (s.subjects.some((x) => x !== sub && x.name === String(name).trim())) throw new Error('같은 이름의 과목이 이미 있습니다.');
      sub.name = String(name).trim();
      sub.credits = model.parseCredits(credits);
      sub.teacher = (teacher || '').trim();
      sub.memo = memo || '';
      if (Array.isArray(sch)) {
        sub.schedule = sch.map((e) => ({ dow: Number(e.dow), start: dates.parseTimeLoose(e.start) || '', end: dates.parseTimeLoose(e.end) || '', periods: Math.max(1, Math.round(Number(e.periods) || 1)) })).filter((e) => e.dow >= 1 && e.dow <= 7);
      }
      if (scheduleFrom !== undefined) sub.scheduleFrom = scheduleFrom && dates.isISODate(scheduleFrom) ? scheduleFrom : null;
      save(); return subjectMeta(sub);
    },
    'subject.delete': ({ id }) => {
      const s = sem();
      const idx = s.subjects.findIndex((x) => x.id === id);
      if (idx < 0) throw new Error('과목을 찾을 수 없습니다.');
      store.backup('before-delete-subject');
      s.subjects.splice(idx, 1);
      for (const k of Object.keys(s.records)) if (k.startsWith(id + '|')) delete s.records[k];
      save(); return true;
    },
    'subject.move': ({ id, dir }) => {
      const s = sem(); const i = s.subjects.findIndex((x) => x.id === id);
      const j = i + (dir < 0 ? -1 : 1);
      if (i < 0 || j < 0 || j >= s.subjects.length) return false;
      [s.subjects[i], s.subjects[j]] = [s.subjects[j], s.subjects[i]];
      save(); return true;
    },
    'student.save': ({ subjectId, id, school, no, name, dropDate }) => {
      const sub = subject(subjectId);
      if (!name || !String(name).trim()) throw new Error('이름을 입력하세요.');
      let st = id ? model.findStudent(sub, id) : null;
      if (!st) { st = model.newStudent({}); sub.students.push(st); }
      st.school = (school || '').trim(); st.no = no == null ? '' : String(no).trim(); st.name = String(name).trim();
      st.dropDate = dropDate && dates.isISODate(dropDate) ? dropDate : null;
      save(); return st;
    },
    'student.delete': ({ subjectId, id }) => {
      const s = sem(); const sub = subject(subjectId);
      const idx = sub.students.findIndex((x) => x.id === id);
      if (idx < 0) throw new Error('학생을 찾을 수 없습니다.');
      sub.students.splice(idx, 1);
      for (const [k, r] of Object.entries(s.records)) if (k.startsWith(subjectId + '|') && r.marks && r.marks[id]) delete r.marks[id];
      save(); return true;
    },
    'student.move': ({ subjectId, id, dir }) => {
      const sub = subject(subjectId); const i = sub.students.findIndex((x) => x.id === id);
      const j = i + (dir < 0 ? -1 : 1);
      if (i < 0 || j < 0 || j >= sub.students.length) return false;
      [sub.students[i], sub.students[j]] = [sub.students[j], sub.students[i]];
      save(); return true;
    },
    'holiday.save': ({ id, date, reason, subjectIds }) => {
      const s = sem();
      if (!dates.isISODate(date)) throw new Error('날짜 형식이 잘못되었습니다.');
      let h = id ? s.holidays.find((x) => x.id === id) : null;
      if (!h) { h = { id: model.newId('hol') }; s.holidays.push(h); }
      h.date = date; h.reason = (reason || '').trim(); h.subjectIds = Array.isArray(subjectIds) && subjectIds.length ? subjectIds : null;
      s.holidays.sort((a, b) => a.date.localeCompare(b.date));
      save(); return h;
    },
    'holiday.delete': ({ id }) => { const s = sem(); s.holidays = s.holidays.filter((x) => x.id !== id); save(); return true; },
    'event.save': ({ id, school, date, to, names, reason, confirmed }) => {
      const s = sem();
      if (!dates.isISODate(date)) throw new Error('시작일 형식이 잘못되었습니다.');
      if (to && !dates.isISODate(to)) throw new Error('종료일 형식이 잘못되었습니다.');
      if (to && to < date) throw new Error('종료일이 시작일보다 앞섭니다.');
      if (!school || !String(school).trim()) throw new Error('소속교를 입력하세요.');
      let e = id ? s.schoolEvents.find((x) => x.id === id) : null;
      if (!e) { e = { id: model.newId('evt') }; s.schoolEvents.push(e); }
      e.school = String(school).trim(); e.date = date; e.to = to || date; e.reason = (reason || '').trim();
      e.names = Array.isArray(names) ? names.map((n) => String(n).trim()).filter(Boolean) : (typeof names === 'string' ? names.split(/[,，、\n]/).map((n) => n.trim()).filter(Boolean) : []);
      const wasConfirmed = !!e.confirmed;
      e.confirmed = !!confirmed;
      s.schoolEvents.sort((a, b) => a.date.localeCompare(b.date));
      if (e.confirmed && !wasConfirmed) marks.setPlanConfirmed(s, e.id, true);
      save(); return e;
    },
    'event.delete': ({ id }) => { const s = sem(); s.schoolEvents = s.schoolEvents.filter((x) => x.id !== id); save(); return true; },
    'extra.save': ({ subjectId, date, periods, start, end, reason }) => {
      const sub = subject(subjectId);
      if (!dates.isISODate(date)) throw new Error('날짜 형식이 잘못되었습니다.');
      sub.extras = sub.extras.filter((x) => x.date !== date);
      sub.extras.push({ date, periods: Math.max(1, Math.round(Number(periods) || 1)), start: dates.parseTimeLoose(start) || '', end: dates.parseTimeLoose(end) || '', reason: (reason || '').trim(), source: 'manual' });
      sub.extras.sort((a, b) => a.date.localeCompare(b.date));
      sub.cancels = sub.cancels.filter((c) => c.date !== date);
      save(); return true;
    },
    'extra.delete': ({ subjectId, date }) => {
      const s = sem(); const sub = subject(subjectId);
      sub.extras = sub.extras.filter((x) => x.date !== date);
      const rec = marks.getRecord(s, subjectId, date);
      if (rec && !schedule.findSession(s, sub, date)) delete s.records[model.recordKey(subjectId, date)];
      save(); return true;
    },
    'cancel.save': ({ subjectId, date, reason }) => {
      const sub = subject(subjectId);
      if (!dates.isISODate(date)) throw new Error('날짜 형식이 잘못되었습니다.');
      sub.cancels = sub.cancels.filter((c) => c.date !== date);
      sub.cancels.push({ date, reason: (reason || '').trim() });
      sub.cancels.sort((a, b) => a.date.localeCompare(b.date));
      save(); return true;
    },
    'cancel.delete': ({ subjectId, date }) => { const sub = subject(subjectId); sub.cancels = sub.cancels.filter((c) => c.date !== date); save(); return true; },
    'schools.list': () => {
      const set = new Set();
      for (const sub of sem().subjects) for (const st of sub.students) if (st.school) set.add(st.school);
      return [...set].sort((a, b) => a.localeCompare(b, 'ko'));
    },
    'students.bySchool': () => {
      const map = {};
      for (const sub of sem().subjects) for (const st of sub.students) {
        if (!st.school) continue;
        if (!map[st.school]) map[st.school] = [];
        if (!map[st.school].some((x) => x.name === st.name)) map[st.school].push({ name: st.name, no: st.no });
      }
      for (const k of Object.keys(map)) map[k].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
      return map;
    },

    // ----- 기존 출석부 가져오기 -----
    'import.pick': async ({ file: given } = {}) => {
      let file = given;
      if (!file) {
        const r = await dialog.showOpenDialog(getWindow(), { title: '기존 출석부 엑셀 파일 선택', filters: [{ name: 'Excel', extensions: ['xlsx', 'xlsm'] }], properties: ['openFile'] });
        if (r.canceled || !r.filePaths.length) return null;
        file = r.filePaths[0];
      }
      const draft = await importer.parseAttendanceWorkbook(fs.readFileSync(file));
      const id = model.newId('draft');
      drafts.set(id, { kind: 'import', draft });
      return {
        draftId: id, file, semester: draft.semester, warnings: draft.warnings,
        subjects: draft.subjects.map((s) => ({ sheetName: s.sheetName, name: s.name, credits: s.credits, teacher: s.teacher, students: s.students.length, sessions: s.sessions.length, periods: s.sessions.reduce((a, x) => a + x.periods, 0), firstDate: s.sessions[0] ? s.sessions[0].date : '', lastDate: s.sessions.length ? s.sessions[s.sessions.length - 1].date : '' })),
      };
    },
    'import.apply': ({ draftId, name, start, end, school, replaceCurrent }) => {
      const entry = drafts.get(draftId);
      if (!entry || entry.kind !== 'import') throw new Error('가져오기 정보가 만료되었습니다. 다시 선택하세요.');
      if (!name || !dates.isISODate(start) || !dates.isISODate(end)) throw new Error('학기명, 시작일, 종료일을 확인하세요.');
      store.backup('before-import');
      const d = data();
      const ns = importer.buildSemesterFromImport(entry.draft, { name, start, end, school, todayISO: today(), defaultTeacher: d.settings.teacher });
      if (replaceCurrent && d.currentSemesterId) {
        const idx = d.semesters.findIndex((s) => s.id === d.currentSemesterId);
        if (idx >= 0) d.semesters.splice(idx, 1);
      }
      d.semesters.push(ns);
      d.currentSemesterId = ns.id;
      if (!d.settings.teacher) { const t = ns.subjects.map((s) => s.teacher).find((x) => x); if (t) d.settings.teacher = t; }
      drafts.delete(draftId);
      save();
      return snapshot();
    },

    // ----- 설정 양식 -----
    'template.download': async ({ file: given } = {}) => {
      const d = data(); const cur = model.currentSemester(d);
      const defName = `출석부_설정양식_${cur ? cur.name.replace(/\s+/g, '_') : '새학기'}.xlsx`;
      let file = given;
      if (!file) {
        const r = await dialog.showSaveDialog(getWindow(), { title: '설정 양식 저장', defaultPath: path.join(app.getPath('documents'), defName), filters: [{ name: 'Excel', extensions: ['xlsx'] }] });
        if (r.canceled || !r.filePath) return null;
        file = r.filePath;
      }
      const buf = await settingsTemplate.buildSettingsTemplate(cur, d.settings);
      fs.writeFileSync(file, buf);
      return file;
    },
    'template.pick': async ({ file: given } = {}) => {
      let file = given;
      if (!file) {
        const r = await dialog.showOpenDialog(getWindow(), { title: '작성한 설정 양식 선택', filters: [{ name: 'Excel', extensions: ['xlsx', 'xlsm'] }], properties: ['openFile'] });
        if (r.canceled || !r.filePaths.length) return null;
        file = r.filePaths[0];
      }
      const parsed = await settingsTemplate.parseSettingsTemplate(fs.readFileSync(file));
      const id = model.newId('draft');
      drafts.set(id, { kind: 'template', parsed });
      return {
        draftId: id, file, semester: parsed.semester, warnings: parsed.warnings, settings: parsed.settings,
        subjects: parsed.subjects.map((s) => ({ name: s.name, credits: s.credits, teacher: s.teacher, schedule: s.schedule.map((e) => `${dates.dowKoFromNum(e.dow)} ${e.start || ''}${e.end ? '~' + e.end : ''} ${e.periods}차시`).join(', '), students: s.students.length, extras: s.extras.length })),
        holidays: parsed.holidays.length, schoolEvents: parsed.schoolEvents.length,
      };
    },
    'template.apply': ({ draftId, asNewSemester }) => {
      const entry = drafts.get(draftId);
      if (!entry || entry.kind !== 'template') throw new Error('양식 정보가 만료되었습니다. 다시 선택하세요.');
      store.backup('before-apply-template');
      const d = data();
      let target = model.currentSemester(d);
      if (asNewSemester || !target) {
        const p = entry.parsed.semester;
        if (!p.name || !p.start || !p.end) throw new Error('새 학기를 만들려면 양식의 [학기] 시트에 학기명, 시작일, 종료일이 있어야 합니다.');
        target = model.newSemester({ name: p.name, start: p.start, end: p.end, school: p.school || d.settings.school });
        d.semesters.push(target);
        d.currentSemesterId = target.id;
      }
      const summary = settingsTemplate.applySettings(target, entry.parsed, { todayISO: today() });
      if (entry.parsed.settings.teacher) d.settings.teacher = entry.parsed.settings.teacher;
      drafts.delete(draftId);
      save();
      return { summary, snapshot: snapshot() };
    },

    // ----- 내보내기/인쇄 -----
    'export.precheck': () => exporter.exportPrecheck(sem(), { todayISO: today() }),
    'export.xlsx': async ({ subjectIds, file: given } = {}) => {
      const s = sem();
      const defName = `${s.name.replace(/\s+/g, '_')}_출석부_${today()}.xlsx`;
      let file = given;
      if (!file) {
        const r = await dialog.showSaveDialog(getWindow(), { title: '출석부 엑셀 저장', defaultPath: path.join(app.getPath('documents'), defName), filters: [{ name: 'Excel', extensions: ['xlsx'] }] });
        if (r.canceled || !r.filePath) return null;
        file = r.filePath;
      }
      const { buffer, warnings, stats } = await exporter.buildRegisterWorkbook(s, { todayISO: today(), subjectIds: subjectIds && subjectIds.length ? subjectIds : null });
      fs.writeFileSync(file, buffer);
      return { file, warnings, stats };
    },
    'print.pdf': async ({ landscape = true, defaultName = '출석부.pdf', file: given } = {}) => {
      const win = getWindow();
      let file = given;
      if (!file) {
        const r = await dialog.showSaveDialog(win, { title: 'PDF로 저장', defaultPath: path.join(app.getPath('documents'), defaultName), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
        if (r.canceled || !r.filePath) return null;
        file = r.filePath;
      }
      const pdf = await win.webContents.printToPDF({ landscape, printBackground: true, pageSize: 'A4', margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 } });
      fs.writeFileSync(file, pdf);
      return file;
    },
    'print.print': async ({ landscape = true } = {}) => {
      const win = getWindow();
      return new Promise((resolve) => win.webContents.print({ landscape, printBackground: true }, (ok, reason) => resolve(ok ? true : reason || false)));
    },
    'shell.open': ({ target }) => shell.openPath(target),
    'shell.showInFolder': ({ target }) => { shell.showItemInFolder(target); return true; },

    // ----- 데이터 관리 -----
    'data.backupNow': () => store.backup('manual'),
    'data.restore': async ({ file }) => {
      let f = file;
      if (!f) {
        const r = await dialog.showOpenDialog(getWindow(), { title: '복원할 백업 파일 선택', defaultPath: store.backupDir, filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile'] });
        if (r.canceled || !r.filePaths.length) return null;
        f = r.filePaths[0];
      }
      store.restore(f);
      return snapshot();
    },
    'data.changeDir': async () => {
      const r = await dialog.showOpenDialog(getWindow(), { title: '데이터 폴더 선택', defaultPath: store.dataDir, properties: ['openDirectory', 'createDirectory'] });
      if (r.canceled || !r.filePaths.length) return null;
      const res = store.setDataDir(r.filePaths[0]);
      return { ...res, snapshot: snapshot() };
    },
    'data.exportJson': async () => {
      const r = await dialog.showSaveDialog(getWindow(), { title: '데이터 내보내기', defaultPath: path.join(app.getPath('documents'), `출석부_데이터_${today()}.json`), filters: [{ name: 'JSON', extensions: ['json'] }] });
      if (r.canceled || !r.filePath) return null;
      fs.writeFileSync(r.filePath, JSON.stringify(data(), null, 1), 'utf8');
      return r.filePath;
    },
    'data.resetAll': () => {
      const b = store.backup('before-reset');
      store.data = model.newDataFile();
      store.data.settings.teacher = '';
      save();
      return { backup: b, snapshot: snapshot() };
    },
    'settings.update': ({ teacher, school, autoLaunch }) => {
      const d = data();
      if (teacher != null) d.settings.teacher = String(teacher).trim();
      if (school != null) d.settings.school = String(school).trim();
      if (autoLaunch != null) { d.settings.autoLaunch = !!autoLaunch; setAutoLaunch(!!autoLaunch); }
      save(); return snapshot();
    },
  };

  return async function dispatch(name, payload) {
    const h = handlers[name];
    if (!h) throw new Error(`알 수 없는 요청: ${name}`);
    return h(payload || {});
  };
}

module.exports = { createApi };
