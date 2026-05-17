import { AuthService } from './auth/AuthService.js';
import { requireAuth, loginUrl } from './auth/authGuard.js';
import { showFullscreenHintIfNeeded } from './ui/FullscreenHint.js';

let profileUiReady = false;

if (!requireAuth()) {
  // redirecting to login
} else {
  initProfileUI();
  showFullscreenHintIfNeeded({ delayMs: 800 });
}

function initProfileUI() {
  const avatar = document.querySelector('.user-avatar');
  if (!avatar) return;

  const user = AuthService.getCurrentUser();
  const initials = getInitials(user?.displayName || user?.email || 'U');

  avatar.innerHTML = `<span class="user-initials">${initials}</span>`;
  avatar.setAttribute('title', user?.displayName || user?.email || 'Profile');
  avatar.setAttribute('aria-label', 'Open user profile');

  let menu = document.getElementById('profile-menu');
  if (!menu) {
    menu = document.createElement('div');
    menu.id = 'profile-menu';
    menu.className = 'profile-menu';
    menu.innerHTML = `
      <div class="profile-menu-header">
        <div class="profile-menu-avatar" id="menu-avatar"></div>
        <div>
          <div class="profile-menu-name" id="menu-name"></div>
          <div class="profile-menu-email" id="menu-email"></div>
        </div>
      </div>
      <button type="button" class="profile-menu-item" data-action="edit">Edit profile</button>
      <button type="button" class="profile-menu-item" data-action="password">Change password</button>
      <button type="button" class="profile-menu-item danger" data-action="logout">Sign out</button>
    `;
    document.body.appendChild(menu);
    injectProfileStyles();

    menu.querySelector('[data-action="logout"]').addEventListener('click', () => {
      AuthService.logout();
      window.location.href = loginUrl();
    });

    menu.querySelector('[data-action="edit"]').addEventListener('click', () => {
      menu.classList.remove('open');
      openProfileModal('profile');
    });

    menu.querySelector('[data-action="password"]').addEventListener('click', () => {
      menu.classList.remove('open');
      openProfileModal('password');
    });
  }

  document.getElementById('menu-avatar').textContent = initials;
  document.getElementById('menu-name').textContent = user?.displayName || 'User';
  document.getElementById('menu-email').textContent = user?.email || '';

  if (!profileUiReady) {
    avatar.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = menu.classList.toggle('open');
      if (open) {
        const rect = avatar.getBoundingClientRect();
        menu.style.top = `${rect.bottom + 8}px`;
        menu.style.right = `${window.innerWidth - rect.right}px`;
      }
    });

    document.addEventListener('click', () => menu.classList.remove('open'));
    profileUiReady = true;
  }

  ensureProfileModal();
  populateProfileModal(user);
}

function getInitials(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return (parts[0]?.[0] || 'U').toUpperCase();
}

function injectProfileStyles() {
  if (document.getElementById('profile-styles')) return;
  const style = document.createElement('style');
  style.id = 'profile-styles';
  style.textContent = `
    .user-avatar { font-size: 11px; font-weight: 600; color: var(--accent); }
    .user-initials { line-height: 1; }
    .profile-menu {
      position: fixed; z-index: 2000; min-width: 220px;
      background: var(--bg-card, #16181e);
      border: 1px solid var(--border-color, rgba(255,255,255,0.08));
      border-radius: 8px; box-shadow: 0 12px 32px rgba(0,0,0,0.45);
      padding: 8px 0; opacity: 0; pointer-events: none;
      transform: translateY(-4px); transition: opacity 0.15s, transform 0.15s;
    }
    .profile-menu.open { opacity: 1; pointer-events: auto; transform: translateY(0); }
    .profile-menu-header {
      display: flex; align-items: center; gap: 12px;
      padding: 12px 16px; border-bottom: 1px solid var(--border-color, rgba(255,255,255,0.08));
      margin-bottom: 4px;
    }
    .profile-menu-avatar {
      width: 36px; height: 36px; border-radius: 50%;
      background: rgba(31, 111, 235, 0.2); color: var(--accent);
      display: flex; align-items: center; justify-content: center;
      font-weight: 700; font-size: 13px;
    }
    .profile-menu-name { font-size: 13px; font-weight: 600; color: #fff; }
    .profile-menu-email { font-size: 11px; color: var(--text-muted, #8b949e); margin-top: 2px; }
    .profile-menu-item {
      display: block; width: 100%; text-align: left;
      padding: 10px 16px; background: none; border: none;
      color: var(--text-main, #c9d1d9); font-family: inherit; font-size: 12px; cursor: pointer;
    }
    .profile-menu-item:hover { background: rgba(255,255,255,0.04); }
    .profile-menu-item.danger { color: #f85149; }
    .profile-field { margin-bottom: 14px; }
    .profile-field label {
      display: block; font-size: 10px; text-transform: uppercase;
      color: var(--text-muted); margin-bottom: 6px; letter-spacing: 0.05em;
    }
    .profile-field input {
      width: 100%; padding: 8px 10px; border-radius: 6px;
      border: 1px solid var(--border-color); background: #010409;
      color: var(--text-main); font-family: inherit; font-size: 13px;
    }
    .profile-tabs { display: flex; gap: 8px; margin-bottom: 16px; }
    .profile-tab {
      flex: 1; padding: 8px; border: 1px solid var(--border-color);
      background: transparent; color: var(--text-muted); border-radius: 6px;
      font-family: inherit; font-size: 12px; cursor: pointer;
    }
    .profile-tab.active {
      border-color: var(--accent); color: var(--accent);
      background: rgba(31, 111, 235, 0.1);
    }
    .profile-msg { font-size: 12px; margin-bottom: 12px; display: none; }
    .profile-msg.error { color: #f85149; display: block; }
    .profile-msg.success { color: var(--success, #3fb950); display: block; }
  `;
  document.head.appendChild(style);
}

