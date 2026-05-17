/**
 * AnalyzerPanel.js — RoboAnalyzer-style kinematics workbench (SCARA pilot).
 */
import FloatingPanel from '../FloatingPanel.js';
import { fk, jacobian } from '../../math/KinematicsNDOF.js';
import { sampleWorkspaceSlice } from '../../analysis/WorkspaceSampler.js';
import { PathAnimator } from '../../analysis/PathAnimator.js';
import { setDhParameter, manipulabilityPosition } from '../../model/RobotModel.js';
import { applyScaraModelToRuntime, syncScaraModelFromRuntime } from '../../model/robots/ScaraModel.js';

const RAD = (v) => (v * 180) / Math.PI;

export default class AnalyzerPanel {
  constructor(opts) {
    this._mountRoot = opts.mountRoot;
    this._model = opts.model;
    this._getQ = opts.getQ;
    this._setQ = opts.setQ;
    this._onDhChange = opts.onDhChange;
    this._onWorkspaceOverlay = opts.onWorkspaceOverlay;
    this._onFramesToggle = opts.onFramesToggle;

    this._panel = null;
    this._mounted = false;
    this._tab = 'model';
    this._lastWorkspace = null;
    this._pathAnim = new PathAnimator();
    this._pathEnd = [0, 0, 0.1, 0];
    this._sampling = false;
    this._els = {};
  }

  _ensureMounted() {
    if (this._mounted) return;
    this._mounted = true;
    syncScaraModelFromRuntime();

    const root = document.createElement('div');
    root.className = 'analyzer-panel';

    const tabs = document.createElement('nav');
    tabs.className = 'analyzer-tabs';
    [['model', 'Model'], ['workspace', 'Workspace'], ['path', 'Path'], ['live', 'Live']].forEach(([id, label], i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'analyzer-tab' + (i === 0 ? ' active' : '');
      b.dataset.tab = id;
      b.textContent = label;
      tabs.appendChild(b);
    });

    const panels = document.createElement('div');
    panels.className = 'analyzer-panels';
    panels.appendChild(this._buildModelPane());
    panels.appendChild(this._buildWorkspacePane());
    panels.appendChild(this._buildPathPane());
    panels.appendChild(this._buildLivePane());

    root.appendChild(tabs);
    root.appendChild(panels);

    tabs.querySelectorAll('.analyzer-tab').forEach((btn) => {
      btn.addEventListener('click', () => this._switchTab(btn.dataset.tab));
    });

    this._els.root = root;
    this._els.tabs = tabs;
    this._els.panels = panels;

    this._panel = new FloatingPanel({
      id: 'fp-analyzer',
      title: 'RoboAnalyzer — SCARA',
      icon: '🔬',
      contentEl: root,
      startX: 420,
      startY: 48,
      startHidden: true,
    });
    this._panel.mount(this._mountRoot);
    this._refreshLive();
  }

