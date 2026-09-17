'use strict';
// Electron 전체 흐름 스모크 테스트 (xvfb-run node test/e2e/run.js)
const { _electron: electron } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', '..');
const FIXTURE = path.join(ROOT, 'test', 'fixtures', 'sample-attendance.xlsx');
const OUT = path.join(ROOT, 'test', 'out', 'e2e');

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'attendance-data-'));
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'attendance-user-'));
  const app = await electron.launch({
    args: [ROOT, `--user-data-dir=${userData}`, '--no-sandbox'],
    env: { ...process.env, ATTENDANCE_DATA_DIR: dataDir, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
  });
  const page = await app.firstWindow();
  page.on('console', (m) => { if (m.type() === 'error') console.log('[renderer error]', m.text()); });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.waitForSelector('#main');
  const shot = async (name) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  const api = (name, payload) => page.evaluate(([n, p]) => window.api.invoke(n, p), [name, payload]);

  // 1) 빈 상태
  await page.waitForSelector('#go-settings');
  await shot('01-empty');

  // 2) 가져오기 (파일 대화상자 대신 file 인자)
  const draft = await api('import.pick', { file: FIXTURE });
  assert.ok(draft.ok, draft.error);
  assert.equal(draft.result.subjects.length, 3);
  const applied = await api('import.apply', { draftId: draft.result.draftId, name: '2026학년도 2학기', start: '2026-08-10', end: '2026-12-31', school: '강원온라인학교' });
  assert.ok(applied.ok, applied.error);

  // 3) 홈
  await page.evaluate(() => window.App.go('home'));
  await page.waitForSelector('.session-card, .empty');
  const homeText = await page.textContent('#main');
  console.log('home has 경제:', homeText.includes('경제'));
  await shot('02-home');
  // 시간표 시각 입력 (경제 목 14:00~15:40)
  const st = await api('state.get');
  const eco = st.result.semester.subjects.find((s) => s.name === '경제');
  const saved = await api('subject.save', { id: eco.id, name: eco.name, credits: eco.credits, teacher: eco.teacher, memo: eco.memo, schedule: [{ dow: 4, start: '14:00', end: '15:40', periods: 2 }], scheduleFrom: eco.scheduleFrom });
  assert.ok(saved.ok, saved.error);
  await page.evaluate(() => window.App.go('home', { date: '2026-09-17' }));
  await page.waitForSelector('.session-card');
  await shot('03-home-today');

  // 4) 출석 입력: 경제 9/17, 첫 학생 미인정, 둘째 학생 대기 → 확정
  await page.click(`.session-card[data-subject="${eco.id}"]`);
  await page.waitForSelector('.entry-table');
  await page.click('#row-0 .status-group button[data-status="X"]');
  await page.click('#row-1 .status-group button[data-status="W"]');
  await page.fill('#row-1 input[data-field="reason"]', '소속교 시험');
  await shot('04-entry');
  await page.click('#confirm');
  await page.waitForSelector('.session-card');
  const sess = await api('session.get', { subjectId: eco.id, date: '2026-09-17' });
  assert.equal(sess.result.confirmed, true);
  assert.deepEqual(sess.result.rows[0].statuses, ['X', 'X']);
  assert.deepEqual(sess.result.rows[1].statuses, ['W', 'W']);

  // 5) 대기 목록
  await page.click('.nav-btn[data-view="pending"]');
  await page.waitForSelector('table');
  await shot('05-pending');
  const pendingRows = await page.$$('tbody tr');
  console.log('pending rows', pendingRows.length);
  assert.ok(pendingRows.length >= 3); // 기후변화 2건 + 경제 1건
  const ecoRow = page.locator('tbody tr', { hasText: '경제' }).first();
  await ecoRow.locator('input[data-f="docNo"]').fill('다라고-2026-100');
  await ecoRow.locator('button[data-act="E"]').click();
  await page.waitForTimeout(400);
  const sess2 = await api('session.get', { subjectId: eco.id, date: '2026-09-17' });
  assert.deepEqual(sess2.result.rows[1].statuses, ['E', 'E']);
  assert.equal(sess2.result.rows[1].docNo, '다라고-2026-100');

  // 6) 검색
  await page.click('.nav-btn[data-view="search"]');
  await page.waitForSelector('#results .session-card, #results .empty');
  await page.selectOption('#q-subject', eco.id);
  await page.fill('#q-from', ''); await page.fill('#q-to', '');
  await page.click('#q-run');
  await page.waitForSelector('#results .session-card');
  const cards = await page.$$('#results .session-card');
  console.log('search cards', cards.length);
  await shot('06-search');

  // 7) 출석부 열람 + 내보내기
  await page.click('.nav-btn[data-view="register"]');
  await page.waitForSelector('.register');
  await page.click(`.tabs button[data-id="${eco.id}"]`);
  await page.waitForSelector('.register');
  await shot('07-register');
  const xlsxOut = path.join(OUT, 'register.xlsx');
  const ex = await api('export.xlsx', { file: xlsxOut });
  assert.ok(ex.ok, ex.error);
  assert.ok(fs.existsSync(xlsxOut));
  console.log('export stats', JSON.stringify(ex.result.stats));

  // 8) 설정 화면들
  for (const tab of ['semester', 'subjects', 'students', 'calendar', 'data', 'app']) {
    await page.evaluate((t) => window.App.go('settings', { tab: t }), tab);
    await page.waitForSelector('#tab-body .panel, #tab-body .empty, #tab-body table');
    await shot(`08-settings-${tab}`);
  }
  // 학사일정: 휴업일 추가 → 회차 재계산 확인
  const before = await api('session.search', { subjectId: eco.id });
  const hol = await api('holiday.save', { date: '2026-09-24', reason: '테스트 휴업', subjectIds: [] });
  assert.ok(hol.ok, hol.error);
  const after = await api('session.search', { subjectId: eco.id });
  assert.equal(after.result.length, before.result.length - 1);
  assert.ok(!after.result.find((s) => s.session.date === '2026-09-24'));
  const ev = await api('event.save', { school: '파하고등학교', date: '2026-10-01', reason: '1회고사' });
  assert.ok(ev.ok, ev.error);
  const oct1 = await api('session.get', { subjectId: eco.id, date: '2026-10-01' });
  assert.ok(oct1.result.session, 'session on 10/01');
  assert.ok(oct1.result.rows.every((r) => r.statuses[0] === 'W' && r.auto), 'auto pending from school event');

  // 9) 양식 내려받기/업로드 왕복
  const tplOut = path.join(OUT, 'settings-template.xlsx');
  const dl = await api('template.download', { file: tplOut });
  assert.ok(dl.ok && fs.existsSync(tplOut), dl.error);
  const pick = await api('template.pick', { file: tplOut });
  assert.ok(pick.ok, pick.error);
  const ap = await api('template.apply', { draftId: pick.result.draftId, asNewSemester: false });
  assert.ok(ap.ok, ap.error);
  assert.equal(ap.result.summary.studentsRemoved, 0);
  assert.equal(ap.result.summary.studentsAdded, 0);
  const sess3 = await api('session.get', { subjectId: eco.id, date: '2026-09-17' });
  assert.equal(sess3.result.confirmed, true, 'records preserved after template apply');

  // 10) 데이터 파일 존재 + 백업
  assert.ok(fs.existsSync(path.join(dataDir, 'data.json')));
  const bk = await api('data.backupNow');
  assert.ok(bk.ok && fs.existsSync(bk.result));
  const info = await api('app.info');
  console.log('backups', info.result.backups.length, 'dataDir', info.result.dataDir);

  // 11) 인쇄 PDF
  const pdfOut = path.join(OUT, 'register.pdf');
  await page.evaluate((id) => window.App.go('register', { subjectId: id }), eco.id);
  await page.waitForSelector('.register');
  const pdf = await api('print.pdf', { file: pdfOut });
  assert.ok(pdf.ok && fs.existsSync(pdfOut), pdf.error);
  console.log('pdf bytes', fs.statSync(pdfOut).size);

  await app.close();
  console.log('E2E OK');
})().catch((e) => { console.error('E2E FAILED', e); process.exit(1); });
