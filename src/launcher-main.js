/**
 * Launcher entry — auth UI + database-backed workspace navigation.
 */
import './launcher-auth.js';
import { getDatabase } from './database/index.js';
import { resolveAppPath } from './config/appConfig.js';

function assetUrl(path) {
  const p = path.startsWith('/') ? path.slice(1) : path;
  return resolveAppPath(p);
}

function initWorkspaceNavigation() {
  const db = getDatabase();
  const catalog = db.workspaces.getCatalog();
  const byId = Object.fromEntries(catalog.map((w) => [w.id, w]));

  document.querySelectorAll('.ws-card[data-workspace-id]').forEach((card) => {
    const id = card.dataset.workspaceId;
    const ws = byId[id];
    if (!ws) return;
    card.setAttribute('href', ws.href);
    card.addEventListener('click', () => db.workspaces.recordVisit(id));
  });

  const tableBody = document.querySelector('#recent-workspaces-tbody');
  if (tableBody) {
    const recent = db.workspaces.getRecent();
    if (recent.length) {
      renderRecentTable(tableBody, recent, byId, db);
    } else {
      tableBody.querySelectorAll('tr[data-workspace-id]').forEach((tr) => {
        const id = tr.dataset.workspaceId;
        const ws = byId[id];
        if (!ws) return;
        tr.style.cursor = 'pointer';
        tr.addEventListener('click', (e) => {
          if (!e.target.closest('.table-actions')) {
            db.workspaces.recordVisit(id);
            window.location.href = ws.href;
          }
        });
      });
    }
  }

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    const map = { 1: 'rrr', 2: 'scara', 3: 'welder' };
    const id = map[e.key];
    if (id && byId[id]) {
      e.preventDefault();
      db.workspaces.recordVisit(id);
      window.location.href = byId[id].href;
    }
  });

  initRecentAndConfigsViews(db);
}

function renderRecentTable(tbody, recent, byId, db) {
  tbody.innerHTML = '';
  for (const entry of recent.slice(0, 8)) {
    const ws = byId[entry.id];
    if (!ws) continue;
    const tr = document.createElement('tr');
    tr.style.cursor = 'pointer';
    const visited = new Date(entry.visitedAt);
    const timeStr = Number.isNaN(visited.getTime())
      ? '—'
      : visited.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
    tr.innerHTML = `
      <td><div class="table-name"><div class="table-thumb"><img src="${assetUrl(ws.thumb)}" alt="" /></div>${ws.name}</div></td>
      <td>${ws.dof}-DOF</td>
      <td>${ws.dof}</td>
      <td>${timeStr}</td>
      <td><div class="table-actions"><span aria-hidden="true">&gt;</span></div></td>`;
    const open = () => {
      db.workspaces.recordVisit(ws.id);
      window.location.href = ws.href;
    };
    tr.addEventListener('click', (e) => {
      if (!e.target.closest('.table-actions')) open();
    });
    tbody.appendChild(tr);
  }
}

function initRecentAndConfigsViews(db) {
  const recentPanel = document.getElementById('view-recent');
  if (recentPanel) {
    const recent = db.workspaces.getRecent();
    const catalog = db.workspaces.getCatalog();
    const byId = Object.fromEntries(catalog.map((w) => [w.id, w]));
    const placeholder = recentPanel.querySelector('p');
    if (placeholder && recent.length) {
      const ul = document.createElement('ul');
      ul.className = 'recent-list';
      ul.style.cssText = 'list-style:none;padding:0;margin:12px 0;';
      for (const r of recent) {
        const ws = byId[r.id];
        if (!ws) continue;
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = ws.href;
        a.textContent = `${ws.name} — ${new Date(r.visitedAt).toLocaleString()}`;
        a.style.cssText = 'color:var(--accent);display:block;padding:8px 0;';
        a.addEventListener('click', () => db.workspaces.recordVisit(ws.id));
        li.appendChild(a);
        ul.appendChild(li);
      }
      placeholder.replaceWith(ul);
    }
  }

  const configsPanel = document.getElementById('view-configs');
  if (configsPanel) {
    const saved = db.workspaces.getSavedConfigs();
    const p = configsPanel.querySelector('p');
    if (p && saved.length) {
      p.textContent = `${saved.length} saved configuration(s).`;
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initWorkspaceNavigation);
} else {
  initWorkspaceNavigation();
}
