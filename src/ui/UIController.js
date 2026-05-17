/**
 * UIController.js — DOM event wiring, simulation loop, and HUD updates
 * Bridges the SceneManager (3D) with HTML sliders/buttons/text.
 */
import * as THREE from 'three';
import {
  ikMat, fkMat, jacMat, det3, clamp, RAD, V3, DEG,
  T2MIN, T2MAX, T3MIN, T3MAX, linkLengths, getEllipsoid
} from '../math/Kinematics.js';
import { trapProfile } from '../math/Trajectory.js';
import { projectPixelsTo3D, transformCameraToRobot } from '../math/CameraModel.js';
import { logger } from './ConsoleLogger.js';
import MathDashboardPanel from './MathDashboardPanel.js';
import { makePanelsModular } from './FloatingPanel.js';

const $ = id => document.getElementById(id);

export default class UIController {
  constructor(sceneManager) {
    this.sm = sceneManager;
    this._tab = 'ik';
    // Simulation state
    this.simRunning = false;
    this.simT = 0;
    this.simRAF = null;
    this.simN = 0;
    this.qCurrent = [0, DEG(45), DEG(80)];
    this.qTarget = [0, DEG(45), DEG(80)];
    this.trapT = 0;
    this.trapTTotal = 0.5;
    this.trailBuf = [];
    // BroadcastChannel frame throttle
    this._frameCount = 0;
    // Raycaster
    this._raycaster = new THREE.Raycaster();
    this._mouse = new THREE.Vector2();
    this._isDragging = false;
    this._isDraggingHand = false;
    this._shadowHandManual = false;
    // Shadow-avoidance demo
    this.shadowDemoRunning = false;
    this.shadowDemoRAF = null;
    this.shadowSimT = 0;
    this._handX = 0.35;
    this._handY = 0.05;
    // Link selection
    this._selectedLink = -1;
    this._linkCard = $('linkCard');
    this._linkSlider = $('linkCardSlider');
    this._linkTitle = $('linkCardTitle');
    this._linkValue = $('linkCardValue');
    this._linkMin = $('linkCardMin');
    this._linkMax = $('linkCardMax');
    this._linkDefault = $('linkCardDefault');
    // Math Dashboard Panel
    this._mathPanel = null;
    // BroadcastChannel for math dashboard sync
    this._mathChannel = new BroadcastChannel('jinx_math_sync');
    // Command channel — receive FK/IK commands from dashboard
    this._cmdChannel = new BroadcastChannel('jinx_math_cmd');
    this._cmdChannel.onmessage = (e) => {
      const d = e.data;
      if (d.robot !== 'rrr') return;
      if (d.type === 'fk' && d.q) {
        const RAD2DEG = 180 / Math.PI;
        const fv = fkMat(d.q[0], d.q[1], d.q[2]);
        const zhand = 0.025;
        const pTgt3 = V3(fv.x, zhand, -fv.y);
        this.sm.updateScene(d.q[0], d.q[1], d.q[2], pTgt3);
        this.qCurrent = [...d.q];
        $('xd').value = fv.x;
        $('yd').value = fv.y;
        $('dz').value = fv.z - zhand;
        $('h1').textContent = (d.q[0] * RAD2DEG).toFixed(1) + '°';
        $('h2').textContent = (d.q[1] * RAD2DEG).toFixed(1) + '°';
        $('h3').textContent = (d.q[2] * RAD2DEG).toFixed(1) + '°';
        $('hHead').textContent = `(${fv.x.toFixed(3)}, ${fv.y.toFixed(3)}, ${fv.z.toFixed(3)}) m`;
        this.update();
      } else if (d.type === 'ik' && d.target) {
        const zhand = 0.025;
        const dx = +$('dx').value;
        const dy = +$('dy').value;
        $('xd').value = d.target[0] - dx;
        $('yd').value = d.target[1] - dy;
        $('dz').value = d.target[2] - zhand;
        if (d.elbow !== undefined) $('elbow').value = d.elbow > 0 ? '1' : '-1';
        this.setTab('ik');
        this.update();
      } else if (d.type === 'jog_joint' && d.joint !== undefined) {
        const q = [...(this.qCurrent || [0, DEG(45), DEG(80)])];
        q[d.joint] += d.delta;
        this._cmdChannel.onmessage({ data: { robot: 'rrr', type: 'fk', q } });
      } else if (d.type === 'jog_ee' && d.delta) {
        $('xd').value = (+$('xd').value) + d.delta[0];
        $('yd').value = (+$('yd').value) + d.delta[1];
        $('dz').value = (+$('dz').value) + d.delta[2];
        this.setTab('ik');
        this.update();
      } else if (d.type === 'home') {
        this._resetPose();
      } else if (d.type === 'toggle_sim') {
        this.toggleSim();
      }
    };
    this._bindEvents();
    this._bindLinkCard();
    makePanelsModular($('cw'));
    logger.log('UIController initialized.');
  }