function ensureProfileModal() {
  if (document.getElementById('profile-modal')) return;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'profile-modal';
  overlay.innerHTML = `
    <div class="modal-container" style="width: 420px;">
      <div class="modal-header">
        <div class="modal-title">User Profile</div>
        <button type="button" class="modal-close" id="profile-modal-close">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
      <div class="modal-body">
        <div class="profile-tabs">
          <button type="button" class="profile-tab active" data-tab="profile">Profile</button>
          <button type="button" class="profile-tab" data-tab="password">Password</button>
        </div>
        <div class="profile-msg" id="profile-msg"></div>
        <form id="profile-form">
          <div class="profile-panel" data-panel="profile">
            <div class="profile-field">
              <label for="pf-display-name">Display name</label>
              <input type="text" id="pf-display-name" required />
            </div>
            <div class="profile-field">
              <label for="pf-email">Email</label>
              <input type="email" id="pf-email" required />
            </div>
          </div>
          <div class="profile-panel" data-panel="password" style="display:none;">
            <div class="profile-field">
              <label for="pf-current-pw">Current password</label>
              <input type="password" id="pf-current-pw" autocomplete="current-password" />
            </div>
            <div class="profile-field">
              <label for="pf-new-pw">New password</label>
              <input type="password" id="pf-new-pw" minlength="6" autocomplete="new-password" />
            </div>
            <div class="profile-field">
              <label for="pf-confirm-pw">Confirm new password</label>
              <input type="password" id="pf-confirm-pw" minlength="6" autocomplete="new-password" />
            </div>
          </div>
          <button type="submit" class="btn-primary" style="width:100%; margin-top:8px; justify-content:center;">Save changes</button>
        </form>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => overlay.classList.remove('active');
  document.getElementById('profile-modal-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  const tabs = overlay.querySelectorAll('.profile-tab');
  const panels = overlay.querySelectorAll('.profile-panel');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      const id = tab.dataset.tab;
      panels.forEach((p) => {
        p.style.display = p.dataset.panel === id ? '' : 'none';
      });
    });
  });

  document.getElementById('profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('profile-msg');
    msg.className = 'profile-msg';
    msg.textContent = '';

    const activeTab = overlay.querySelector('.profile-tab.active')?.dataset.tab || 'profile';

    try {
      if (activeTab === 'profile') {
        await AuthService.updateProfile({
          displayName: document.getElementById('pf-display-name').value,
          email: document.getElementById('pf-email').value,
        });
        msg.textContent = 'Profile updated.';
        msg.classList.add('success');
        initProfileUI();
      } else {
        const next = document.getElementById('pf-new-pw').value;
        const confirm = document.getElementById('pf-confirm-pw').value;
        if (next !== confirm) throw new Error('New passwords do not match.');
        if (next.length < 6) throw new Error('Password must be at least 6 characters.');
        await AuthService.changePassword({
          currentPassword: document.getElementById('pf-current-pw').value,
          newPassword: next,
        });
        msg.textContent = 'Password changed successfully.';
        msg.classList.add('success');
        document.getElementById('pf-current-pw').value = '';
        document.getElementById('pf-new-pw').value = '';
        document.getElementById('pf-confirm-pw').value = '';
      }
    } catch (err) {
      msg.textContent = err.message;
      msg.classList.add('error');
    }
  });
}

function populateProfileModal(user) {
  const nameEl = document.getElementById('pf-display-name');
  const emailEl = document.getElementById('pf-email');
  if (nameEl && user) nameEl.value = user.displayName || '';
  if (emailEl && user) emailEl.value = user.email || '';
}

function openProfileModal(tab) {
  const overlay = document.getElementById('profile-modal');
  if (!overlay) return;
  populateProfileModal(AuthService.getCurrentUser());
  const msg = document.getElementById('profile-msg');
  if (msg) {
    msg.className = 'profile-msg';
    msg.textContent = '';
  }
  overlay.querySelectorAll('.profile-tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  overlay.querySelectorAll('.profile-panel').forEach((p) => {
    p.style.display = p.dataset.panel === tab ? '' : 'none';
  });
  overlay.classList.add('active');
}
