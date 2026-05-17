import { STORAGE_KEYS } from '../../config/storageKeys.js';

/**
 * @typedef {Object} SessionRecord
 * @property {boolean} authenticated
 * @property {string} email
 * @property {number} expiresAt
 */

export class SessionRepository {
  /**
   * @param {import('../drivers/StorageDriver.js').StorageDriver} sessionDriver
   * @param {import('../drivers/StorageDriver.js').StorageDriver} persistentDriver
   */
  constructor(sessionDriver, persistentDriver) {
    this._session = sessionDriver;
    this._persistent = persistentDriver;
    this._sessionKey = STORAGE_KEYS.SESSION;
    this._rememberKey = STORAGE_KEYS.SESSION_REMEMBER;
  }

  /** @returns {SessionRecord|null} */
  read() {
    const raw =
      this._persistent.get(this._rememberKey) ||
      this._session.get(this._sessionKey);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  /** @param {SessionRecord} record @param {boolean} remember */
  write(record, remember) {
    const payload = JSON.stringify(record);
    this._session.remove(this._sessionKey);
    this._persistent.remove(this._rememberKey);
    if (remember) {
      this._persistent.set(this._rememberKey, payload);
    } else {
      this._session.set(this._sessionKey, payload);
    }
  }

  clear() {
    this._session.remove(this._sessionKey);
    this._persistent.remove(this._rememberKey);
  }

  isRemembered() {
    return this._persistent.has(this._rememberKey);
  }
}
