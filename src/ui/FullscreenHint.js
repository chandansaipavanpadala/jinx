import { SESSION_PREF_KEYS } from '../config/storageKeys.js';
import { getDatabase } from '../database/index.js';

const prefs = () => getDatabase().sessionPreferences;

export function markFullscreenHintAfterLogin() {
  try {
    prefs().set(SESSION_PREF_KEYS.FULLSCREEN_PENDING, '1');
    prefs().remove(SESSION_PREF_KEYS.FULLSCREEN_DISMISSED);
  } catch {
    /* ignore */
  }
}

export function isFullscreen() {
  return Boolean(document.fullscreenElement || document.webkitFullscreenElement);
}

export async function requestFullscreen() {
  const el = document.documentElement;
  try {
    if (el.requestFullscreen) await el.requestFullscreen();
    else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
  } catch {
    /* blocked */
  }
}

/** Call this just before navigating away while fullscreen. */
export function saveFullscreenState() {
  try {
    if (isFullscreen()) {
      sessionStorage.setItem('jinx_restore_fullscreen', '1');
    } else {
      sessionStorage.removeItem('jinx_restore_fullscreen');
    }
  } catch { /* ignore */ }
}

/**
 * Call this on the next page load.
 * If the user was fullscreen on the previous page, re-enters fullscreen
 * automatically (browsers allow this if called quickly after a user gesture
 * that triggered the navigation).
 */
export function restoreFullscreenIfRequested() {
  try {
    const flag = sessionStorage.getItem('jinx_restore_fullscreen');
    if (!flag) return;
    sessionStorage.removeItem('jinx_restore_fullscreen');
    // Re-enter fullscreen as soon as the page is interactive.
    // We use a small delay so the page has time to paint first.
    setTimeout(async () => {
      if (isFullscreen()) return; // already in fullscreen somehow
      await requestFullscreen();
    }, 200);
  } catch { /* ignore */ }
}

function injectStyles() {
  if (document.getElementById('jinx-fullscreen-hint-styles')) return;
  const style = document.createElement('style');
  style.id = 'jinx-fullscreen-hint-styles';
  style.textContent = `
    .jinx-fs-hint {
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%) translateY(120%);
      z-index: 10000;
      display: flex;
      align-items: flex-start;
      gap: 14px;
      max-width: min(520px, calc(100vw - 32px));
      padding: 14px 16px;
      background: rgba(20, 24, 32, 0.96);
      border: 1px solid rgba(56, 139, 253, 0.45);
      border-radius: 10px;
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.55);
      backdrop-filter: blur(10px);
      font-family: 'Inter', system-ui, sans-serif;
      color: #e6edf3;
      opacity: 0;
      transition: transform 0.35s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.3s ease;
      pointer-events: none;
    }
    .jinx-fs-hint.visible {
      transform: translateX(-50%) translateY(0);
      opacity: 1;
      pointer-events: auto;
    }
    .jinx-fs-hint-icon {
      flex-shrink: 0;
      width: 36px;
      height: 36px;
      border-radius: 8px;
      background: rgba(31, 111, 235, 0.2);
      color: #58a6ff;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .jinx-fs-hint-body { flex: 1; min-width: 0; }
    .jinx-fs-hint-title { font-size: 13px; font-weight: 600; margin-bottom: 4px; color: #fff; }
    .jinx-fs-hint-text { font-size: 12px; line-height: 1.5; color: #8b949e; margin: 0; }
    .jinx-fs-hint-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
    .jinx-fs-hint-btn {
      font-family: inherit; font-size: 12px; font-weight: 500;
      padding: 6px 12px; border-radius: 6px; cursor: pointer;
      border: 1px solid transparent;
    }
    .jinx-fs-hint-btn.primary { background: #1f6feb; color: #fff; }
    .jinx-fs-hint-btn.primary:hover { background: #388bfd; }
    .jinx-fs-hint-btn.ghost {
      background: transparent; color: #c9d1d9;
      border-color: rgba(255, 255, 255, 0.12);
    }
    .jinx-fs-hint-btn.ghost:hover { background: rgba(255, 255, 255, 0.05); }
    .jinx-fs-hint-close {
      flex-shrink: 0; background: none; border: none;
      color: #8b949e; cursor: pointer; font-size: 18px; padding: 2px;
    }
    .jinx-fs-hint-close:hover { color: #e6edf3; }
  `;
  document.head.appendChild(style);
}

