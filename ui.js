/**
 * ui.js
 * Thin DOM helpers shared across the app: screen navigation (with a back
 * stack so the hardware/gesture back affordance and our own back buttons
 * behave consistently), toasts, overlay show/hide, and small formatters.
 * app.js owns all game/business logic and calls into these helpers.
 */

const UI = (() => {
  const screens = {};
  document.querySelectorAll('.screen').forEach(el => { screens[el.dataset.screen] = el; });
  let current = 'menu';
  const stack = ['menu'];
  let onLeave = {}; // screenName -> callback invoked when navigating away

  function showScreen(name, { replace = false, push = true } = {}) {
    if (!screens[name]) return;
    if (onLeave[current]) { try { onLeave[current](); } catch (e) { console.error(e); } }
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[name].classList.add('active');
    if (push) {
      if (replace) stack[stack.length - 1] = name; else stack.push(name);
    }
    current = name;
    window.scrollTo(0, 0);
  }

  function goBack(fallback = 'menu') {
    if (stack.length > 1) {
      stack.pop();
      const target = stack[stack.length - 1];
      showScreen(target, { push: false });
    } else {
      showScreen(fallback, { replace: true });
    }
  }

  function setOnLeave(name, cb) { onLeave[name] = cb; }
  function currentScreen() { return current; }
  function resetStack(name) { stack.length = 0; stack.push(name); showScreen(name, { push: false }); }

  function toast(message, ms = 2200) {
    const root = document.getElementById('toast-root');
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = message;
    root.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .25s'; setTimeout(() => el.remove(), 260); }, ms);
  }

  function showOverlay(id) { document.getElementById(id).classList.remove('hidden'); }
  function hideOverlay(id) { document.getElementById(id).classList.add('hidden'); }

  function formatTime(ms) {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const pad = n => String(n).padStart(2, '0');
    return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  return { showScreen, goBack, setOnLeave, currentScreen, resetStack, toast, showOverlay, hideOverlay, formatTime, el };
})();
