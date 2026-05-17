import { STORAGE_KEYS } from '../../config/storageKeys.js';

/**
 * Key-value preferences (session or persistent scope).
 */
export class PreferencesRepository {
  /** @param {import('../drivers/StorageDriver.js').StorageDriver} driver */
  constructor(driver) {
    this._driver = driver;
    this._key = STORAGE_KEYS.PREFERENCES;
  }

  _readAll() {
    const raw = this._driver.get(this._key);
    if (!raw) return {};
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  _writeAll(obj) {
    this._driver.set(this._key, JSON.stringify(obj));
  }

  get(field) {
    return this._readAll()[field] ?? null;
  }

  set(field, value) {
    const all = this._readAll();
    all[field] = value;
    this._writeAll(all);
  }

  remove(field) {
    const all = this._readAll();
    delete all[field];
    this._writeAll(all);
  }

  clear() {
    this._driver.remove(this._key);
  }
}
