import { appConfig } from '../config/appConfig.js';
import { SESSION_PREF_KEYS } from '../config/storageKeys.js';
import { LocalStorageDriver } from './drivers/LocalStorageDriver.js';
import { SessionStorageDriver } from './drivers/SessionStorageDriver.js';
import { UserRepository } from './repositories/UserRepository.js';
import { SessionRepository } from './repositories/SessionRepository.js';
import { PreferencesRepository } from './repositories/PreferencesRepository.js';
import { WorkspaceRepository } from './repositories/WorkspaceRepository.js';

/** @typedef {Object} Database
 * @property {UserRepository} users
 * @property {SessionRepository} sessions
 * @property {PreferencesRepository} preferences
 * @property {PreferencesRepository} sessionPreferences
 * @property {WorkspaceRepository} workspaces
 */

let _db = null;

/** One-time migration from pre-modular storage keys. */
function migrateLegacyStorage(local, sessionDriver) {
  const legacy = [
    ['jinx_user', 'jinx_user_v1'],
    ['jinx_session', 'jinx_session_v1'],
    ['jinx_session_persistent', 'jinx_session_persistent_v1'],
  ];
  for (const [oldKey, newKey] of legacy) {
    const val = local.get(oldKey);
    if (!val) continue;
    if (!local.get(newKey)) local.set(newKey, val);
    local.remove(oldKey);
  }
  try {
    const prefs = new PreferencesRepository(sessionDriver);
    const pending = sessionStorage.getItem('jinx_pending_fullscreen_hint');
    const dismissed = sessionStorage.getItem('jinx_fullscreen_hint_dismissed');
    if (pending) {
      prefs.set(SESSION_PREF_KEYS.FULLSCREEN_PENDING, pending);
      sessionStorage.removeItem('jinx_pending_fullscreen_hint');
    }
    if (dismissed) {
      prefs.set(SESSION_PREF_KEYS.FULLSCREEN_DISMISSED, dismissed);
      sessionStorage.removeItem('jinx_fullscreen_hint_dismissed');
    }
  } catch {
    /* ignore */
  }
}

function assertLocalDriver() {
  if (appConfig.database.driver === 'api') {
    console.warn(
      '[JINX] VITE_DB_DRIVER=api is not fully wired; falling back to local storage. ' +
        'Implement API routes or set VITE_DB_DRIVER=local.',
    );
  }
}

/**
 * Singleton database access (repository pattern).
 * @returns {Database}
 */
export function getDatabase() {
  if (_db) return _db;

  assertLocalDriver();

  const local = new LocalStorageDriver();
  const session = new SessionStorageDriver();

  migrateLegacyStorage(local, session);

  _db = {
    users: new UserRepository(local),
    sessions: new SessionRepository(session, local),
    preferences: new PreferencesRepository(local),
    sessionPreferences: new PreferencesRepository(session),
    workspaces: new WorkspaceRepository(local),
  };

  return _db;
}

/** Reset singleton (tests). */
export function resetDatabase() {
  _db = null;
}
