import { AuthService } from './auth/AuthService.js';
import { redirectIfAuthenticated, homeUrl } from './auth/authGuard.js';
import { markFullscreenHintAfterLogin } from './ui/FullscreenHint.js';
import { appConfig } from './config/appConfig.js';

const form = document.getElementById('auth-form');
const formTitle = document.getElementById('form-title');
const formSubtitle = document.getElementById('form-subtitle');
const submitBtn = document.getElementById('submit-btn');
const errorEl = document.getElementById('login-error');
const fieldDisplayName = document.getElementById('field-display-name');
const fieldConfirmPassword = document.getElementById('field-confirm-password');
const loginOptions = document.getElementById('login-options');
const cardFooter = document.getElementById('card-footer');
const setupLink = document.getElementById('setup-link');
const forgotLink = document.getElementById('forgot-password');
const togglePw = document.getElementById('toggle-password');
const passwordInput = document.getElementById('password');
const resetModal = document.getElementById('reset-modal');
const resetForm = document.getElementById('reset-form');
const resetError = document.getElementById('reset-error');

let setupMode = false;

document.getElementById('year').textContent = new Date().getFullYear();

async function boot() {
  if (appConfig.auth.allowSeedUser) {
    await AuthService.seedDefaultUserIfEmpty();
  }
  setupMode = AuthService.needsSetup();

  if (redirectIfAuthenticated()) return;

  applyMode(setupMode);
  const emailEl = document.getElementById('email');
  if (!setupMode && emailEl && appConfig.auth.prefillLoginEmail && appConfig.auth.seedEmail) {
    emailEl.value = appConfig.auth.seedEmail;
  }

  if (setupMode && !appConfig.auth.allowSeedUser) {
    showError(
      'First visit on this site: create your workstation profile below (local dev passwords do not apply here).',
    );
  }
}

boot();

function applyMode(isSetup) {
  setupMode = isSetup;
  if (isSetup) {
    formTitle.textContent = 'Create your profile';
    formSubtitle.textContent = 'Set up your single-user JINX workstation account';
    submitBtn.textContent = 'Create Account';
    fieldDisplayName.style.display = '';
    fieldConfirmPassword.style.display = '';
    loginOptions.style.display = 'none';
    cardFooter.innerHTML =
      'Already have an account? <a href="#" class="login-link" id="signin-link">Sign in</a>';
    document.getElementById('signin-link')?.addEventListener('click', (e) => {
      e.preventDefault();
      if (AuthService.needsSetup()) return;
      applyMode(false);
    });
    passwordInput.autocomplete = 'new-password';
  } else {
    formTitle.textContent = 'Welcome back';
    formSubtitle.textContent = 'Sign in to your JINX account';
    submitBtn.textContent = 'Sign In';
    fieldDisplayName.style.display = 'none';
    fieldConfirmPassword.style.display = 'none';
    loginOptions.style.display = '';
    cardFooter.innerHTML =
      'Don\'t have an account? <a href="#" class="login-link" id="setup-link">Create your profile</a>.';
    bindSetupLink();
    passwordInput.autocomplete = 'current-password';
  }
}

function bindSetupLink() {
  const link = document.getElementById('setup-link');
  if (!link) return;
  link.textContent = 'Create your profile';
  link.addEventListener('click', (e) => {
    e.preventDefault();
    applyMode(true);
  });
}

bindSetupLink();

function showError(message) {
  errorEl.textContent = message;
  errorEl.classList.add('visible');
}

function clearError() {
  errorEl.textContent = '';
  errorEl.classList.remove('visible');
}

togglePw.addEventListener('click', () => {
  const isPassword = passwordInput.type === 'password';
  passwordInput.type = isPassword ? 'text' : 'password';
  togglePw.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
});

forgotLink.addEventListener('click', (e) => {
  e.preventDefault();
  if (AuthService.needsSetup()) {
    showError('Create your profile first.');
    return;
  }
  resetError.textContent = '';
  resetError.classList.remove('visible');
  resetModal.classList.add('active');
});

document.getElementById('reset-cancel').addEventListener('click', () => {
  resetModal.classList.remove('active');
});

resetModal.addEventListener('click', (e) => {
  if (e.target === resetModal) resetModal.classList.remove('active');
});

resetForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  resetError.textContent = '';
  resetError.classList.remove('visible');
  try {
    await AuthService.resetPassword({
      email: document.getElementById('reset-email').value,
      newPassword: document.getElementById('reset-password').value,
    });
    resetModal.classList.remove('active');
    applyMode(false);
    showError('Password updated. Sign in with your new password.');
  } catch (err) {
    resetError.textContent = err.message;
    resetError.classList.add('visible');
  }
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError();
  submitBtn.disabled = true;

  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  const remember = document.getElementById('remember-me')?.checked ?? false;

  try {
    if (setupMode) {
      const confirm = document.getElementById('confirm-password').value;
      if (password !== confirm) {
        throw new Error('Passwords do not match.');
      }
      if (password.length < 6) {
        throw new Error('Password must be at least 6 characters.');
      }
      await AuthService.createAccount({
        email,
        password,
        displayName: document.getElementById('display-name').value,
      });
    } else {
      await AuthService.login({ email, password, remember });
    }

    markFullscreenHintAfterLogin();
    const params = new URLSearchParams(window.location.search);
    const ret = params.get('return');
    window.location.replace(ret ? decodeURIComponent(ret) : homeUrl());
  } catch (err) {
    showError(err.message || 'Authentication failed.');
    submitBtn.disabled = false;
  }
});
