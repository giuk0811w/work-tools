'use strict';
/* global window, document, U, Views */
const App = {
  state: null,
  view: 'home',
  params: {},
  async refreshState() {
    App.state = await U.api('state.get');
    const badge = document.getElementById('badge-pending');
    badge.hidden = !App.state.pendingCount;
    badge.textContent = App.state.pendingCount;
    const ns = document.getElementById('nav-semester');
    ns.textContent = App.state.semester ? `${App.state.semester.name} · ${App.state.settings.teacher || ''}`.replace(/ · $/, '') : '학기 없음';
    return App.state;
  },
  async go(view, params = {}) {
    App.view = view; App.params = params;
    document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === view || (view === 'entry' && b.dataset.view === 'home') || (view === 'day' && b.dataset.view === 'search')));
    const main = document.getElementById('main');
    main.innerHTML = '<div class="muted">불러오는 중…</div>';
    try {
      await App.refreshState();
      if (!App.state.semester && view !== 'settings') {
        main.innerHTML = `<div class="empty"><p><b>아직 학기가 없습니다.</b></p><p>설정에서 기존 엑셀 출석부를 가져오거나, 설정 양식을 내려받아 작성한 뒤 업로드하세요.</p><p><button class="btn primary" id="go-settings">설정으로 이동</button></p></div>`;
        main.querySelector('#go-settings').addEventListener('click', () => App.go('settings', { tab: 'semester' }));
        return;
      }
      await Views[view].render(main, params);
      main.scrollTop = 0;
    } catch (e) {
      main.innerHTML = `<div class="panel"><b>오류:</b> ${U.esc(e.message)}</div>`;
      console.error(e);
    }
  },
};
window.App = App;

document.querySelectorAll('.nav-btn').forEach((b) => b.addEventListener('click', () => App.go(b.dataset.view)));
document.addEventListener('keydown', (e) => {
  if (e.key === 'F5') { e.preventDefault(); App.go(App.view, App.params); }
});
App.go('home').then(() => {
  if (App.state && App.state.loadError) U.alert('데이터 파일 경고', `<p>${U.esc(App.state.loadError)}</p>`);
});
