import { appConfig } from '../config/appConfig.js';
import { getDatabase } from '../database/index.js';

const db = () => getDatabase();

async function hashPassword(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: enc.encode(salt),
      iterations: 120000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256,
  );
  return Array.from(new Uint8Array(bits))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function readSession() {
  const session = db().sessions.read();
  if (!session) return null;
  if (session.expiresAt && Date.now() > session.expiresAt) {
    AuthService.logout();
    return null;
  }
  return session;
}

function writeSession(session, remember) {
  db().sessions.write(session, remember);
}

export const AuthService = {
  getDefaultCredentials() {
    if (!appConfig.auth.allowSeedUser) {
      return { email: '', password: '' };
    }
    return {
      email: appConfig.auth.seedEmail,
      password: '',
    };
  },

  /** Creates the configured seed profile once; does not sign you in. */
  async seedDefaultUserIfEmpty() {
    if (!appConfig.auth.allowSeedUser) return false;
    if (db().users.hasUser()) return false;

    const email = appConfig.auth.seedEmail.trim().toLowerCase();
    const password = appConfig.auth.seedPassword;
    if (!email || !password) return false;

    const salt = crypto.randomUUID();
    const passwordHash = await hashPassword(password, salt);
    db().users.saveUser({
      email,
      displayName: appConfig.auth.seedDisplayName,
      passwordHash,
      salt,
      createdAt: new Date().toISOString(),
      seeded: true,
    });
    return true;
  },

  needsSetup() {
    return !db().users.hasUser();
  },

  isAuthenticated() {
    const session = readSession();
    return Boolean(session?.authenticated);
  },

  getCurrentUser() {
    if (!this.isAuthenticated()) return null;
    const user = db().users.getUser();
    if (!user) return null;
    const { passwordHash, salt, ...profile } = user;
    return profile;
  },

  async createAccount({ email, password, displayName }) {
    if (db().users.hasUser()) {
      throw new Error('An account already exists on this workstation.');
    }
    const normalizedEmail = email.trim().toLowerCase();
    const salt = crypto.randomUUID();
    const passwordHash = await hashPassword(password, salt);
    db().users.saveUser({
      email: normalizedEmail,
      displayName: (displayName || normalizedEmail.split('@')[0]).trim(),
      passwordHash,
      salt,
      createdAt: new Date().toISOString(),
    });
    return this.login({ email: normalizedEmail, password, remember: true });
  },

  async login({ email, password, remember = false }) {
    const user = db().users.getUser();
    if (!user) {
      throw new Error('No account found. Create your workstation profile first.');
    }
    const normalizedEmail = email.trim().toLowerCase();
    if (normalizedEmail !== user.email) {
      throw new Error('Invalid email or password.');
    }
    const passwordHash = await hashPassword(password, user.salt);
    if (passwordHash !== user.passwordHash) {
      throw new Error('Invalid email or password.');
    }
    const session = {
      authenticated: true,
      email: user.email,
      expiresAt: remember
        ? Date.now() + appConfig.auth.rememberTtlMs
        : Date.now() + appConfig.auth.sessionTtlMs,
    };
    writeSession(session, remember);
    return user;
  },

  logout() {
    db().sessions.clear();
  },

  async updateProfile({ displayName, email }) {
    const user = db().users.getUser();
    if (!user) throw new Error('No user profile found.');
    const nextEmail = (email || user.email).trim().toLowerCase();
    db().users.saveUser({
      ...user,
      email: nextEmail,
      displayName: (displayName || user.displayName).trim(),
    });
    const session = readSession();
    if (session) {
      session.email = nextEmail;
      writeSession(session, db().sessions.isRemembered());
    }
    return this.getCurrentUser();
  },

  async changePassword({ currentPassword, newPassword }) {
    const user = db().users.getUser();
    if (!user) throw new Error('No user profile found.');
    const currentHash = await hashPassword(currentPassword, user.salt);
    if (currentHash !== user.passwordHash) {
      throw new Error('Current password is incorrect.');
    }
    const salt = crypto.randomUUID();
    const passwordHash = await hashPassword(newPassword, salt);
    db().users.saveUser({ ...user, salt, passwordHash });
    return true;
  },

  async resetPassword({ email, newPassword }) {
    const user = db().users.getUser();
    if (!user) throw new Error('No account on this workstation.');
    if (email.trim().toLowerCase() !== user.email) {
      throw new Error('Email does not match the registered account.');
    }
    const salt = crypto.randomUUID();
    const passwordHash = await hashPassword(newPassword, salt);
    db().users.saveUser({ ...user, salt, passwordHash });
    this.logout();
    return true;
  },
};
