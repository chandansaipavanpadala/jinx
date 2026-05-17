import { STORAGE_KEYS } from '../../config/storageKeys.js';

/**
 * Workstation user profile (single-user local deployment).
 * @typedef {Object} UserRecord
 * @property {string} email
 * @property {string} displayName
 * @property {string} passwordHash
 * @property {string} salt
 * @property {string} createdAt
 * @property {boolean} [seeded]
 */

export class UserRepository {
  /** @param {import('../drivers/StorageDriver.js').StorageDriver} driver */
  constructor(driver) {
    this._driver = driver;
    this._key = STORAGE_KEYS.USER;
  }

  hasUser() {
    return this._driver.has(this._key);
  }

  /** @returns {UserRecord|null} */
  getUser() {
    const raw = this._driver.get(this._key);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  /** @param {UserRecord} user */
  saveUser(user) {
    this._driver.set(this._key, JSON.stringify(user));
  }

  clearUser() {
    this._driver.remove(this._key);
  }
}
