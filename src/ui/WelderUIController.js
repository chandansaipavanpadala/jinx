/**
 * WelderUIController.js — DOM event wiring, HUD updates, and task loop
 * for the 6-DOF Welding Robot. Bridges WelderSceneManager (3D) with HTML.
 *
 * Architecture mirrors ScaraUIController:
 *   _runTask() RAF loop → state machine → IK solver → scene update → HUD sync
 *
 * Also integrates the generic WaypointTask planner for user-defined paths.
 */

import * as THREE from 'three';
import { ik_dls, fk, jacobian, calcCartesianVelocity, WELDING_DH_CONFIG, getEllipsoid } from '../math/KinematicsNDOF.js';
import { WeldingStateMachine } from '../logic/WeldingTask.js';
import { WaypointTask } from '../logic/WaypointTask.js';

import WaypointPanel from './WaypointPanel.js';
import { logger } from './ConsoleLogger.js';
import MathDashboardPanel from './MathDashboardPanel.js';
import { makePanelsModular } from './FloatingPanel.js';

const $ = id => document.getElementById(id);
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

export class WelderUIController {
  constructor(sceneManager) {
    this.sm = sceneManager;

    // Home pose: Base=0, Shoulder=45°, Elbow=-45°, Roll=0, Pitch=-90°, Tool=0
    this.q = [0, Math.PI / 4, -Math.PI / 4, 0, -Math.PI / 2, 0];
    this.lastQ = [...this.q]; // Previous frame joint angles for velocity computation

    this.stateMachine = new WeldingStateMachine();
    this.isWelding = false;
    this._taskRAF = null;
    this._lastTime = 0;

    // View Toggles
    this._wireframe = false;
    this._frames = false;
    this._ellipsoid = false;
    this._cameraMode = 'orbit';

    // Hook state machine callbacks
    this.stateMachine.onTaskStateChange = (stateName) => {
      const el = $('val-task-state');
      if (el) el.innerText = stateName;
    };

    this.stateMachine.onWeldActive = (isActive) => {
      this.sm.setSparkActive(isActive);
      // Reset trail when starting a new weld
      if (isActive) this.sm.resetTrail();
    };



    // ── Waypoint Planner ──
    this._waypointTask = new WaypointTask();
    this._waypointRAF = null;
    this._waypointLastTime = 0;
    this._isWaypointRunning = false;

    this._waypointTask.onStateChange = (state) => {
      if (this._waypointPanel) {
        this._waypointPanel.setPlaying(state === 'RUNNING');
        if (state === 'COMPLETE' || state === 'IDLE') {
          this._isWaypointRunning = false;
          this._refreshWaypointViz();
        }
      }
    };

    this._waypointPanel = new WaypointPanel({
      mountRoot: document.getElementById('cw'),
      startX: 20, startY: 420,
      getEEPos: () => {
        const { position } = fk(this.q, WELDING_DH_CONFIG);
        return position;
      },
      onPlay: () => this._playWaypoints(),
      onStop: () => this._stopWaypoints(),
      onAdd: (wp) => {
        this._waypointTask.addWaypoint(wp);
        this._refreshWaypointViz();
      },
      onRemove: (i) => {
        this._waypointTask.removeWaypoint(i);
        this._refreshWaypointViz();
      },
      onMove: (from, to) => {
        this._waypointTask.moveWaypoint(from, to);
        this._refreshWaypointViz();
      },
      onClear: () => {
        this._waypointTask.clearWaypoints();
        this._refreshWaypointViz();
      },
      onModeChange: (mode) => {
        this._waypointTask.mode = mode;
      },
    });
    this._waypointPanel._ensureMounted();
    this._waypointPanel.hide();

    // Raycaster for link selection
    this._raycaster = new THREE.Raycaster();
    this._mouse = new THREE.Vector2();

    // Link card DOM refs
    this._selectedLink = -1;
    this._linkCard = $('linkCard');
    this._linkSlider = $('linkCardSlider');
    this._linkTitle = $('linkCardTitle');
    this._linkValue = $('linkCardValue');
    this._linkMin = $('linkCardMin');
    this._linkMax = $('linkCardMax');
    this._linkDefault = $('linkCardDefault');

    // ── Math Dashboard Panel ──
    this._mathPanel = null;

    // BroadcastChannel for math dashboard sync
    this._frameCount = 0;
    this._mathChannel = new BroadcastChannel('jinx_math_sync');
    // Command channel — receive FK/IK commands from dashboard
    this._cmdChannel = new BroadcastChannel('jinx_math_cmd');
    this._cmdChannel.onmessage = (e) => {
      const d = e.data;
      if (d.robot !== 'welder') return;
      if (this.isWelding) return;
      if (d.type === 'fk' && d.q) {
        this.q = [...d.q];
        for (let i = 0; i < 6; i++) {
          const sl = $(`t${i + 1}`);
          if (sl) sl.value = (d.q[i] * DEG).toFixed(0);
        }
        this._updateScene();
        this._updateHUD();
      } else if (d.type === 'ik' && d.target) {
        const result = ik_dls(d.target, this.q, WELDING_DH_CONFIG, 200, 0.05);
        this.q = result.q;
        this._syncSliders();
        this._updateScene();
        this._updateHUD();
      } else if (d.type === 'jog_joint' && d.joint !== undefined) {
        this.q[d.joint] += d.delta;
        this._cmdChannel.onmessage({ data: { robot: 'welder', type: 'fk', q: [...this.q] } });
      } else if (d.type === 'jog_ee' && d.delta) {
        const { position } = fk(this.q, WELDING_DH_CONFIG);
        const target = [
          position[0] + d.delta[0],
          position[1] + d.delta[1],
          position[2] + d.delta[2],
        ];
        const result = ik_dls(target, this.q, WELDING_DH_CONFIG, 200, 0.05);
        this.q = result.q;
        this._syncSliders();
        this._updateScene();
        this._updateHUD();
      } else if (d.type === 'home') {
        this.q = [0, Math.PI / 4, -Math.PI / 4, 0, -Math.PI / 2, 0];
        this._syncSliders();
        this._updateScene();
        this._updateHUD();
      }
    };

    this._bindEvents();
    this._bindLinkCard();

    // Initial render
    this._updateScene();
    this._updateHUD();
    makePanelsModular($('cw'));
    logger.log('WelderUIController initialized.');
  }

