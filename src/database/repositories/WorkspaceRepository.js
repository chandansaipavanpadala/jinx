import { STORAGE_KEYS } from '../../config/storageKeys.js';
import { resolveAppPath } from '../../config/appConfig.js';

/** Built-in workstation catalog (static; paths resolved at runtime). */
export const WORKSPACE_CATALOG = [
  {
    id: 'rrr',
    name: '3-DOF RRR Shadow Lamp',
    path: 'src/pages/rrr-lamp.html',
    thumb: '/images/login-robot.png',
    dof: 3,
    tags: ['rrr', 'shadow', 'ik'],
  },
  {
    id: 'scara',
    name: '4-DOF SCARA Pick & Place',
    path: 'src/pages/scara.html',
    thumb: '/images/scara.png',
    dof: 4,
    tags: ['scara', 'pnp'],
  },
  {
    id: 'welder',
    name: '6-DOF Welding Cell',
    path: 'src/pages/welder.html',
    thumb: '/images/6dof.jpeg',
    dof: 6,
    tags: ['welder', '6dof'],
  },
];

/**
 * @typedef {Object} RecentWorkspaceEntry
 * @property {string} id
 * @property {string} visitedAt — ISO timestamp
 */

export class WorkspaceRepository {
  /** @param {import('../drivers/StorageDriver.js').StorageDriver} driver */
  constructor(driver) {
    this._driver = driver;
    this._recentKey = STORAGE_KEYS.RECENT_WORKSPACES;
    this._configsKey = STORAGE_KEYS.SAVED_CONFIGS;
  }

  getCatalog() {
    return WORKSPACE_CATALOG.map((ws) => ({
      ...ws,
      href: resolveAppPath(ws.path),
    }));
  }

  findById(id) {
    return this.getCatalog().find((w) => w.id === id) || null;
  }

  /** @returns {RecentWorkspaceEntry[]} */
  getRecent() {
    const raw = this._driver.get(this._recentKey);
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  /** @param {string} workspaceId */
  recordVisit(workspaceId) {
    const ws = this.findById(workspaceId);
    if (!ws) return;
    const entry = { id: workspaceId, visitedAt: new Date().toISOString() };
    const next = [
      entry,
      ...this.getRecent().filter((r) => r.id !== workspaceId),
    ].slice(0, 12);
    this._driver.set(this._recentKey, JSON.stringify(next));
  }

  /** @returns {Object[]} */
  getSavedConfigs() {
    const raw = this._driver.get(this._configsKey);
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  /** @param {Object} config */
  saveConfig(config) {
    const list = this.getSavedConfigs();
    const id = config.id || crypto.randomUUID();
    const next = [{ ...config, id, updatedAt: new Date().toISOString() }, ...list.filter((c) => c.id !== id)].slice(0, 50);
    this._driver.set(this._configsKey, JSON.stringify(next));
    return id;
  }

  removeConfig(id) {
    const next = this.getSavedConfigs().filter((c) => c.id !== id);
    this._driver.set(this._configsKey, JSON.stringify(next));
  }
}
