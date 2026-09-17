'use strict';
/* global window, document */
const U = {
  esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },
  DOW: ['일', '월', '화', '수', '목', '금', '토'],
  fromISO(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); },
  toISO(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; },
  addDays(iso, n) { const d = U.fromISO(iso); d.setDate(d.getDate() + n); return U.toISO(d); },
  fmt(iso, dow = true) { if (!iso) return ''; const d = U.fromISO(iso); return `${d.getMonth() + 1}월 ${d.getDate()}일${dow ? `(${U.DOW[d.getDay()]})` : ''}`; },
  fmtFull(iso) { if (!iso) return ''; const d = U.fromISO(iso); return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${U.DOW[d.getDay()]})`; },
  fmtShort(iso) { if (!iso) return ''; return `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`; },
  dowKo(n) { return ['', '월', '화', '수', '목', '금', '토', '일'][n] || ''; },
  STATUS_LABEL: { P: '출석', X: '결석', W: '인정결석(대기)', E: '인정결석' },
  STATUS_SHORT: { P: '출석', X: '결석', W: '인정(대기)', E: '인정' },
  STATUS_SYMBOL: { P: 'O', X: 'X', W: '◎', E: '◎' },
  async api(name, payload) {
    const r = await window.api.invoke(name, payload);
    if (!r.ok) throw new Error(r.error);
    return r.result;
  },
  toast(msg, isError = false, ms = 2600) {
    const el = document.getElementById('toast');
    el.textContent = msg; el.hidden = false; el.className = 'toast' + (isError ? ' error' : '');
    clearTimeout(U._toastTimer);
    U._toastTimer = setTimeout(() => { el.hidden = true; }, ms);
  },
  // 모달: contentHtml, {title, buttons:[{label, cls, value}], onOpen(el)} → Promise<value>
  modal({ title, html, buttons, onOpen, width }) {
    return new Promise((resolve) => {
      const root = document.getElementById('modal-root');
      const back = document.createElement('div');
      back.className = 'modal-backdrop';
      back.innerHTML = `<div class="modal" ${width ? `style="min-width:${width}px"` : ''}><h2>${U.esc(title)}</h2><div class="modal-body">${html}</div><div class="actions">${(buttons || [{ label: '닫기', value: null }]).map((b, i) => `<button class="btn ${b.cls || ''}" data-i="${i}">${U.esc(b.label)}</button>`).join('')}</div></div>`;
      root.appendChild(back);
      const close = (v) => { back.remove(); resolve(v); };
      back.querySelectorAll('.actions button').forEach((btn) => btn.addEventListener('click', () => {
        const b = buttons[Number(btn.dataset.i)];
        if (b.validate && !b.validate(back)) return;
        close(typeof b.value === 'function' ? b.value(back) : b.value);
      }));
      back.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(null); });
      if (onOpen) onOpen(back);
      const first = back.querySelector('input, select, textarea, button');
      if (first) first.focus();
    });
  },
  confirm(title, html, { okLabel = '확인', danger = false } = {}) {
    return U.modal({ title, html, buttons: [{ label: '취소', value: false }, { label: okLabel, cls: danger ? 'danger' : 'primary', value: true }] });
  },
  alert(title, html) { return U.modal({ title, html, buttons: [{ label: '확인', cls: 'primary', value: true }] }); },
  warnListHtml(warnings) {
    if (!warnings || !warnings.length) return '';
    return `<div class="warn-list"><b>확인 필요 (${warnings.length}건)</b>${warnings.map((w) => `<div>· ${U.esc(w)}</div>`).join('')}</div>`;
  },
  val(root, sel) { const el = root.querySelector(sel); return el ? el.value.trim() : ''; },
};
window.U = U;