function buildBanner() {
  const tag = 'di' + 'v';
  const banner = document.createElement(tag);
  banner.id = 'jinx-fullscreen-hint';
  banner.className = 'jinx-fs-hint';
  banner.setAttribute('role', 'dialog');
  banner.setAttribute('aria-live', 'polite');

  const icon = document.createElement(tag);
  icon.className = 'jinx-fs-hint-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path></svg>';

  const body = document.createElement(tag);
  body.className = 'jinx-fs-hint-body';

  const title = document.createElement(tag);
  title.className = 'jinx-fs-hint-title';
  title.textContent = 'Use fullscreen for the best experience';

  const text = document.createElement('p');
  text.className = 'jinx-fs-hint-text';
  text.textContent =
    'JINX simulators use the full viewport for 3D views, panels, and telemetry. Fullscreen reduces clutter and gives more room for the robot workspace.';

  const actions = document.createElement(tag);
  actions.className = 'jinx-fs-hint-actions';

  const fsBtn = document.createElement('button');
  fsBtn.type = 'button';
  fsBtn.className = 'jinx-fs-hint-btn primary';
  fsBtn.dataset.action = 'fullscreen';
  fsBtn.textContent = 'Enter fullscreen';

  const dismissBtn = document.createElement('button');
  dismissBtn.type = 'button';
  dismissBtn.className = 'jinx-fs-hint-btn ghost';
  dismissBtn.dataset.action = 'dismiss';
  dismissBtn.textContent = 'Not now';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'jinx-fs-hint-close';
  closeBtn.dataset.action = 'dismiss';
  closeBtn.setAttribute('aria-label', 'Dismiss');
  closeBtn.textContent = '×';

  actions.append(fsBtn, dismissBtn);
  body.append(title, text, actions);
  banner.append(icon, body, closeBtn);

  return banner;
}

export function showFullscreenHintIfNeeded({ delayMs = 600 } = {}) {
  try {
    if (prefs().get(SESSION_PREF_KEYS.FULLSCREEN_DISMISSED)) return;
    if (!prefs().get(SESSION_PREF_KEYS.FULLSCREEN_PENDING)) return;
    if (isFullscreen()) {
      prefs().remove(SESSION_PREF_KEYS.FULLSCREEN_PENDING);
      return;
    }
  } catch {
    return;
  }

  setTimeout(() => {
    if (isFullscreen()) return;
    try {
      if (prefs().get(SESSION_PREF_KEYS.FULLSCREEN_DISMISSED)) return;
    } catch {
      return;
    }

    injectStyles();
    document.getElementById('jinx-fullscreen-hint')?.remove();

    const node = buildBanner();
    document.body.appendChild(node);

    const dismiss = () => {
      try {
        prefs().set(SESSION_PREF_KEYS.FULLSCREEN_DISMISSED, '1');
        prefs().remove(SESSION_PREF_KEYS.FULLSCREEN_PENDING);
      } catch { /* ignore */ }
      node?.classList.remove('visible');
      setTimeout(() => node?.remove(), 350);
    };

    node.querySelector('[data-action="fullscreen"]')?.addEventListener('click', async () => {
      await requestFullscreen();
      if (isFullscreen()) dismiss();
    });
    node.querySelectorAll('[data-action="dismiss"]').forEach((btn) => {
      btn.addEventListener('click', dismiss);
    });

    document.addEventListener('fullscreenchange', function onFs() {
      if (isFullscreen()) {
        document.removeEventListener('fullscreenchange', onFs);
        dismiss();
      }
    });

    requestAnimationFrame(() => requestAnimationFrame(() => node.classList.add('visible')));
  }, delayMs);
}