  /* ═══════════ Event Binding ═══════════ */
  _bindEvents() {
    // Tab switching (design system: .tab + .pane.on)
    document.querySelectorAll('#tabBar .tab').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('#tabBar .tab').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.pane').forEach(p => p.classList.remove('on'));
        e.target.classList.add('active');
        const pane = $('pane-' + e.target.dataset.tab);
        if (pane) pane.classList.add('on');
      });
    });

    // 6 Joint Sliders (FK control)
    for (let i = 1; i <= 6; i++) {
      const slider = $(`t${i}`);
      if (slider) {
        slider.addEventListener('input', () => {
          if (this.isWelding) return; // Don't interfere during task
          this.q[i - 1] = parseFloat(slider.value) * RAD;
          this._updateScene();
          this._updateHUD();
        });
      }
    }

    // Home / Reset button
    const btnReset = $('btn-reset');
    if (btnReset) {
      btnReset.addEventListener('click', () => {
        // Stop any running task
        if (this.isWelding) {
          logger.log('Welding task stopped.');
          this.stateMachine.stop();
          this.isWelding = false;
          if (this._taskRAF) { cancelAnimationFrame(this._taskRAF); this._taskRAF = null; }
          const wb = $('btn-weld');
          if (wb) { wb.textContent = '▶ Start Welding'; wb.classList.remove('stop'); }
        }
        logger.info('Resetting Welder to home pose.');
        this.sm.resetTrail();
        this.q = [0, Math.PI / 4, -Math.PI / 4, 0, -Math.PI / 2, 0];
        this._updateScene();
        this._updateHUD();
        this._syncSliders();
      });
    }

    // Welding Task button
    const btnWeld = $('btn-weld');
    if (btnWeld) {
      btnWeld.addEventListener('click', () => this._toggleWelding());
    }



    // Waypoint planner button
    const wpBtn = $('btn-waypoints');
    if (wpBtn) {
      wpBtn.addEventListener('click', () => {
        this._waypointPanel.toggle();
      });
    }

    // Math dashboard
    const mathBtn = $('btn-math-panel');
    if (mathBtn) mathBtn.addEventListener('click', () => {
      if (!this._mathPanel) {
        this._mathPanel = new MathDashboardPanel({
          mountRoot: document.getElementById('cw'),
          robotType: 'welder'
        });
      }
      this._mathPanel.toggle();
      mathBtn.classList.toggle('active', this._mathPanel.isVisible);
    });

    // Toolbar Toggles
    const wireBtn = $('btn-wireframe');
    if (wireBtn) wireBtn.addEventListener('click', () => {
      this._wireframe = !this._wireframe;
      this.sm.setWireframe(this._wireframe);
      wireBtn.classList.toggle('active', this._wireframe);
    });

    const frameBtn = $('btn-frames');
    if (frameBtn) frameBtn.addEventListener('click', () => {
      this._frames = !this._frames;
      this.sm.setAxesVisible(this._frames);
      frameBtn.classList.toggle('active', this._frames);
    });

    const ellBtn = $('btn-ellipsoid');
    if (ellBtn) ellBtn.addEventListener('click', () => {
      this._ellipsoid = !this._ellipsoid;
      ellBtn.classList.toggle('active', this._ellipsoid);
      this._updateHUD();
    });

    const orbitBtn = $('btn-orbit');
    const panBtn = $('btn-pan');
    if (orbitBtn) orbitBtn.addEventListener('click', () => {
      this._cameraMode = 'orbit';
      this.sm.controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
      orbitBtn.classList.add('active');
      if (panBtn) panBtn.classList.remove('active');
    });
    if (panBtn) panBtn.addEventListener('click', () => {
      this._cameraMode = 'pan';
      this.sm.controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
      panBtn.classList.add('active');
      if (orbitBtn) orbitBtn.classList.remove('active');
    });

    // Hierarchy Clicks
    document.querySelectorAll('#hierarchy [data-link]').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.link);
        this._showLinkInspector(idx);
      });
    });

    // Keyboard Shortcuts
    window.addEventListener('keydown', e => {
      const k = e.key.toLowerCase();
      if (k === ' ') { e.preventDefault(); this._toggleTask(); }
      if (k === 'r') this._resetPose();
      if (k === 'w') wireBtn?.click();
      if (k === 'f') frameBtn?.click();
      if (k === 'e') ellBtn?.click();
    });
  
    // Raycaster — link click detection
    const dom = this.sm.renderer.domElement;
    dom.addEventListener('pointerdown', e => this._onPointerDown(e));
  }

  /* ═══════════ Toggle Welding Task ═══════════ */
  _toggleWelding() {
    const btn = $('btn-weld');

    if (this.isWelding) {
      // ── Stop ──
      logger.log('Welding task stopped.');
      this.stateMachine.stop();
      this.isWelding = false;
      if (this._taskRAF) { cancelAnimationFrame(this._taskRAF); this._taskRAF = null; }
      if (btn) { btn.textContent = '▶ Start Welding'; btn.classList.remove('stop'); }
      this.sm.setSparkActive(false);
    } else {
      // ── Start ──
      logger.info('Welding task started.');
      this.sm.resetTrail();
      this.stateMachine.start();
      this.isWelding = true;
      if (btn) { btn.textContent = '⏹ Stop Welding'; btn.classList.add('stop'); }

      this._lastTime = performance.now();
      this._runTask();
    }
  }

  /* ═══════════ Task Animation Loop ═══════════
     This is the CRITICAL loop that was broken. The pipeline is:
     1. Compute dt from requestAnimationFrame timestamp
     2. Ask state machine for the Cartesian target at this dt
     3. Solve IK(target) → new joint angles q
     4. Save q, call sceneManager.updateScene(q) → 3D meshes move
     5. Update all HUD/slider readouts
     ═══════════════════════════════════════════ */
  _runTask() {
    if (!this.isWelding) return;

    const now = performance.now();
    const rawDt = (now - this._lastTime) / 1000;
    this._lastTime = now;

    // Clamp dt to prevent jumps on tab-switch
    const dt = Math.min(rawDt, 0.1);

    // Skip if state machine is idle (task finished)
    if (this.stateMachine.currentState === this.stateMachine.states.IDLE) {
      // Task completed — auto-stop
      this.isWelding = false;
      const btn = $('btn-weld');
      if (btn) { btn.textContent = '▶ Start Welding'; btn.classList.remove('stop'); }
      this.sm.setSparkActive(false);
      // Update UI to show completion
      const stEl = $('val-task-state');
      if (stEl) stEl.innerText = 'COMPLETE ✓';
      const progEl = $('val-task-prog');
      if (progEl) progEl.innerText = '100%';
      this._updateHUD(); // reset HUD status to READY
      
      if (this._lastTaskState !== 'completed') {
        logger.info('Welding task completed successfully.');
        this._lastTaskState = 'completed';
      }
      return;
    }
    this._lastTaskState = 'running';

    // ── 1. Get current FK position (for state machine first-frame init) ──
    const { position: currentPos } = fk(this.q, WELDING_DH_CONFIG);

    // ── 2. State machine produces the Cartesian target [x,y,z] ──
    const targetXYZ = this.stateMachine.update(dt, currentPos);

    // ── 3. Solve IK to get joint angles that reach this target ──
    const ik = ik_dls(targetXYZ, this.q, WELDING_DH_CONFIG, 80, 0.08, 1e-4);
    this.q = ik.q;

    // ── 4. Move the 3D meshes ──
    this._updateScene(targetXYZ);

    // ── 5. Add trail point during WELDING state ──
    if (this.stateMachine.currentState === this.stateMachine.states.WELDING) {
      if (this.sm.eeWorldPos) this.sm.addTrailPoint(this.sm.eeWorldPos);
    }

    // ── 6. Update HUD & UI ──
    this._updateHUD();
    this._syncSliders();
    this._updateTaskUI();



    // ── 8. Store previous q for velocity computation ──
    this.lastQ = [...this.q];

    // ── Schedule next frame ──
    this._taskRAF = requestAnimationFrame(() => this._runTask());
  }

  /* ═══════════ Scene Update ═══════════ */
  _updateScene(targetDH) {
    // targetDH is [x,y,z] in DH coordinates, or null
    this.sm.updateScene(this.q, targetDH || null);
  }

  /* ═══════════ HUD + FK Readouts ═══════════ */
  _updateHUD() {
    const { position } = fk(this.q, WELDING_DH_CONFIG);

    // HUD joint values
    for (let i = 0; i < 6; i++) {
      const degVal = (this.q[i] * DEG).toFixed(1);
      const hudEl = $(`hud-q${i + 1}`);
      if (hudEl) hudEl.innerText = `${degVal}°`;

      const valEl = $(`val-t${i + 1}`);
      if (valEl) valEl.innerText = `${degVal}°`;
    }

    // EE position cards
    const vx = $('val-x'), vy = $('val-y'), vz = $('val-z');
    if (vx) vx.innerText = position[0].toFixed(3);
    if (vy) vy.innerText = position[1].toFixed(3);
    if (vz) vz.innerText = position[2].toFixed(3);

    // Update tree badges
    for (let i = 0; i < 6; i++) {
      const badge = $(`tree-t${i + 1}`);
      if (badge) badge.textContent = (this.q[i] * DEG).toFixed(1) + '°';
    }

    // Update Professional HUD Groups (J1-J3, J4-J6)
    const h123 = $('hud-q123');
    if (h123) {
      const v1 = (this.q[0] * DEG).toFixed(1);
      const v2 = (this.q[1] * DEG).toFixed(1);
      const v3 = (this.q[2] * DEG).toFixed(1);
      h123.textContent = `${v1}, ${v2}, ${v3}`;
    }
    const h456 = $('hud-q456');
    if (h456) {
      const v4 = (this.q[3] * DEG).toFixed(1);
      const v5 = (this.q[4] * DEG).toFixed(1);
      const v6 = (this.q[5] * DEG).toFixed(1);
      h456.textContent = `${v4}, ${v5}, ${v6}`;
    }

    // Update Status Bar Telemetry
    const fpsEl = $('status-fps');
    if (fpsEl && this._frameCount % 30 === 0) {
      // Basic FPS estimate from delta
      const now = performance.now();
      if (this._lastTime) {
        const dt = now - this._lastTime;
        const fps = Math.round(1000 / dt);
        fpsEl.textContent = fps;
      }
      this._lastTime = now;
    }

    // Update Ellipsoid
    if (this._ellipsoid) {
      const { J, cols } = jacobian(this.q, WELDING_DH_CONFIG);
      const ell = getEllipsoid(J, cols);
      const rot = new THREE.Matrix4().fromArray([
        ell.rotation[0], ell.rotation[3], ell.rotation[6], 0,
        ell.rotation[1], ell.rotation[4], ell.rotation[7], 0,
        ell.rotation[2], ell.rotation[5], ell.rotation[8], 0,
        0, 0, 0, 1
      ]);
      // DH to Three coordinate swap for visualization
      const pEll = new THREE.Vector3(position[0], position[2], -position[1]);
      this.sm.updateEllipsoid(true, ell.singularValues, rot, ell.mu, pEll);
    } else {
      this.sm.updateEllipsoid(false);
    }

    // HUD EE readout
    const hHead = $('hHead');
    if (hHead) hHead.innerText = `(${position[0].toFixed(3)}, ${position[1].toFixed(3)}, ${position[2].toFixed(3)})`;

    // HUD status
    const hStat = $('hStat');
    if (hStat) {
      if (this.isWelding) {
        hStat.innerText = this.stateMachine.currentState === this.stateMachine.states.WELDING ? '🔥 WELDING' : '⏳ MOVING';
        hStat.className = 'bad';
      } else {
        hStat.innerText = 'READY';
        hStat.className = 'ok';
      }
    }

    // Jacobian & Singularity metrics
    this._updateJacobian();

    // ── Broadcast to Math Dashboard (throttled to every 2nd frame) ──
    this._frameCount++;
    if (this._frameCount % 2 === 0) {
      const jac = jacobian(this.q, WELDING_DH_CONFIG);
      const n = 6;
      const J2d = [];
      for (let r = 0; r < 3; r++) {
        const row = [];
        for (let c = 0; c < n; c++) row.push(jac.J[r * n + c]);
        J2d.push(row);
      }
      const JJt_bc = new Float64Array(9);
      for (let i = 0; i < 3; i++)
        for (let j = 0; j < 3; j++) {
          let sum = 0;
          for (let k = 0; k < n; k++) sum += jac.J[i * n + k] * jac.J[j * n + k];
          JJt_bc[i * 3 + j] = sum;
        }
      const det_bc = JJt_bc[0] * (JJt_bc[4] * JJt_bc[8] - JJt_bc[5] * JJt_bc[7])
        - JJt_bc[1] * (JJt_bc[3] * JJt_bc[8] - JJt_bc[5] * JJt_bc[6])
        + JJt_bc[2] * (JJt_bc[3] * JJt_bc[7] - JJt_bc[4] * JJt_bc[6]);
      const mu_bc = Math.sqrt(Math.max(0, det_bc));
      this._mathChannel.postMessage({
        robot: 'welder',
        q: [...this.q],
        ee: [...position],
        jacobian: J2d,
        mu: mu_bc,
        detJ: det_bc,
        reach: Math.sqrt(position[0] ** 2 + position[1] ** 2 + position[2] ** 2),
        error: 0,
        converged: true,
        status: this.isWelding ? 'welding' : 'ready',
        sdot: 0,
        sddot: 0,
        mode: this.isWelding ? 'welding' : 'fk',
      });
    }
  }

  /* ═══════════ Sync Sliders to Current q ═══════════ */
  _syncSliders() {
    for (let i = 0; i < 6; i++) {
      const slider = $(`t${i + 1}`);
      if (slider) slider.value = (this.q[i] * DEG).toFixed(0);
    }
  }

  /* ═══════════ Task UI Cards ═══════════ */
  _updateTaskUI() {
    // Progress
    const pct = this.stateMachine.duration > 0
      ? Math.min(100, Math.floor((this.stateMachine.timer / this.stateMachine.duration) * 100))
      : 0;

    const progEl = $('val-task-prog');
    if (progEl) progEl.innerText = `${pct}%`;

    // Progress bar
    const bar = $('taskBar');
    if (bar) bar.style.width = `${pct}%`;

    // Phase label
    const barLabel = $('taskBarLabel');
    if (barLabel) {
      const states = this.stateMachine.states;
      const cs = this.stateMachine.currentState;
      const labels = {
        [states.IDLE]: 'Idle',
        [states.APPROACH]: 'Approaching seam',
        [states.WELDING]: `Welding edge ${this.stateMachine._cornerIndex + 1}/5`,
        [states.RETRACT]: 'Retracting',
        [states.RETURN]: 'Returning home',
      };
      barLabel.innerText = labels[cs] || 'Phase progress';
    }

    // Target
    const tgt = this.stateMachine.pTarget;
    const tgtEl = $('val-task-tgt');
    if (tgtEl && tgt) {
      tgtEl.innerText = `[${tgt[0].toFixed(3)}, ${tgt[1].toFixed(3)}, ${tgt[2].toFixed(3)}]`;
    }
  }

  /* ═══════════ Jacobian & Singularity ═══════════ */
  _updateJacobian() {
    const jac = jacobian(this.q, WELDING_DH_CONFIG);
    const n = 6;

    // Jacobian grid
    const jGrid = $('jac-grid');
    if (jGrid) {
      jGrid.innerHTML = '';
      const headers = ['', 'θ₁', 'θ₂', 'θ₃', 'θ₄', 'θ₅', 'θ₆'];
      headers.forEach((h, idx) => {
        const div = document.createElement('div');
        div.className = idx === 0 ? '' : 'jh';
        div.innerText = h;
        jGrid.appendChild(div);
      });

      const rowLabels = ['ẋ', 'ẏ', 'ż'];
      const axisClasses = ['axis-x', 'axis-y', 'axis-z'];
      const cellAxisClasses = ['jc-x', 'jc-y', 'jc-z'];

      // Find max value for color scaling
      let maxVal = 1e-9;
      for (let r = 0; r < 3; r++)
        for (let c = 0; c < n; c++)
          maxVal = Math.max(maxVal, Math.abs(jac.J[r * n + c]));

      for (let r = 0; r < 3; r++) {
        const lbl = document.createElement('div');
        lbl.className = 'jrow-lbl ' + axisClasses[r];
        lbl.innerText = rowLabels[r];
        jGrid.appendChild(lbl);
        for (let c = 0; c < 6; c++) {
          const cell = document.createElement('div');
          cell.className = 'jc ' + cellAxisClasses[r];
          const v = jac.J[r * n + c];
          const norm = v / maxVal;
          cell.innerText = v.toFixed(3);

          // Color-code like the SCARA Jacobian display
          if (Math.abs(v) < 0.001) {
            cell.style.background = 'rgba(80,80,100,0.3)';
            cell.style.color = '#555580';
          } else if (norm > 0) {
            cell.style.background = `rgba(32,${Math.round(80 + norm * 120)},60,0.25)`;
            cell.style.color = `rgb(50,${Math.round(160 + norm * 95)},80)`;
          } else {
            cell.style.background = `rgba(${Math.round(80 + (-norm) * 120)},30,30,0.25)`;
            cell.style.color = `rgb(${Math.round(160 + (-norm) * 95)},50,50)`;
          }

          jGrid.appendChild(cell);
        }
      }
    }

    // Singularity metrics: det(J·Jᵀ) for the 3×6 linear part
    const JJt = new Float64Array(9);
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) {
        let sum = 0;
        for (let k = 0; k < 6; k++) sum += jac.J[i * n + k] * jac.J[j * n + k];
        JJt[i * 3 + j] = sum;
      }

    const d = JJt[0] * (JJt[4] * JJt[8] - JJt[5] * JJt[7])
      - JJt[1] * (JJt[3] * JJt[8] - JJt[5] * JJt[6])
      + JJt[2] * (JJt[3] * JJt[7] - JJt[4] * JJt[6]);
    const mu = Math.sqrt(Math.max(0, d));

    const eDet = $('val-det'), eMu = $('val-mu'), warn = $('singularity-warn');
    if (eDet) eDet.innerText = d.toExponential(3);
    if (eMu) eMu.innerText = mu.toExponential(3);
    if (warn) {
      if (mu < 0.001) {
        warn.classList.add('on');
        if (this._lastSingularity !== true) {
          logger.warn(`Approaching singularity (μ = ${mu.toExponential(2)})`);
          this._lastSingularity = true;
        }
      } else {
        warn.classList.remove('on');
        if (this._lastSingularity === true) {
          this._lastSingularity = false;
        }
      }
    }
  }

  /* ═══════════ Initial / Manual Update ═══════════ */
  update() {
    this._updateScene();
    this._updateHUD();
    this._syncSliders();
  }



  /* ═══════════ Waypoint Planner ═══════════ */

  _refreshWaypointViz() {
    this._waypointPanel.refreshList(this._waypointTask.waypoints);
    this.sm.updateWaypointVisualization(this._waypointTask.waypoints);
    this._waypointPanel.updateStatus(
      this._waypointTask.state, this._waypointTask.progress,
      this._waypointTask.currentSegment, this._waypointTask.totalSegments
    );
  }

  _playWaypoints() {
    if (this._waypointTask.count < 2) return;
    // Stop welding task if running
    if (this.isWelding) this._toggleWelding();

    this._waypointTask.play();
    this._isWaypointRunning = true;
    this._waypointLastTime = performance.now();
    this._waypointPanel.setPlaying(true);
    this._runWaypointTask();
  }

  _stopWaypoints() {
    this._waypointTask.stop();
    this._isWaypointRunning = false;
    if (this._waypointRAF) { cancelAnimationFrame(this._waypointRAF); this._waypointRAF = null; }
    this._waypointPanel.setPlaying(false);
    this._refreshWaypointViz();
  }

  _runWaypointTask() {
    if (!this._isWaypointRunning) return;

    const now = performance.now();
    const dt = Math.min((now - this._waypointLastTime) / 1000, 0.1);
    this._waypointLastTime = now;

    const { position: currentPos } = fk(this.q, WELDING_DH_CONFIG);
    const targetXYZ = this._waypointTask.update(dt, currentPos);

    if (!targetXYZ) {
      // Task finished or stopped
      this._isWaypointRunning = false;
      this._waypointPanel.setPlaying(false);
      this._refreshWaypointViz();
      return;
    }

    // IK solve
    const ik = ik_dls(targetXYZ, this.q, WELDING_DH_CONFIG, 80, 0.08, 1e-4);
    this.q = ik.q;

    // Update 3D scene
    this._updateScene(targetXYZ);
    this._updateHUD();
    this._syncSliders();

    // Update waypoint panel status
    this._waypointPanel.updateStatus(
      this._waypointTask.state, this._waypointTask.progress,
      this._waypointTask.currentSegment, this._waypointTask.totalSegments
    );


    this.lastQ = [...this.q];

    this._waypointRAF = requestAnimationFrame(() => this._runWaypointTask());
  }

  /* ═══════════ Raycaster — Link Selection ═══════════ */
  _onPointerDown(e) {
    if (e.button !== 0) return;
    const rect = this.sm.renderer.domElement.getBoundingClientRect();
    this._mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this._mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this._raycaster.setFromCamera(this._mouse, this.sm.camera);

    // ── Check link meshes for click-to-resize ──
    const linkHits = this._raycaster.intersectObjects(this.sm.linkMeshArray, false);
    if (linkHits.length > 0) {
      const hitMesh = linkHits[0].object;
      const idx = this.sm.linkMeshes.findIndex(e => e.mesh === hitMesh);
      if (idx >= 0) {
        this.showLinkCard(idx);
        return; // consume click
      }
    }

    // ── Empty space click — dismiss card ──
    this.hideLinkCard();
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
      
      clearTimeout(this._resizeLogTimer);
      this._resizeLogTimer = setTimeout(() => {
        logger.log(`Link ${this._selectedLink} resized to ${newLen.toFixed(3)} m`);
      }, 500);

      // Re-run FK to update the 3D arm
      this._updateScene();
      this._updateHUD();
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
      this._updateScene();
      this._updateHUD();
    });
  }

  /**
   * Show the link detail card for a given link index.
   * @param {number} index - Link index
   */
  showLinkCard(index) {
    if (!this._linkCard) return;
    const entry = this.sm.linkMeshes[index];
    if (!entry) return;

    this._selectedLink = index;
    this.sm.highlightLink(index);

    // Populate the card
    this._linkTitle.textContent = entry.label;
    const currentLen = WELDING_DH_CONFIG[entry.dhIndex][entry.dhKey];
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