  _switchTab(tab) {
    this._tab = tab;
    this._els.tabs.querySelectorAll('.analyzer-tab').forEach((b) => {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
    this._els.panels.querySelectorAll('.analyzer-pane').forEach((p) => {
      p.classList.toggle('hidden', p.dataset.pane !== tab);
    });
    if (tab === 'live') this._refreshLive();
  }

  _buildModelPane() {
    const pane = document.createElement('section');
    pane.className = 'analyzer-pane';
    pane.dataset.pane = 'model';

    const hint = document.createElement('p');
    hint.className = 'analyzer-hint';
    hint.textContent = 'Edit DH parameters (live). Link lengths L1/L2 also appear in the hierarchy inspector.';
    pane.appendChild(hint);

    const wrap = document.createElement('div');
    wrap.className = 'analyzer-table-wrap';
    const table = document.createElement('table');
    table.className = 'analyzer-table';
    table.innerHTML = '<thead><tr><th>Joint</th><th>a</th><th>α</th><th>d</th><th>Type</th></tr></thead>';
    const tbody = document.createElement('tbody');

    this._model.dhTable.forEach((j, i) => {
      const name = this._model.jointNames?.[i] || `J${i + 1}`;
      const tr = document.createElement('tr');
      tr.dataset.joint = String(i);
      tr.innerHTML = `<td>${name}</td>
        <td><input class="analyzer-inp" data-key="a" type="number" step="0.001" value="${j.a.toFixed(4)}"></td>
        <td><input class="analyzer-inp" data-key="alpha" type="number" step="0.001" value="${j.alpha.toFixed(4)}"></td>
        <td><input class="analyzer-inp" data-key="d" type="number" step="0.001" value="${j.d.toFixed(4)}"></td>
        <td>${j.type}</td>`;
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    pane.appendChild(wrap);

    const linkHost = document.createElement('div');
    linkHost.className = 'analyzer-row';
    (this._model.editableLinks || []).forEach((link) => {
      const val = this._model.dhTable[link.jointIndex][link.dhKey];
      const row = document.createElement('label');
      row.className = 'analyzer-slider-row';
      const span = document.createElement('span');
      span.textContent = link.label;
      const range = document.createElement('input');
      range.type = 'range';
      range.min = link.min;
      range.max = link.max;
      range.step = '0.005';
      range.value = val;
      const valEl = document.createElement('span');
      valEl.className = 'analyzer-val';
      valEl.textContent = `${val.toFixed(3)} m`;
      range.addEventListener('input', () => {
        const v = parseFloat(range.value);
        valEl.textContent = `${v.toFixed(3)} m`;
        this._applyDh(link.jointIndex, link.dhKey, v, link.meshLinkIndex);
      });
      row.append(span, range, valEl);
      linkHost.appendChild(row);
    });
    pane.appendChild(linkHost);

    pane.querySelectorAll('.analyzer-inp').forEach((inp) => {
      inp.addEventListener('change', () => {
        const tr = inp.closest('tr');
        const ji = parseInt(tr.dataset.joint, 10);
        this._applyDh(ji, inp.dataset.key, parseFloat(inp.value));
      });
    });

    return pane;
  }

  _applyDh(jointIndex, key, value, meshLinkIndex) {
    setDhParameter(this._model.dhTable, jointIndex, key, value);
    applyScaraModelToRuntime();
    this._onDhChange?.(jointIndex, key, value, meshLinkIndex);
    this._refreshLive();
  }

  _buildWorkspacePane() {
    const pane = document.createElement('section');
    pane.className = 'analyzer-pane hidden';
    pane.dataset.pane = 'workspace';

    const row1 = document.createElement('div');
    row1.className = 'analyzer-row';
    row1.innerHTML = `
      <label>Z slice (DH) <input type="number" id="ws-z" class="analyzer-inp narrow" value="0.10" step="0.01"></label>
      <label>Grid <input type="number" id="ws-res" class="analyzer-inp narrow" value="14" min="6" max="24"></label>`;
    pane.appendChild(row1);

    const row2 = document.createElement('div');
    row2.className = 'analyzer-row';
    row2.innerHTML = `
      <button type="button" class="analyzer-btn primary" id="ws-sample">Sample workspace</button>
      <button type="button" class="analyzer-btn" id="ws-3d">Show in 3D</button>
      <button type="button" class="analyzer-btn" id="ws-clear">Clear overlay</button>`;
    pane.appendChild(row2);

    const prog = document.createElement('div');
    prog.className = 'analyzer-progress';
    prog.innerHTML = '<div class="analyzer-progress-bar" id="ws-bar"></div>';
    pane.appendChild(prog);

    const stats = document.createElement('p');
    stats.className = 'analyzer-stats';
    stats.id = 'ws-stats';
    stats.textContent = '—';
    pane.appendChild(stats);

    const canvas = document.createElement('canvas');
    canvas.id = 'ws-canvas';
    canvas.className = 'analyzer-canvas';
    canvas.width = 320;
    canvas.height = 280;
    pane.appendChild(canvas);

    this._els.wsCanvas = canvas;
    this._els.wsStats = stats;
    this._els.wsBar = prog.querySelector('#ws-bar');

    row2.querySelector('#ws-sample')?.addEventListener('click', () => this._runWorkspaceSample());
    row2.querySelector('#ws-3d')?.addEventListener('click', () => {
      if (this._lastWorkspace) this._onWorkspaceOverlay?.(this._lastWorkspace.cells, true);
    });
    row2.querySelector('#ws-clear')?.addEventListener('click', () => {
      this._onWorkspaceOverlay?.([], false);
      this._lastWorkspace = null;
    });

    return pane;
  }

  async _runWorkspaceSample() {
    if (this._sampling) return;
    this._sampling = true;
    const z = parseFloat(document.getElementById('ws-z')?.value || '0.1');
    const res = parseInt(document.getElementById('ws-res')?.value || '14', 10);
    this._els.wsStats.textContent = 'Sampling…';
    this._els.wsBar.style.width = '0%';

    try {
      const result = await sampleWorkspaceSlice({
        dhTable: this._model.dhTable,
        zFixed: z,
        resolution: res,
        qSeed: [...this._getQ()],
        onProgress: (p) => {
          this._els.wsBar.style.width = `${(p * 100).toFixed(0)}%`;
        },
      });
      this._lastWorkspace = result;
      const s = result.stats;
      this._els.wsStats.textContent =
        `Reachable ${s.reachable}/${s.total} (${s.reachPct}%) · singular ${s.singular} · unreachable ${s.unreachable}`;
      this._drawWorkspaceHeatmap(result);
    } finally {
      this._sampling = false;
    }
  }

  _drawWorkspaceHeatmap(result) {
    const canvas = this._els.wsCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const { nx, ny, cells } = result;
    const w = canvas.width;
    const h = canvas.height;
    const cw = w / nx;
    const ch = h / ny;
    ctx.fillStyle = '#0d0e14';
    ctx.fillRect(0, 0, w, h);

    for (const cell of cells) {
      let col;
      if (cell.status === 'reachable') {
        const t = Math.min(1, cell.mu * 40);
        col = `hsl(${120 + t * 40}, 75%, ${35 + t * 25}%)`;
      } else if (cell.status === 'singular') col = '#e85c2a';
      else col = '#2a2a38';
      ctx.fillStyle = col;
      ctx.fillRect(cell.ix * cw, (ny - 1 - cell.iy) * ch, cw + 1, ch + 1);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.strokeRect(0, 0, w, h);
  }

  _buildPathPane() {
    const pane = document.createElement('section');
    pane.className = 'analyzer-pane hidden';
    pane.dataset.pane = 'path';

    const hint = document.createElement('p');
    hint.className = 'analyzer-hint';
    hint.textContent = 'Joint-space path from current q → preset (trapezoidal timing).';
    pane.appendChild(hint);

    const durRow = document.createElement('label');
    durRow.className = 'analyzer-slider-row';
    durRow.innerHTML = 'Duration (s) <input type="range" id="path-dur" min="1" max="8" step="0.5" value="3"> <span class="analyzer-val" id="path-dur-v">3.0 s</span>';
    pane.appendChild(durRow);

    const presets = document.createElement('div');
    presets.className = 'analyzer-row';
    presets.innerHTML = `
      <button type="button" class="analyzer-btn primary" id="path-home">→ Home</button>
      <button type="button" class="analyzer-btn" id="path-ext">→ Extended</button>`;
    pane.appendChild(presets);

    const controls = document.createElement('div');
    controls.className = 'analyzer-row';
    controls.innerHTML = `
      <button type="button" class="analyzer-btn primary" id="path-play">▶ Play</button>
      <button type="button" class="analyzer-btn" id="path-stop">■ Stop</button>`;
    pane.appendChild(controls);

    const status = document.createElement('p');
    status.className = 'analyzer-stats';
    status.id = 'path-status';
    status.textContent = 'Idle';
    pane.appendChild(status);

    this._pathPresets = { home: [0, 0, 0.1, 0], ext: [0.8, -1.2, 0.18, 0.5] };
    this._pathEnd = [...this._pathPresets.home];

    const dur = durRow.querySelector('#path-dur');
    const durV = durRow.querySelector('#path-dur-v');
    dur?.addEventListener('input', () => {
      durV.textContent = `${(+dur.value).toFixed(1)} s`;
    });

    presets.querySelector('#path-home')?.addEventListener('click', () => {
      this._pathEnd = [...this._pathPresets.home];
      status.textContent = 'Target: home';
    });
    presets.querySelector('#path-ext')?.addEventListener('click', () => {
      this._pathEnd = [...this._pathPresets.ext];
      status.textContent = 'Target: extended';
    });
    controls.querySelector('#path-play')?.addEventListener('click', () => {
      const duration = parseFloat(dur?.value || '3');
      status.textContent = 'Playing…';
      this._pathAnim.play({
        qStart: [...this._getQ()],
        qEnd: this._pathEnd,
        duration,
        onFrame: (q) => this._setQ(q),
        onComplete: () => { status.textContent = 'Complete'; },
      });
    });
    controls.querySelector('#path-stop')?.addEventListener('click', () => {
      this._pathAnim.stop();
      status.textContent = 'Stopped';
    });

    return pane;
  }

  _buildLivePane() {
    const pane = document.createElement('section');
    pane.className = 'analyzer-pane hidden';
    pane.dataset.pane = 'live';

    const frames = document.createElement('label');
    frames.className = 'analyzer-check';
    frames.innerHTML = '<input type="checkbox" id="live-frames"> Show DH frames in 3D';
    frames.querySelector('input')?.addEventListener('change', (e) => {
      this._onFramesToggle?.(e.target.checked);
    });
    pane.appendChild(frames);

    const grid = document.createElement('div');
    grid.className = 'analyzer-live-grid';
    grid.id = 'live-grid';
    pane.appendChild(grid);
    this._els.liveGrid = grid;

    return pane;
  }

  _refreshLive() {
    if (!this._els.liveGrid) return;
    const q = this._getQ();
    const { position } = fk(q, this._model.dhTable);
    const { J, cols } = jacobian(q, this._model.dhTable);
    const mu = manipulabilityPosition(J, cols);
    const qStr = q
      .map((v, i) => (i === 2 ? `${v.toFixed(3)}m` : `${RAD(v).toFixed(1)}°`))
      .join(', ');

    this._els.liveGrid.innerHTML = `
      <div class="analyzer-metric"><span>EE (DH)</span><code>[${position.map((v) => v.toFixed(3)).join(', ')}]</code></div>
      <div class="analyzer-metric"><span>μ (pos)</span><code>${mu.toExponential(3)}</code></div>
      <div class="analyzer-metric"><span>q</span><code>[${qStr}]</code></div>`;
  }

  refreshModel() {
    syncScaraModelFromRuntime();
    if (!this._mounted) return;
    const tbody = this._els.root?.querySelector('.analyzer-table tbody');
    if (!tbody) return;
    tbody.querySelectorAll('tr').forEach((tr, i) => {
      const j = this._model.dhTable[i];
      tr.querySelector('[data-key="a"]').value = j.a.toFixed(4);
      tr.querySelector('[data-key="alpha"]').value = j.alpha.toFixed(4);
      tr.querySelector('[data-key="d"]').value = j.d.toFixed(4);
    });
    this._refreshLive();
  }

  show() {
    this._ensureMounted();
    this._panel.show();
    this._refreshLive();
  }

  hide() {
    if (this._panel) this._panel.hide();
  }

  toggle() {
    if (!this._mounted) {
      this.show();
      return;
    }
    this._panel.toggle();
    if (this._panel.isVisible) this._refreshLive();
  }

  get isVisible() {
    return this._panel ? this._panel.isVisible : false;
  }
}
