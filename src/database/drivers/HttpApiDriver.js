import { appConfig } from '../../config/appConfig.js';

/**
 * Remote persistence driver (REST). Stub for future backend integration.
 * @implements {import('./StorageDriver.js').StorageDriver}
 */
export class HttpApiDriver {
  constructor(baseUrl = appConfig.database.apiBaseUrl) {
    this._baseUrl = baseUrl;
    if (!baseUrl) {
      console.warn('[JINX] HttpApiDriver: VITE_API_BASE_URL is not set.');
    }
  }

  _url(key) {
    return `${this._baseUrl}/storage/${encodeURIComponent(key)}`;
  }

  async get(key) {
    if (!this._baseUrl) return null;
    const res = await fetch(this._url(key), { credentials: 'include' });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Storage GET failed (${res.status})`);
    const data = await res.json();
    return data?.value ?? null;
  }

  async set(key, value) {
    if (!this._baseUrl) return false;
    const res = await fetch(this._url(key), {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    });
    return res.ok;
  }

  async remove(key) {
    if (!this._baseUrl) return;
    await fetch(this._url(key), { method: 'DELETE', credentials: 'include' });
  }

  has(key) {
    return this.get(key).then((v) => v != null);
  }
}