  /* ═══════════ Event Wiring ═══════════ */
  _bindEvents() {
    // Tabs
    document.querySelectorAll('#tabBar .tab').forEach(btn => {
      btn.addEventListener('click', () => this.setTab(btn.dataset.tab));
    });
    // IK / Jacobian sliders
    ['xd', 'yd', 'jxd', 'jyd', 'dx', 'dy', 'dz'].forEach(id => {
      const el = $(id);
      if (el) el.addEventListener('input', () => this.update());
    });
    ['elbow'].forEach(id => {
      const el = $(id);
      if (el) el.addEventListener('change', () => this.update());
    });
    // Camera sliders
    ['cfx', 'cfy', 'ccx', 'ccy', 'cu', 'cv_', 'czw', 'ctx', 'cty', 'ctz'].forEach(id => {
      const el = $(id);
      if (el) el.addEventListener('input', () => {
        $(id + 'v').textContent = parseFloat(el.value).toFixed(2);
        this.computeCameraIK();
      });
    });
    // Trap sliders
    ['vmax', 'amax'].forEach(id => {
      const el = $(id);
      if (el) el.addEventListener('input', () => this.drawTrapProfile());
    });
    // Sim button
    $('sbtn').addEventListener('click', () => this.toggleSim());
    const shadowBtn = $('shadowDemoBtn');
    if (shadowBtn) shadowBtn.addEventListener('click', () => this.toggleShadowDemo());
    const shadowAvoid = $('shadowAvoid');
    if (shadowAvoid) shadowAvoid.addEventListener('change', () => {
      if (this.shadowDemoRunning) this._updateShadowHudLabels();
      else this.update();
    });
    ['shadowSpd', 'shadowHR', 'dx', 'dy', 'dz'].forEach(id => {
      const el = $(id);
      if (el) el.addEventListener('input', () => {
        if (id === 'dx' || id === 'dy' || id === 'dz') {
          $('dxv').textContent = (+$('dx').value).toFixed(2);
          $('dyv').textContent = (+$('dy').value).toFixed(2);
          $('dzv').textContent = (+$('dz').value).toFixed(2);
        }
        if (this.shadowDemoRunning) return;
        if (id.startsWith('shadow')) return;
        this.update();
      });
    });
    // Math dashboard
    const mathBtn = $('btn-math-panel');
    if (mathBtn) mathBtn.addEventListener('click', () => {
      if (!this._mathPanel) {
        this._mathPanel = new MathDashboardPanel({
          mountRoot: document.getElementById('cw'),
          robotType: 'rrr'
        });
      }
      this._mathPanel.toggle();
      mathBtn.classList.toggle('active', this._mathPanel.isVisible);
    });
    // Camera apply
    $('camApplyBtn').addEventListener('click', () => this.applyCameraIK());
    // Raycaster
    const dom = this.sm.renderer.domElement;
    dom.addEventListener('pointerdown', e => this._onPointerDown(e));
    window.addEventListener('pointermove', e => this._onPointerMove(e));
    window.addEventListener('pointerup', () => this._onPointerUp());
    // Reset
    const resetBtn = $('resetBtn');
    if (resetBtn) resetBtn.addEventListener('click', () => this._resetPose());

    // Hierarchy bindings
    document.querySelectorAll('.tree-item[data-link]').forEach(el => {
      el.addEventListener('click', () => {
        const linkIdx = parseInt(el.dataset.link, 10);
        this.showLinkCard(linkIdx);
      });
    });
    
    // Toolbar - Camera Modes
    const bOrbit = $('btn-orbit'), bPan = $('btn-pan');
    if (bOrbit && bPan) {
      bOrbit.addEventListener('click', () => {
        this.sm.controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
        bOrbit.classList.add('active'); bPan.classList.remove('active');
      });
      bPan.addEventListener('click', () => {
        this.sm.controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
        bPan.classList.add('active'); bOrbit.classList.remove('active');
      });
    }

    // Toolbar - View Modes
    const bWire = $('btn-wireframe'), bFrames = $('btn-frames'), bEll = $('btn-ellipsoid');
    if (bWire) bWire.addEventListener('click', () => {
      const active = bWire.classList.toggle('active');
      this.sm.setWireframe(active);
    });
    if (bFrames) bFrames.addEventListener('click', () => {
      const active = bFrames.classList.toggle('active');
      this.sm.setAxesVisible(active);
    });
    if (bEll) bEll.addEventListener('click', () => {
      bEll.classList.toggle('active');
      this.update();
    });

    // Keyboard Shortcuts
    window.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      
      switch(e.code) {
        case 'Space': e.preventDefault(); this.toggleSim(); break;
        case 'KeyR': this._resetPose(); break;
        case 'KeyW': if (bWire) bWire.click(); break;
        case 'KeyF': if (bFrames) bFrames.click(); break;
        case 'KeyG': // Grid toggle
          const active = this.sm.scene.getObjectByName('majorGrid')?.visible;
          this.sm.scene.traverse(o => {
            if (o.type === 'GridHelper') o.visible = !active;
          });
          break;
      }
    });

    // Global click to deselect link
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.tree-item') && !e.target.closest('#linkCard') && !e.target.closest('canvas')) {
        this.hideLinkCard();
      }
    });
  }

  /* ═══════════ Reset Pose ═══════════ */
  _resetPose() {
    logger.info('Resetting to home pose.');
    // Stop simulation
    if (this.simRunning) this.toggleSim();
    if (this.shadowDemoRunning) this.toggleShadowDemo();
    // Reset to default
    const defaultQ = [0, DEG(45), DEG(80)];
    this.qCurrent = [...defaultQ];
    this.qTarget = [...defaultQ];
    // Reset sliders
    $('xd').value = 0.20; $('yd').value = 0.42;
    $('jxd').value = 0.20; $('jyd').value = 0.42;
    // Reset trail
    this.trailBuf = [];
    this.sm.resetTrail();
    this.update();
  }

  /* ═══════════ Tabs ═══════════ */
  setTab(t) {
    this._tab = t;
    ['ik', 'jac', 'sim', 'cam'].forEach(id => {
      $('pane-' + id).classList.toggle('on', id === t);
    });
    document.querySelectorAll('#tabBar .tab').forEach(el => {
      el.classList.toggle('active', el.dataset.tab === t);
    });
    if (t === 'cam') this.computeCameraIK();
    if (t === 'sim' || t === 'cam') this.drawTrapProfile();
    this.update();
  }

  /* ═══════════ Master Update ═══════════ */
  update() {
    const tab = this._tab;
    const dx = +$('dx').value, dy = +$('dy').value, dz = +$('dz').value;
    $('dxv').textContent = dx.toFixed(2);
    $('dyv').textContent = dy.toFixed(2);
    $('dzv').textContent = dz.toFixed(2);

    let xd, yd;
    if (tab === 'jac') {
      xd = +$('jxd').value; yd = +$('jyd').value;
      $('jxdv').textContent = xd.toFixed(2);
      $('jydv').textContent = yd.toFixed(2);
    } else {
      xd = +$('xd').value; yd = +$('yd').value;
      $('xdv').textContent = xd.toFixed(2);
      $('ydv').textContent = yd.toFixed(2);
    }

    const eSign = (tab === 'ik') ? +$('elbow').value : 1;
    const zhand = 0.025;
    const pdx = xd + dx, pdy = yd + dy, pdz = zhand + dz;
    const sol = ikMat(pdx, pdy, pdz, eSign);

    $('ikAlert').classList.toggle('on', !sol && tab === 'ik');
    if (!sol) {
      if (this._lastStatus !== 'unreachable') {
        logger.error('IK Diverged: Target out of reach.');
        this._lastStatus = 'unreachable';
      }
      $('hStat').textContent = 'Unreachable';
      $('hStat').className = 'bad';
      return;
    }

    const limOk = sol.t2 >= T2MIN - 0.01 && sol.t2 <= T2MAX + 0.01
      && sol.t3 >= T3MIN - 0.01 && sol.t3 <= T3MAX + 0.01;
    const t1 = sol.t1;
    const t2 = clamp(sol.t2, T2MIN, T2MAX);
    const t3 = clamp(sol.t3, T3MIN, T3MAX);
    $('limAlert').classList.toggle('on', !limOk && tab === 'ik');
    $('hStat').textContent = limOk ? 'OK Valid' : 'WARN Limit';
    $('hStat').className = limOk ? 'ok' : 'bad';
    
    if (!limOk && this._lastStatus !== 'limit') {
      logger.warn('Joint limits reached.');
      this._lastStatus = 'limit';
    } else if (limOk && this._lastStatus !== 'valid') {
      if (this._lastStatus) logger.log('Valid pose restored.');
      this._lastStatus = 'valid';
    }

    const fv = fkMat(t1, t2, t3);
    const err = Math.hypot(fv.x - pdx, fv.y - pdy, fv.z - pdz);
    const J = jacMat(t1, t2, t3);
    const mu = Math.abs(det3(J));

    if (tab === 'ik') {
      $('ik-t1').textContent = RAD(t1).toFixed(1) + '°';
      $('ik-t2').textContent = RAD(sol.t2).toFixed(1) + (limOk ? '' : 'WARN') + '°';
      $('ik-t3').textContent = RAD(sol.t3).toFixed(1) + (limOk ? '' : 'WARN') + '°';
      $('ik-err').textContent = err.toExponential(2) + ' m';
      $('ik-r').textContent = fv.r.toFixed(4) + ' m';
      $('ik-z').textContent = fv.z.toFixed(4) + ' m';
      $('ik-mu').textContent = mu.toFixed(5);
    }

    const pTgt3 = V3(xd, zhand, -yd);
    const f = this.sm.updateScene(t1, t2, t3, pTgt3);

    // Manipulability Ellipsoid (Phase 4.2)
    const bEll = $('btn-ellipsoid');
    const ellOn = bEll && bEll.classList.contains('active');
    if (ellOn) {
      const { singularValues, rotation } = getEllipsoid(J);
      this.sm.updateEllipsoid(true, singularValues, rotation, mu, f.P3);
    } else {
      this.sm.updateEllipsoid(false);
    }

    // HUD
    $('h1').textContent = RAD(t1).toFixed(1) + '°';
    $('h2').textContent = RAD(t2).toFixed(1) + '°';
    $('h3').textContent = RAD(t3).toFixed(1) + '°';
    $('hHead').textContent = `[${f.x.toFixed(3)}, ${f.y.toFixed(3)}, ${f.z.toFixed(3)}]`;
    $('hMu').textContent = mu.toFixed(4);

    // Status Bar Telemetry
    const fpsEl = $('status-fps');
    if (fpsEl) {
      if (!this._frameCount) this._frameCount = 0;
      this._frameCount++;
      if (this._frameCount % 30 === 0) {
        const now = performance.now();
        if (this._lastTime) {
          const dt = now - this._lastTime;
          const fps = Math.round(1000 / (dt / 30));
          fpsEl.textContent = fps;
        }
        this._lastTime = now;
      }
    }

    // Hierarchy Tree Badges
    const tt1 = $('tree-t1'); if(tt1) tt1.textContent = RAD(t1).toFixed(1) + '°';
    const tt2 = $('tree-t2'); if(tt2) tt2.textContent = RAD(t2).toFixed(1) + '°';
    const tt3 = $('tree-t3'); if(tt3) tt3.textContent = RAD(t3).toFixed(1) + '°';
    // EE cards
    $('ox').textContent = f.x.toFixed(4) + ' m';
    $('oy').textContent = f.y.toFixed(4) + ' m';
    $('oz').textContent = f.z.toFixed(4) + ' m';
    $('or_').textContent = f.r.toFixed(4) + ' m';

    this._updateJacobian(t1, t2, t3, f, J, mu);

    // ── Broadcast to Math Dashboard (throttled to every 2nd frame) ──
    this._frameCount++;
    if (this._frameCount % 2 === 0) {
      this._mathChannel.postMessage({
        robot: 'rrr',
        q: [t1, t2, t3],
        ee: [f.x, f.y, f.z],
        jacobian: J,
        mu,
        detJ: det3(J),
        reach: f.r,
        error: err,
        converged: !!sol,
        status: limOk ? 'valid' : 'limit',
        sdot: this.simRunning ? parseFloat($('simSdot')?.textContent) || 0 : 0,
        sddot: this.simRunning ? parseFloat($('simSddot')?.textContent) || 0 : 0,
        mode: this.simRunning ? 'simulation' : this._tab,
      });
    }
  }

  /* ═══════════ Jacobian Display ═══════════ */
  _updateJacobian(t1, t2, t3, f, J, mu) {
    const ids = [['j11', 'j12', 'j13'], ['j21', 'j22', 'j23'], ['j31', 'j32', 'j33']];
    const maxVal = Math.max(...J.flat().map(Math.abs), 1e-9);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const el = $(ids[i][j]);
      const v = J[i][j], norm = v / maxVal;
      el.textContent = v.toFixed(3);
      if (Math.abs(v) < 0.001) {
        el.style.background = 'rgba(80,80,100,0.3)'; el.style.color = '#555580';
      } else if (norm > 0) {
        el.style.background = `rgba(32,${Math.round(80 + norm * 120)},60,0.25)`;
        el.style.color = `rgb(50,${Math.round(160 + norm * 95)},80)`;
      } else {
        el.style.background = `rgba(${Math.round(80 + (-norm) * 120)},30,30,0.25)`;
        el.style.color = `rgb(${Math.round(160 + (-norm) * 95)},50,50)`;
      }
    }
    const d = det3(J);
    $('detJ').textContent = d.toFixed(4);
    $('jmu').textContent = mu.toFixed(5);
    $('sinT3').textContent = Math.sin(t3).toFixed(4);
    $('jreach').textContent = f.r.toFixed(4) + ' m';
    const pct = Math.min(mu / 0.04 * 100, 100);
    $('muBar').style.width = pct + '%';
    const ramp = Math.round(pct * 2.55);
    $('muBar').style.background = `rgb(${255 - ramp},${ramp},60)`;
    $('muLabel').textContent = 'μ = ' + mu.toFixed(5);
    $('singWarn').style.display = Math.abs(Math.sin(t3)) < 0.10 ? 'block' : 'none';
    $('singWarn2').style.display = Math.abs(f.r) < 0.04 ? 'block' : 'none';

    if (mu < 0.005 && this._lastSingularity !== true) {
      logger.warn(`Approaching singularity (μ = ${mu.toFixed(4)})`);
      this._lastSingularity = true;
    } else if (mu >= 0.005 && this._lastSingularity === true) {
      this._lastSingularity = false;
    }
  }

  /* ═══════════ Camera Pinhole ═══════════ */
  computeCameraIK() {
    const fx = +$('cfx').value, fy = +$('cfy').value;
    const cx = +$('ccx').value, cy = +$('ccy').value;
    const u = +$('cu').value, v = +$('cv_').value, Zw = +$('czw').value;
    const tx = +$('ctx').value, ty = +$('cty').value, tz = +$('ctz').value;

    const { Xw, Yw } = projectPixelsTo3D(u, v, Zw, fx, fy, cx, cy);
    const { xr, yr, zr } = transformCameraToRobot(Xw, Yw, Zw, tx, ty, tz);

    $('camXw').textContent = Xw.toFixed(4) + ' m';
    $('camYw').textContent = Yw.toFixed(4) + ' m';
    $('camZw').textContent = Zw.toFixed(4) + ' m';
    $('camRx').textContent = xr.toFixed(4) + ' m';
    $('camRy').textContent = yr.toFixed(4) + ' m';
    $('camRz').textContent = zr.toFixed(4) + ' m';

    this.sm.updatePovCamera(tx, ty, -tz);

    const dxv = +$('dx').value, dyv = +$('dy').value, dzv = +$('dz').value;
    const sol = ikMat(xr + dxv, yr + dyv, zr + dzv, 1);

    $('camAlert').classList.toggle('on', !sol);
    if (sol) {
      $('camIK').textContent =
        `θ₁=${RAD(sol.t1).toFixed(1)}° θ₂=${RAD(sol.t2).toFixed(1)}° θ₃=${RAD(sol.t3).toFixed(1)}°`;
    } else {
      $('camIK').textContent = 'Out of reach';
    }
    return { sol, xr, yr, zr };
  }

  applyCameraIK() {
    const { sol, xr, yr, zr } = this.computeCameraIK();
    if (!sol) return;
    const t1 = sol.t1, t2 = clamp(sol.t2, T2MIN, T2MAX), t3 = clamp(sol.t3, T3MIN, T3MAX);
    const pTgt = V3(xr, zr, -yr);
    this.sm.updateScene(t1, t2, t3, pTgt);
    $('hStat').textContent = 'Camera IK';
    $('hStat').className = 'ok';
  }

  /* ═══════════ Trap Profile Drawing ═══════════ */
  drawTrapProfile() {
    const cvs = $('trapCvs'); if (!cvs) return;
    const w = cvs.clientWidth || 280, h = cvs.clientHeight || 68;
    cvs.width = w; cvs.height = h;
    const ctx = cvs.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    const vmax_ = +$('vmax').value || 1.2, amax_ = +$('amax').value || 2.0;
    const T = 1.0, N = 100;
    // Grid
    ctx.strokeStyle = 'rgba(80,80,120,0.25)'; ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) { ctx.beginPath(); ctx.moveTo(i * w / 4, 0); ctx.lineTo(i * w / 4, h); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
    // s(t)
    ctx.beginPath(); ctx.strokeStyle = '#20d080'; ctx.lineWidth = 1.8;
    for (let i = 0; i <= N; i++) { const t = i / N * T; const { s } = trapProfile(t, T, vmax_, amax_); const px = i / N * w, py = h - s * (h - 8) - 4; i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py); }
    ctx.stroke();
    // sdot
    ctx.beginPath(); ctx.strokeStyle = '#c8a800'; ctx.lineWidth = 1.4; ctx.setLineDash([3, 2]);
    for (let i = 0; i <= N; i++) { const t = i / N * T; const { sdot } = trapProfile(t, T, vmax_, amax_); const px = i / N * w, py = h / 2 - sdot / vmax_ * (h / 2 - 8); i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py); }
    ctx.stroke(); ctx.setLineDash([]);
    // sddot
    ctx.beginPath(); ctx.strokeStyle = 'rgba(255,80,80,0.7)'; ctx.lineWidth = 1.2; ctx.setLineDash([2, 3]);
    for (let i = 0; i <= N; i++) { const t = i / N * T; const { sddot } = trapProfile(t, T, vmax_, amax_); const norm = sddot / amax_; const px = i / N * w, py = h / 2 - norm * (h / 2 - 8); i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py); }
    ctx.stroke(); ctx.setLineDash([]);
    // Legend
    ctx.font = '9px Inter';
    ctx.fillStyle = '#20d080'; ctx.fillText('s(t)', 4, 12);
    ctx.fillStyle = '#c8a800'; ctx.fillText('ṡ(t)', 28, 12);
    ctx.fillStyle = 'rgba(255,80,80,0.9)'; ctx.fillText('s̈(t)', 52, 12);
    // t1/t2 lines
    const t1_ = Math.min(vmax_ / amax_, T / 2), t2_ = T - t1_;
    ctx.strokeStyle = 'rgba(200,168,0,0.35)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    [t1_, t2_].forEach(tt => { ctx.beginPath(); ctx.moveTo(tt / T * w, 0); ctx.lineTo(tt / T * w, h); ctx.stroke(); });
    ctx.setLineDash([]);
  }

  /* ═══════════ Trajectory Drawing ═══════════ */
  drawTraj() {
    const cvs = $('trajCvs'); if (!cvs) return;
    const w = cvs.clientWidth, h = cvs.clientHeight || 80;
    cvs.width = w; cvs.height = h;
    const ctx = cvs.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    if (this.trailBuf.length < 2) return;
    const sx = x => (x + 0.5) / 1.1 * w, sy = y => h / 2 - (y / 0.4) * (h * 0.4);
    ctx.strokeStyle = 'rgba(80,80,120,0.3)'; ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) { ctx.beginPath(); ctx.moveTo(i * w / 4, 0); ctx.lineTo(i * w / 4, h); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
    ctx.fillStyle = 'rgba(200,162,0,0.6)'; ctx.beginPath(); ctx.arc(sx(0), sy(0), 4, 0, Math.PI * 2); ctx.fill();
    for (let i = 1; i < this.trailBuf.length; i++) {
      const a = i / this.trailBuf.length;
      ctx.strokeStyle = `rgba(130,100,255,${a * 0.8})`; ctx.lineWidth = 1.5; ctx.beginPath();
      ctx.moveTo(sx(this.trailBuf[i - 1].x), sy(this.trailBuf[i - 1].y));
      ctx.lineTo(sx(this.trailBuf[i].x), sy(this.trailBuf[i].y)); ctx.stroke();
    }
    if (this.trailBuf.length > 0) {
      const last = this.trailBuf[this.trailBuf.length - 1];
      ctx.fillStyle = '#20c8ff'; ctx.beginPath(); ctx.arc(sx(last.x), sy(last.y), 5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = 'rgba(140,120,200,0.6)'; ctx.font = '9px Inter'; ctx.fillText('Top view (x-y)', 4, 10);
  }

  /* ═══════════ Simulation ═══════════ */
  toggleSim() {
    if (this.shadowDemoRunning) this.toggleShadowDemo();
    this.simRunning = !this.simRunning;
    const btn = $('sbtn');
    if (this.simRunning) {
      logger.info('Simulation started.');
      btn.textContent = 'Stop Simulation'; btn.classList.add('stop');
      $('simStats').style.display = 'block';
      this.trailBuf = []; this.sm.resetTrail(); this.trapT = 0;
      this._runSim();
    } else {
      logger.log('Simulation stopped.');
      btn.textContent = 'Play Simulation'; btn.classList.remove('stop');
      cancelAnimationFrame(this.simRAF);
    }
  }

  _runSim() {
    if (!this.simRunning) return;
    const spd = +$('spd').value, hR_ = +$('hR').value;
    const vmax_ = +$('vmax').value || 1.2, amax_ = +$('amax').value || 2.0;
    $('spdv').textContent = spd.toFixed(1) + '×';
    $('hRv').textContent = hR_.toFixed(2) + ' m';
    $('vmaxv').textContent = vmax_.toFixed(2);
    $('amaxv').textContent = amax_.toFixed(2);

    const dt = 0.016 * spd;
    this.simT += dt;
    this.simN++;

    const dx = +$('dx').value, dy = +$('dy').value, dz = +$('dz').value;
    const xH = clamp(0.25 + hR_ * Math.cos(this.simT), 0.05, 0.50);
    const yH = clamp(hR_ * Math.sin(this.simT), -0.30, 0.30);
    const zH = 0.025;
    const pdx = xH + dx, pdy = yH + dy, pdz = zH + dz;

    const solNew = ikMat(pdx, pdy, pdz, 1);
    if (solNew) {
      const t1 = solNew.t1;
      const t2 = clamp(solNew.t2, T2MIN, T2MAX);
      const t3 = clamp(solNew.t3, T3MIN, T3MAX);
      this.qCurrent = [t1, t2, t3];

      const J = jacMat(t1, t2, t3);
      const mu = Math.abs(det3(J));
      const fv = fkMat(t1, t2, t3);
      const err = Math.hypot(fv.x - pdx, fv.y - pdy, fv.z - pdz);

      const pTgt3 = V3(xH, zH, -yH);
      const f = this.sm.updateScene(t1, t2, t3, pTgt3);
      this.sm.addTrailPoint(pTgt3);

      // Manipulability Ellipsoid
      const bEll = $('btn-ellipsoid');
      if (bEll && bEll.classList.contains('active')) {
        const { singularValues, rotation } = getEllipsoid(J);
        this.sm.updateEllipsoid(true, singularValues, rotation, mu, f.P3);
      } else {
        this.sm.updateEllipsoid(false);
      }

      this.trailBuf.push({ x: xH, y: yH });
      if (this.trailBuf.length > this.sm.TRAIL_N) this.trailBuf.shift();
      this.drawTraj();

      const lim = solNew.t2 < T2MIN - 0.01 || solNew.t2 > T2MAX + 0.01
               || solNew.t3 < T3MIN - 0.01 || solNew.t3 > T3MAX + 0.01;
      $('simF').textContent    = (this.simN % 9999) + (lim ? ' [LIM]' : '');
      $('simE').textContent    = (err * 1e9).toExponential(2) + ' nm';
      $('simT2').textContent   = RAD(t2).toFixed(1) + '°';
      $('simMu').textContent   = mu.toFixed(4);
      $('simPhase').textContent = 'TRACKING';
      $('simS').textContent    = '1.0000';
      $('simSdot').textContent = '0.000';
      $('simSddot').textContent = '0.00';
      this.drawTrapProfile();

      // Broadcast to Math Dashboard (throttled)
      this._frameCount++;
      if (this._frameCount % 2 === 0) {
        this._mathChannel.postMessage({
          robot: 'rrr', q: [t1, t2, t3],
          ee: [fv.x, fv.y, fv.z], jacobian: J, mu,
          detJ: det3(J), reach: fv.r, error: err,
          converged: true, status: 'simulating'
        });
      }
    }
    // RAF must always be called — loop must never die
    this.simRAF = requestAnimationFrame(() => this._runSim());
  }

  /* ═══════════ Shadow Avoidance Demo ═══════════ */
  toggleShadowDemo() {
    this.shadowDemoRunning = !this.shadowDemoRunning;
    const btn = $('shadowDemoBtn');
    const hud = $('shadowHud');
    if (this.shadowDemoRunning) {
      if (this.simRunning) this.toggleSim();
      logger.info('Shadow avoidance demo started.');
      this.sm.setShadowDemoActive(true);
      this.shadowSimT = 0;
      this._shadowHandManual = false;
      btn?.classList.add('active');
      if (btn) btn.textContent = 'STOP SHADOW DEMO';
      hud?.classList.add('visible');
      this._updateShadowHudLabels();
      this._runShadowDemo();
    } else {
      logger.log('Shadow avoidance demo stopped.');
      cancelAnimationFrame(this.shadowDemoRAF);
      this.sm.setShadowDemoActive(false);
      btn?.classList.remove('active');
      if (btn) btn.textContent = 'SHADOW DEMO';
      hud?.classList.remove('visible');
      this.update();
    }
  }

  _updateShadowHudLabels() {
    const on = $('shadowAvoid')?.checked ?? true;
    const modeEl = $('shadowMode');
    if (modeEl) {
      modeEl.textContent = on ? 'OFFSET (p_d = p_t + Δ)' : 'DIRECT (p_d = p_t)';
      modeEl.className = on ? 'hud-value ok' : 'hud-value bad';
    }
  }

  _runShadowDemo() {
    if (!this.shadowDemoRunning) return;

    const zhand = 0.025;
    const avoidance = $('shadowAvoid')?.checked ?? true;
    const dx = +$('dx').value;
    const dy = +$('dy').value;
    const dz = +$('dz').value;
    const spd = +($('shadowSpd')?.value ?? $('spd')?.value ?? 1);
    const hR_ = +($('shadowHR')?.value ?? 0.10);

    $('shadowSpdv').textContent = spd.toFixed(1) + '×';
    $('shadowHRv').textContent = hR_.toFixed(2) + ' m';

    if (!this._shadowHandManual) {
      const dt = 0.016 * spd;
      this.shadowSimT += dt;
      this._handX = clamp(0.35 + hR_ * Math.cos(this.shadowSimT), 0.12, 0.58);
      this._handY = clamp(hR_ * Math.sin(this.shadowSimT), -0.22, 0.22);
    }

    const xH = this._handX;
    const yH = this._handY;
    this.sm.setHandTablePosition(xH, yH);

    let pdx, pdy, pdz;
    if (avoidance) {
      pdx = xH + dx;
      pdy = yH + dy;
      pdz = zhand + dz;
    } else {
      pdx = xH;
      pdy = yH;
      pdz = zhand + 0.08;
    }

    const pTgt3 = V3(xH, zhand, -yH);
    const wsPt = this.sm.getWorkspaceCenter3();
    const sol = ikMat(pdx, pdy, pdz, 1);

    if (sol) {
      const t1 = sol.t1;
      const t2 = clamp(sol.t2, T2MIN, T2MAX);
      const t3 = clamp(sol.t3, T3MIN, T3MAX);
      const fv = fkMat(t1, t2, t3);
      const err = Math.hypot(fv.x - pdx, fv.y - pdy, fv.z - pdz);
      this.sm.updateScene(t1, t2, t3, pTgt3);

      const lampPos = fv.P3;
      const handPos3 = this.sm.handMesh.position;
      const risk = this.sm.estimateShadowRisk(lampPos, wsPt, handPos3);

      $('h1').textContent = RAD(t1).toFixed(1) + '°';
      $('h2').textContent = RAD(t2).toFixed(1) + '°';
      $('h3').textContent = RAD(t3).toFixed(1) + '°';
      $('hHead').textContent = `[${fv.x.toFixed(3)}, ${fv.y.toFixed(3)}, ${fv.z.toFixed(3)}]`;
      $('hStat').textContent = avoidance ? 'SHADOW AVOID' : 'DIRECT LAMP';
      $('hStat').className = avoidance ? 'ok' : 'bad';

      const pt = $('shadowPt');
      if (pt) pt.textContent = `(${xH.toFixed(2)}, ${yH.toFixed(2)})`;
      const pd = $('shadowPd');
      if (pd) pd.textContent = `(${pdx.toFixed(2)}, ${pdy.toFixed(2)}, ${pdz.toFixed(2)})`;
      const riskEl = $('shadowRisk');
      if (riskEl) {
        const blocked = risk.level === 'high';
        riskEl.textContent = blocked ? 'LIKELY ON DESK' : 'CLEAR / OFFSET';
        riskEl.className = blocked ? 'hud-value bad' : 'hud-value ok';
      }
      const errEl = $('shadowIkErr');
      if (errEl) errEl.textContent = (err * 1e3).toFixed(2) + ' mm';

      this._updateShadowHudLabels();

      this._frameCount++;
      if (this._frameCount % 2 === 0) {
        this._mathChannel.postMessage({
          robot: 'rrr',
          q: [t1, t2, t3],
          ee: [fv.x, fv.y, fv.z],
          error: err,
          converged: true,
          status: 'shadow_demo',
          mode: avoidance ? 'shadow_avoid' : 'shadow_direct',
        });
      }
    } else {
      $('hStat').textContent = 'IK FAIL';
      $('hStat').className = 'bad';
    }

    this.shadowDemoRAF = requestAnimationFrame(() => this._runShadowDemo());
  }

  /* ═══════════ Raycaster ═══════════ */
  _onPointerDown(e) {
    if (e.button !== 0) return;
    const rect = this.sm.renderer.domElement.getBoundingClientRect();
    this._mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this._mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this._raycaster.setFromCamera(this._mouse, this.sm.camera);

    // ── Check link meshes first ──
    const linkHits = this._raycaster.intersectObjects(this.sm.linkMeshArray, false);
    if (linkHits.length > 0) {
      const hitMesh = linkHits[0].object;
      const idx = this.sm.linkMeshes.findIndex(e => e.mesh === hitMesh);
      if (idx >= 0) {
        this.showLinkCard(idx);
        return; // Don't start dragging
      }
    }

    if (this.sm.handMesh?.visible) {
      const handHits = this._raycaster.intersectObject(this.sm.handMesh, false);
      if (handHits.length > 0) {
        this._isDraggingHand = true;
        this._shadowHandManual = true;
        this.sm.controls.enabled = false;
        document.body.style.cursor = 'grabbing';
        return;
      }
    }

    // ── Check target sphere (existing drag logic) ──
    // Require Shift for dragging the target to prioritize OrbitControls
    const tgtHits = this._raycaster.intersectObject(this.sm.targetSphere, true);
    if (e.shiftKey && tgtHits.length > 0) {
      this._isDragging = true;
      this.sm.controls.enabled = false;
      document.body.style.cursor = 'grabbing';
      return;
    }

    // ── Empty space click — dismiss card ──
    this.hideLinkCard();
  }
  _onPointerMove(e) {
    if (this._isDraggingHand) {
      const rect = this.sm.renderer.domElement.getBoundingClientRect();
      this._mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this._mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      this._raycaster.setFromCamera(this._mouse, this.sm.camera);
      const pt = new THREE.Vector3();
      if (this._raycaster.ray.intersectPlane(this.sm.dragPlane, pt)) {
        this._handX = clamp(pt.x, 0.12, 0.58);
        this._handY = clamp(-pt.z, -0.22, 0.22);
        this.sm.setHandTablePosition(this._handX, this._handY);
        if (this.shadowDemoRunning) return;
        $('xd').value = this._handX;
        $('yd').value = this._handY;
        this.update();
      }
      return;
    }
    if (!this._isDragging) return;
    const rect = this.sm.renderer.domElement.getBoundingClientRect();
    this._mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this._mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this._raycaster.setFromCamera(this._mouse, this.sm.camera);
    const pt = new THREE.Vector3();
    if (this._raycaster.ray.intersectPlane(this.sm.dragPlane, pt)) {
      const x = clamp(pt.x, -0.15, 0.85), y = clamp(-pt.z, -0.30, 0.30);
      if (this._tab === 'jac') { $('jxd').value = x; $('jyd').value = y; }
      else { $('xd').value = x; $('yd').value = y; }
      this.update();
    }
  }
  _onPointerUp() {
    this._isDragging = false;
    this._isDraggingHand = false;
    this.sm.controls.enabled = true;
    document.body.style.cursor = 'default';
  }

  /* ═══════════ Link Card ═══════════ */

  _bindLinkCard() {
    if (!this._linkSlider || !this._linkCard) return;

    // Slider drag → resize link in real time
    this._linkSlider.addEventListener('input', () => {
      if (this._selectedLink < 0) return;
      const newLen = parseFloat(this._linkSlider.value);
      this.sm.resizeLink(this._selectedLink, newLen);
      this._linkValue.textContent = newLen.toFixed(3) + ' m';
      
      // Debounced logger
      clearTimeout(this._resizeLogTimer);
      this._resizeLogTimer = setTimeout(() => {
        logger.log(`Link ${this._selectedLink} resized to ${newLen.toFixed(3)} m`);
      }, 500);

      // Re-run FK to update the 3D arm
      this.update();
    });

    // Close button
    const closeBtn = $('linkCardClose');
    if (closeBtn) closeBtn.addEventListener('click', () => this.hideLinkCard());

    // Reset to default
    const resetBtn = $('linkCardReset');
    if (resetBtn) resetBtn.addEventListener('click', () => {
      if (this._selectedLink < 0) return;
      const entry = this.sm.linkMeshes[this._selectedLink];
      const defLen = entry.defaultLen;
      this._linkSlider.value = defLen;
      this.sm.resizeLink(this._selectedLink, defLen);
      this._linkValue.textContent = defLen.toFixed(3) + ' m';
      this.update();
    });
  }

  /**
   * Show the link detail card for a given link index.
   * @param {number} index - Link index (0=L1, 1=L2, 2=L3)
   */
  showLinkCard(index) {
    if (!this._linkCard) return;
    const entry = this.sm.linkMeshes[index];
    if (!entry) return;

    this._selectedLink = index;
    this.sm.highlightLink(index);

    // Populate the card
    this._linkTitle.textContent = entry.label;
    const currentLen = linkLengths[entry.key];
    this._linkSlider.min = entry.min;
    this._linkSlider.max = entry.max;
    this._linkSlider.step = 0.005;
    this._linkSlider.value = currentLen;
    this._linkValue.textContent = currentLen.toFixed(3) + ' m';
    this._linkMin.textContent = entry.min.toFixed(2);
    this._linkMax.textContent = entry.max.toFixed(2);
    this._linkDefault.textContent = 'default: ' + entry.defaultLen.toFixed(2) + ' m';

    // Show with animation
    this._linkCard.classList.add('visible');
  }

  /** Hide the link detail card and clear the highlight */
  hideLinkCard() {
    if (!this._linkCard) return;
    this._linkCard.classList.remove('visible');
    this.sm.clearHighlight();
    this._selectedLink = -1;
  }
}
