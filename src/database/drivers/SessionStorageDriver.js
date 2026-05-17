/**
 * @implements {import('./StorageDriver.js').StorageDriver}
 */
export class SessionStorageDriver {
  constructor(storage = globalThis.sessionStorage) {
    this._storage = storage;
  }

  get(key) {
    try {
      return this._storage.getItem(key);
    } catch {
      return null;
    }
  }

  set(key, value) {
    try {
      this._storage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }

  remove(key) {
    try {
      this._storage.removeItem(key);
    } catch {
      /* ignore */
    }
  }

  has(key) {
    return this.get(key) != null;
  }
}
