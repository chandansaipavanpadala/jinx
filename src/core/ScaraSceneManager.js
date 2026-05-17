/**
 * ScaraSceneManager.js — Three.js 3D Scene Controller for the SCARA Arm
 *
 * Renders a 4-DOF SCARA (R-R-P-R) robot driven by the generalized
 * KinematicsNDOF engine. Zero DOM text manipulation.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { fk, SCARA_DH_CONFIG } from '../math/KinematicsNDOF.js';
import { dhPositionToThree } from '../model/RobotModel.js';

const TRAIL_N = 80;
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

// DH config constants for mesh sizing
const BASE_H  = 0.35;  // d1 — base column height
const L1      = 0.30;  // a1 — upper arm length
const L2      = 0.25;  // a2 — forearm length
const STROKE  = 0.35;  // max prismatic stroke (matches DH limitMax)

export default class ScaraSceneManager {

  constructor(canvasId = 'cw') {
    const wrap = document.getElementById(canvasId);

    // ── Scene ──
    this._scene = new THREE.Scene();
    this._scene.background = new THREE.Color(0x17181c);
    this._scene.fog = new THREE.Fog(0x17181c, 3.5, 8.0);

    // ── Camera ──
    this._camera = new THREE.PerspectiveCamera(50, wrap.clientWidth / wrap.clientHeight, 0.01, 10);
    this._camera.position.set(1.2, 1.0, 1.2);

    // ── Renderer ──
    this._renderer = new THREE.WebGLRenderer({ antialias: true });
    this._renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this._renderer.shadowMap.enabled = true;
    this._renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this._renderer.setSize(wrap.clientWidth, wrap.clientHeight);
    this._renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this._renderer.toneMappingExposure = 1.1;
    wrap.insertBefore(this._renderer.domElement, wrap.firstChild);

    // ── Environment map ──
    const pmrem = new THREE.PMREMGenerator(this._renderer);
    pmrem.compileEquirectangularShader();
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(
      new THREE.BoxGeometry(100, 100, 100),
      new THREE.MeshBasicMaterial({ color: 0x080a14, side: THREE.BackSide })
    ));
    // Factory ceiling panels — multiple white rects for even industrial fill
    [[-3,12,0],[3,12,0],[0,12,4],[0,12,-4]].forEach(([x,y,z]) => {
      const rl = new THREE.RectAreaLight(0xe8f0ff, 4, 8, 8);
      rl.position.set(x, y, z); rl.lookAt(0, 0, 0);
      envScene.add(rl);
    });
    this._scene.environment = pmrem.fromScene(envScene).texture;

    // ── OrbitControls ──
    this._controls = new OrbitControls(this._camera, this._renderer.domElement);
    this._controls.target.set(0.15, 0.12, 0);
    this._controls.enableDamping = true;
    this._controls.dampingFactor = 0.07;
    this._controls.minDistance = 0.2;
    this._controls.maxDistance = 4;
    this._camera.lookAt(this._controls.target);

    // ── TransformControls (for dragging scene objects) ──
    this._transformControls = new TransformControls(this._camera, this._renderer.domElement);
    this._transformControls.setMode('translate');
    this._transformControls.setSize(0.5);
    this._transformControls.showX = true;
    this._transformControls.showY = false;  // Lock to XZ plane (table surface)
    this._transformControls.showZ = true;
    this._scene.add(this._transformControls.getHelper());

    // Disable OrbitControls while dragging a scene object
    this._transformControls.addEventListener('dragging-changed', (event) => {
      this._controls.enabled = !event.value;
    });

    // Callback for external sync when an object is dragged
    this._onObjectDragged = null;
    this._transformControls.addEventListener('change', () => {
      if (this._transformControls.object && this._onObjectDragged) {
        const obj = this._transformControls.object;
        // Clamp Y to table surface during drag
        if (obj === this._payload) {
          obj.position.y = 0.013;
        } else if (obj === this._dropZoneMesh) {
          obj.position.y = 0.013;
        }
        this._onObjectDragged(obj);
      }
    });

    // ── Init sub-systems ──
    this._initLighting();
    this._initMaterials();
    this._initEnvironment();
    this._initScaraGeometry();
    this._initTargetAndTrail();
    this._initPerceptionCamera();

    // ── Drag plane (horizontal at table surface y ≈ 0.025) ──
    this._dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.025);

    // ── Resize ──
    this._wrap = wrap;
    const resizeObserver = new ResizeObserver(() => {
      const w = this._wrap.clientWidth, h = this._wrap.clientHeight;
      if (w === 0 || h === 0) return;
      this._camera.aspect = w / h;
      this._camera.updateProjectionMatrix();
      this._renderer.setSize(w, h);
    });
    resizeObserver.observe(this._wrap);
  }

  /* ════════════════════════════════════════════════════════
     Lighting — Cool industrial factory look
     ════════════════════════════════════════════════════════ */
  _initLighting() {
    const s = this._scene;

    // Subtle white ambient fill
    this._lAmb = new THREE.AmbientLight(0xffffff, 0.4);
    s.add(this._lAmb);

    // Primary studio light (key light)
    this._lMain = new THREE.DirectionalLight(0xffffff, 1.2);
    this._lMain.position.set(2, 4, 3);
    this._lMain.castShadow = true;
    this._lMain.shadow.camera.left = -2;
    this._lMain.shadow.camera.right = 2;
    this._lMain.shadow.camera.top = 2;
    this._lMain.shadow.camera.bottom = -2;
    this._lMain.shadow.mapSize.set(1024, 1024);
    this._lMain.shadow.bias = -0.0005;
    s.add(this._lMain);

    // Soft hemisphere light (sky/ground fill)
    this._lHemi = new THREE.HemisphereLight(0xe8f0ff, 0x444444, 0.8);
    s.add(this._lHemi);

    // Rim light (for definition)
    const rim = new THREE.DirectionalLight(0xffffff, 0.4);
    rim.position.set(-2, 1, -2);
    s.add(rim);
  }

  /* ════════════════════════════════════════════════════════
     Materials
     ════════════════════════════════════════════════════════ */
  _initMaterials() {
    this._mBase = new THREE.MeshStandardMaterial({
      color: 0x333333, roughness: 0.8, metalness: 0.2
    });
    this._mArm = new THREE.MeshStandardMaterial({
      color: 0x4a4a4e, roughness: 0.8, metalness: 0.2
    });
    this._mJoint = new THREE.MeshStandardMaterial({
      color: 0x2d2d30, roughness: 0.7, metalness: 0.3
    });
    this._mShaft = new THREE.MeshStandardMaterial({
      color: 0x888888, roughness: 0.2, metalness: 0.8
    });
    this._mEE = new THREE.MeshStandardMaterial({
      color: 0xCC2222, roughness: 0.3, metalness: 0.4
    });
    this._mTgt = new THREE.MeshStandardMaterial({
      color: 0x3a96dd, roughness: 0.3, metalness: 0.8
    });
    this._mTrail = new THREE.MeshBasicMaterial({
      color: 0x3a96dd, transparent: true, opacity: 0.3, depthWrite: false
    });
    this._mBeam = new THREE.LineDashedMaterial({
      color: 0x3a96dd, dashSize: 0.02, gapSize: 0.01, transparent: true, opacity: 0.4
    });
  }

  /* ════════════════════════════════════════════════════════
     Environment — Industrial Factory: Floor, Pedestal, Conveyor

     CRITICAL: The old table top was at Y ≈ 0.0.
     The conveyor belt surface is also at Y ≈ 0.0 so the
     PickAndPlace state machine's graspZ / safeZ remain valid.
     ════════════════════════════════════════════════════════ */
  _initEnvironment() {
    const s = this._scene;

    // ── 1. Polished concrete factory floor ──
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a1c, roughness: 0.8,
    });
    const floorG = new THREE.PlaneGeometry(8, 8);
    floorG.rotateX(-Math.PI / 2);
    const floor = new THREE.Mesh(floorG, floorMat);
    floor.position.y = -0.76;
    floor.receiveShadow = true;
    s.add(floor);

    // Dual-layer Engineering Grid (Phase 4A)
    const majorGrid = new THREE.GridHelper(8, 16, 0x444444, 0x333333);
    majorGrid.position.y = -0.758;
    majorGrid.material.transparent = true;
    majorGrid.material.opacity = 0.18;
    majorGrid.name = "majorGrid";
    s.add(majorGrid);

    const minorGrid = new THREE.GridHelper(8, 80, 0x222222, 0x1a1a1c);
    minorGrid.position.y = -0.759;
    minorGrid.material.opacity = 0.18;
    minorGrid.material.transparent = true;
    s.add(minorGrid);

    // ── 2. Hazard floor markings (yellow safety stripes around robot base) ──
    const hazardMat = new THREE.MeshStandardMaterial({
      color: 0xccaa00, roughness: 0.85, metalness: 0.05,
      transparent: true, opacity: 0.25
    });
    // Rectangular safety zone on floor
    const hazardZone = new THREE.Mesh(
      new THREE.RingGeometry(0.65, 0.68, 64),
      hazardMat
    );
    hazardZone.rotation.x = -Math.PI / 2;
    hazardZone.position.y = -0.754;
    s.add(hazardZone);

    // ── 3. Industrial pedestal (replaces table under robot base) ──
    // Top cap — heavy steel plate, Y top face ≈ 0.0
    const pedestalMat = new THREE.MeshPhysicalMaterial({
      color: 0x2a2d38, roughness: 0.35, metalness: 0.90,
      clearcoat: 0.4, clearcoatRoughness: 0.3, envMapIntensity: 1.4
    });
    const pedTop = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 0.03, 32),
      pedestalMat
    );
    pedTop.position.set(0, -0.015, 0);
    pedTop.castShadow = pedTop.receiveShadow = true;
    s.add(pedTop);

    // Pedestal column
    const pedCol = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.09, 0.72, 24),
      pedestalMat
    );
    pedCol.position.set(0, -0.39, 0);
    pedCol.castShadow = true;
    s.add(pedCol);

    // Pedestal base plate (floor mount)
    const pedBase = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.15, 0.02, 32),
      pedestalMat
    );
    pedBase.position.set(0, -0.75, 0);
    pedBase.receiveShadow = true;
    s.add(pedBase);

    // Gold accent ring at pedestal top
    const pedAccent = new THREE.Mesh(
      new THREE.TorusGeometry(0.12, 0.004, 8, 48),
      new THREE.MeshPhysicalMaterial({
        color: 0xC8A200, roughness: 0.05, metalness: 0.95,
        clearcoat: 1.0, envMapIntensity: 2.0
      })
    );
    pedAccent.rotation.x = Math.PI / 2;
    pedAccent.position.set(0, 0.0, 0);
    s.add(pedAccent);

    // ── 4. Conveyor belt ──
    // Belt dimensions: extends along X-axis where pick/place targets are
    const BELT_W = 0.32;   // width (Z-axis)
    const BELT_L = 1.4;    // length (X-axis)
    const BELT_H = 0.74;   // total height from floor to belt surface
    const BELT_CX = 0.40;  // center X
    const BELT_CZ = 0.0;   // center Z
    const BELT_SURFACE_Y = -0.02; // top surface ~= old table top

    // Belt frame (main body)
    const frameMat = new THREE.MeshPhysicalMaterial({
      color: 0x3a3d48, roughness: 0.4, metalness: 0.85,
      clearcoat: 0.3, envMapIntensity: 1.2
    });
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(BELT_L, BELT_H - 0.04, BELT_W - 0.06),
      frameMat
    );
    frame.position.set(BELT_CX, BELT_SURFACE_Y - (BELT_H - 0.04) / 2, BELT_CZ);
    frame.castShadow = frame.receiveShadow = true;
    s.add(frame);

    // Belt surface — dark rubber
    const beltMat = new THREE.MeshPhysicalMaterial({
      color: 0x1c1c1c, roughness: 0.92, metalness: 0.05,
      clearcoat: 0.05,
    });
    const belt = new THREE.Mesh(
      new THREE.BoxGeometry(BELT_L - 0.06, 0.018, BELT_W - 0.04),
      beltMat
    );
    belt.position.set(BELT_CX, BELT_SURFACE_Y + 0.009, BELT_CZ);
    belt.receiveShadow = true;
    s.add(belt);

    // Belt texture lines (subtle ridges)
    const ridgeMat = new THREE.MeshStandardMaterial({
      color: 0x252525, roughness: 0.95, metalness: 0.0,
    });
    for (let i = 0; i < 28; i++) {
      const rx = BELT_CX - (BELT_L - 0.1) / 2 + i * ((BELT_L - 0.1) / 27);
      const ridge = new THREE.Mesh(
        new THREE.BoxGeometry(0.003, 0.001, BELT_W - 0.06),
        ridgeMat
      );
      ridge.position.set(rx, BELT_SURFACE_Y + 0.019, BELT_CZ);
      s.add(ridge);
    }

    // Side rails — metallic guard rails
    const railMat = new THREE.MeshPhysicalMaterial({
      color: 0x5a6070, roughness: 0.2, metalness: 0.92,
      clearcoat: 0.5, envMapIntensity: 1.6
    });
    [-1, 1].forEach(side => {
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(BELT_L, 0.04, 0.02),
        railMat
      );
      rail.position.set(BELT_CX, BELT_SURFACE_Y + 0.02, BELT_CZ + side * (BELT_W / 2));
      rail.castShadow = true;
      s.add(rail);
    });

    // End rollers — cylindrical drums at each end
    const rollerMat = new THREE.MeshPhysicalMaterial({
      color: 0x6a6d78, roughness: 0.25, metalness: 0.88,
      envMapIntensity: 1.0
    });
    [-1, 1].forEach(end => {
      const roller = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.035, BELT_W + 0.02, 20),
        rollerMat
      );
      roller.rotation.x = Math.PI / 2;
      roller.position.set(
        BELT_CX + end * (BELT_L / 2 - 0.02),
        BELT_SURFACE_Y + 0.01,
        BELT_CZ
      );
      roller.castShadow = true;
      s.add(roller);

      // Roller end caps
      [-1, 1].forEach(capSide => {
        const cap = new THREE.Mesh(
          new THREE.CylinderGeometry(0.04, 0.04, 0.01, 16),
          railMat
        );
        cap.rotation.x = Math.PI / 2;
        cap.position.set(
          BELT_CX + end * (BELT_L / 2 - 0.02),
          BELT_SURFACE_Y + 0.01,
          BELT_CZ + capSide * (BELT_W / 2 + 0.01)
        );
        s.add(cap);
      });
    });

    // Conveyor support legs
    const legMat = new THREE.MeshPhysicalMaterial({
      color: 0x3a3d48, roughness: 0.45, metalness: 0.85,
      envMapIntensity: 1.0
    });
    [[-0.30, -0.12], [-0.30, 0.12], [1.10, -0.12], [1.10, 0.12]].forEach(([x, z]) => {
      const leg = new THREE.Mesh(
        new THREE.BoxGeometry(0.035, BELT_H - 0.04, 0.035),
        legMat
      );
      leg.position.set(x, BELT_SURFACE_Y - (BELT_H - 0.04) / 2, z);
      leg.castShadow = leg.receiveShadow = true;
      s.add(leg);

      // Foot pads
      const foot = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 0.01, 0.05),
        legMat
      );
      foot.position.set(x, -0.755, z);
      foot.receiveShadow = true;
      s.add(foot);
    });

    // ── 5. Conveyor surface grid (replaces old table grid) ──
    const convGrid = new THREE.GridHelper(1.2, 24, 0x303540, 0x252830);
    convGrid.position.set(BELT_CX, BELT_SURFACE_Y + 0.02, BELT_CZ);
    s.add(convGrid);

    // ── 6. Reachability ring (SCARA workspace annulus) ──
    const rMax = L1 + L2;
    const rMin = Math.abs(L1 - L2);
    const reachOuter = new THREE.RingGeometry(rMin, rMax, 64);
    reachOuter.rotateX(-Math.PI / 2);
    const reachMesh = new THREE.Mesh(reachOuter, new THREE.MeshStandardMaterial({
      color: 0x00e5ff, transparent: true, opacity: 0.04,
      side: THREE.DoubleSide, depthWrite: false
    }));
    reachMesh.position.y = 0.002;
    s.add(reachMesh);

    // Reachability ring edges
    const makeCircle = (r, segs = 64) => {
      const pts = [];
      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        pts.push(V3(Math.cos(a) * r, 0.003, Math.sin(a) * r));
      }
      return pts;
    };
    const ringMat = new THREE.LineBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.15 });
    s.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(makeCircle(rMax)), ringMat));
    s.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(makeCircle(rMin)), ringMat));
  }

  /* ════════════════════════════════════════════════════════
     SCARA Robot Geometry
     ════════════════════════════════════════════════════════ */
  _initScaraGeometry() {
    const s = this._scene;
    const grp = new THREE.Group();
    s.add(grp);
    this._robotGroup = grp;

    // ── Base pedestal (fixed) ──
    const baseBottom = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.02, 32), this._mBase);
    baseBottom.position.y = 0.01;
    baseBottom.castShadow = baseBottom.receiveShadow = true;
    grp.add(baseBottom);

    const baseCol = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, BASE_H - 0.02, 24), this._mBase);
    baseCol.position.y = 0.02 + (BASE_H - 0.02) / 2;
    baseCol.castShadow = true;
    grp.add(baseCol);

    // Gold accent at top of base
    const baseAccent = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.012, 24), this._mJoint);
    baseAccent.position.y = BASE_H;
    grp.add(baseAccent);

    // ── Joint 1 motor housing (rotates with q1) ──
    this._j1Motor = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.035, 24), this._mJoint);
    this._j1Motor.castShadow = true;
    grp.add(this._j1Motor);

    // ── Link 1 — shoulder arm ──
    this._link1 = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.025, L1),
      this._mArm
    );
    this._link1.castShadow = true;
    grp.add(this._link1);

    // ── Joint 2 motor housing ──
    this._j2Motor = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.030, 24), this._mJoint);
    this._j2Motor.castShadow = true;
    grp.add(this._j2Motor);

    // ── Link 2 — forearm ──
    this._link2 = new THREE.Mesh(
      new THREE.BoxGeometry(0.042, 0.020, L2),
      this._mArm
    );
    this._link2.castShadow = true;
    grp.add(this._link2);

    // ── Prismatic housing (at elbow tip) ──
    this._prisHousing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 0.04, 20),
      this._mBase
    );
    this._prisHousing.castShadow = true;
    grp.add(this._prisHousing);

    // ── Prismatic shaft (slides along Z / -Y in world) ──
    this._shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, STROKE, 16),
      this._mShaft
    );
    this._shaft.castShadow = true;
    grp.add(this._shaft);

    // ── End-Effector ──
    this._eeMesh = new THREE.Mesh(
      new THREE.ConeGeometry(0.018, 0.03, 12),
      this._mEE
    );
    this._eeMesh.castShadow = true;
    grp.add(this._eeMesh);

    this._linkMeshes = [
      { mesh: this._link1, dhIndex: 0, dhKey: 'a', label: 'Link 1 (Shoulder)', defaultLen: L1, min: 0.10, max: 0.60 },
      { mesh: this._link2, dhIndex: 1, dhKey: 'a', label: 'Link 2 (Elbow)',    defaultLen: L2, min: 0.10, max: 0.60 },
    ];
    this._highlightedLink = -1;

    // Coordinate Frames (Phase 4A)
    this._axesHelpers = [];
    [this._link1, this._link2, this._shaft, this._eeMesh].forEach(parent => {
      const axes = new THREE.AxesHelper(0.12);
      axes.visible = false;
      parent.add(axes);
      this._axesHelpers.push(axes);
    });

    // Manipulability Ellipsoid (Phase 4.2)
    this._ellipsoid = new THREE.Mesh(
      new THREE.SphereGeometry(1, 32, 24),
      new THREE.MeshStandardMaterial({
        color: 0x00ff80, transparent: true, opacity: 0.35,
        depthWrite: false, side: THREE.DoubleSide
      })
    );
    this._ellipsoid.visible = false;
    s.add(this._ellipsoid);

    // ── Vertical drop-line (visual guide) — persistent reusable Line ──
    this._dropLineMat = new THREE.LineDashedMaterial({
      color: 0xC8A200, dashSize: 0.01, gapSize: 0.008, transparent: true, opacity: 0.4
    });
    const dlInitGeo = new THREE.BufferGeometry().setFromPoints([V3(0,0,0), V3(0,0.01,0)]);
    this._dropLine = new THREE.Line(dlInitGeo, this._dropLineMat);
    this._dropLine.computeLineDistances();
    this._scene.add(this._dropLine);

    // ── Beam-line (EE → target) — persistent reusable Line ──
    this._beamLine = null;
  }

  /* ════════════════════════════════════════════════════════
     Target Sphere & Trail
     ════════════════════════════════════════════════════════ */
  _initTargetAndTrail() {
    const s = this._scene;

    // Engineering Target Reticle
    this._targetReticle = new THREE.Group();
    const axis = new THREE.AxesHelper(0.08);
    axis.raycast = () => {}; // Prevent accidental dragging via axes
    this._targetReticle.add(axis);
    const ringG = new THREE.TorusGeometry(0.04, 0.002, 8, 32);
    ringG.rotateX(Math.PI/2);
    const ring = new THREE.Mesh(ringG, this._mTgt);
    this._targetReticle.add(ring);
    this._targetReticle.position.set(0.35, 0.018, 0);
    s.add(this._targetReticle);
    this._mTgtS = this._targetReticle; // Alias for interaction

    // Glow rings removed for engineering clarity


    this._beamLine = null;

    // Dynamic Trail (Line-based)
    const trailG = new THREE.BufferGeometry();
    const trailPosArr = new Float32Array(TRAIL_N * 3);
    trailG.setAttribute('position', new THREE.BufferAttribute(trailPosArr, 3));
    this._trailLine = new THREE.Line(trailG, this._mTrail);
    s.add(this._trailLine);
    this._trailIdx = 0;

    // ── Payload (pick object) ──
    const payloadMat = new THREE.MeshPhysicalMaterial({
      color: 0xff6600, roughness: 0.2, metalness: 0.4,
      clearcoat: 0.8, envMapIntensity: 1.5
    });
    this._payload = new THREE.Mesh(
      new THREE.BoxGeometry(0.025, 0.025, 0.025),
      payloadMat
    );
    this._payload.castShadow = true;
    this._payload.position.set(0.40, 0.013, -0.15); // Three.js coords: x, y(up), z
    s.add(this._payload);
    this._payloadAttached = false;

    // Payload glow ring
    this._payloadGlow = new THREE.Mesh(
      new THREE.RingGeometry(0.02, 0.035, 32),
      new THREE.MeshBasicMaterial({
        color: 0xff6600, transparent: true, opacity: 0.25,
        side: THREE.DoubleSide, depthWrite: false
      })
    );
    this._payloadGlow.rotation.x = -Math.PI / 2;
    this._payloadGlow.position.set(0.40, 0.002, -0.15);
    s.add(this._payloadGlow);

    // ── Drop Zone ──
    const dzRing = new THREE.Mesh(
      new THREE.RingGeometry(0.025, 0.04, 32),
      new THREE.MeshBasicMaterial({
        color: 0x6c5ce7, transparent: true, opacity: 0.3,
        side: THREE.DoubleSide, depthWrite: false
      })
    );
    dzRing.rotation.x = -Math.PI / 2;
    dzRing.position.set(0.30, 0.002, 0.20);
    s.add(dzRing);
    this._dropZoneRing = dzRing;

    // Drop zone inner dot
    const dzDot = new THREE.Mesh(
      new THREE.CircleGeometry(0.008, 20),
      new THREE.MeshBasicMaterial({
        color: 0x6c5ce7, transparent: true, opacity: 0.5,
        side: THREE.DoubleSide, depthWrite: false
      })
    );
    dzDot.rotation.x = -Math.PI / 2;
    dzDot.position.set(0.30, 0.003, 0.20);
    s.add(dzDot);
    this._dropZoneDot = dzDot;

    // Drop zone selectable mesh (clickable target for TransformControls)
    this._dropZoneMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.015, 0.04),
      new THREE.MeshPhysicalMaterial({
        color: 0x6c5ce7, roughness: 0.3, metalness: 0.4,
        clearcoat: 0.6, transparent: true, opacity: 0.55,
        envMapIntensity: 1.5
      })
    );
    this._dropZoneMesh.position.set(0.30, 0.013, 0.20);
    this._dropZoneMesh.castShadow = true;
    s.add(this._dropZoneMesh);
    this._dropZoneMesh.userData.draggable = true;
    this._dropZoneMesh.userData.role = 'dropZone';
  }

  /* ════════════════════════════════════════════════════════
     Payload Attach / Detach (for Pick & Place)
     ════════════════════════════════════════════════════════ */

  /** Reparent payload to EE — it will follow the end-effector */
  attachPayloadToEE() {
    if (this._payloadAttached) return;
    this._payloadAttached = true;
    // Hide glow ring while attached
    this._payloadGlow.visible = false;
  }

  /** Reparent payload back to world at its current EE position */
  detachPayloadToWorld() {
    if (!this._payloadAttached) return;
    this._payloadAttached = false;
    // Keep payload at current EE position (already set in updateScene)
    this._payloadGlow.position.set(
      this._payload.position.x, 0.002, this._payload.position.z
    );
    this._payloadGlow.visible = true;
  }

  /** Move payload to a specific world position (used for cycle reset) */
  setPayloadPosition(x, y, z) {
    this._payload.position.set(x, y, z);
    this._payloadGlow.position.set(x, 0.002, z);
  }

  /** Move drop zone visual marker (Three.js coords: x, z) */
  setDropZonePosition(x, z) {
    this._dropZoneRing.position.set(x, 0.002, z);
    this._dropZoneDot.position.set(x, 0.003, z);
    if (this._dropZoneMesh) this._dropZoneMesh.position.set(x, 0.013, z);
  }

  /* ════════════════════════════════════════════════════════
     updateScene — positions all meshes from FK transforms

     COORDINATE MAPPING (critical):
       DH convention:    X,Y = horizontal plane, Z = vertical (up)
       Three.js:         X,Z = horizontal plane, Y = vertical (up)

       Three.x =  DH.x  (T[12])
       Three.y =  DH.z  (T[14])   ← vertical axis swap
       Three.z = -DH.y  (-T[13])  ← preserves right-handedness
     ════════════════════════════════════════════════════════ */

  /**
   * Update all 3D meshes for a given SCARA joint configuration.
   *
   * @param {number[]} q      — [q1, q2, q3, q4] joint variables
   * @param {THREE.Vector3|null} pTgt3 — target point (or null)
   * @returns {{ position: number[], jointTransforms: Float64Array[] }}
   */
  updateScene(q, pTgt3) {
    const result = fk(q, SCARA_DH_CONFIG);
    const { jointTransforms: JT } = result;

    // DH → Three.js coordinate transform
    const dh2three = (T) => V3(T[12], T[14], -T[13]);

    // FK joint origins in Three.js coordinates
    const P0 = dh2three(JT[0]); // base origin  → (0, 0, 0)
    const P1 = dh2three(JT[1]); // end of link 1 → (0.30, 0.35, 0) at home
    const P2 = dh2three(JT[2]); // end of link 2 → (0.55, 0.35, 0) at home
    const P3 = dh2three(JT[3]); // after prismatic → drops in Y with q[2]
    const P4 = dh2three(JT[4]); // end-effector

    // Arm height (all horizontal links sit at Y = BASE_H = DH d1)
    const armY = P1.y; // should equal BASE_H at home

    // ── Joint 1 motor — at top of base column ──
    this._j1Motor.position.set(0, armY + 0.017, 0);

    // ── Link 1 — horizontal arm from base top to P1 ──
    const l1Start = V3(0, armY + 0.012, 0);
    const l1End   = V3(P1.x, armY + 0.012, P1.z);
    this._link1.position.copy(l1Start.clone().lerp(l1End, 0.5));
    this._link1.rotation.set(0, Math.atan2(l1End.x - l1Start.x, l1End.z - l1Start.z), 0);

    // ── Joint 2 motor — at P1 ──
    this._j2Motor.position.set(P1.x, armY + 0.015, P1.z);

    // ── Link 2 — horizontal forearm from P1 to P2 ──
    const l2Start = V3(P1.x, armY + 0.010, P1.z);
    const l2End   = V3(P2.x, armY + 0.010, P2.z);
    this._link2.position.copy(l2Start.clone().lerp(l2End, 0.5));
    this._link2.rotation.set(0, Math.atan2(l2End.x - l2Start.x, l2End.z - l2Start.z), 0);

    // ── Prismatic housing — at P2, sits below arm plane ──
    this._prisHousing.position.set(P2.x, armY - 0.01, P2.z);

    // ── Prismatic shaft — extends downward from housing ──
    // P3.y < P2.y when q[2] > 0 (prismatic displaces downward)
    const shaftTopY   = armY - 0.03;
    const shaftExtent = Math.max(shaftTopY - P3.y, 0.02); // visual minimum
    this._shaft.scale.y = shaftExtent / STROKE;
    this._shaft.position.set(P2.x, shaftTopY - shaftExtent / 2, P2.z);

    // ── End-Effector — at P3 (prismatic output) ──
    const eeY = shaftTopY - shaftExtent;
    this._eeMesh.position.set(P2.x, eeY - 0.015, P2.z);
    this._eeMesh.rotation.set(Math.PI, q[3], 0); // cone points down, rotated by q4

    // ── Vertical drop-line (reuse persistent Line, swap geometry only) ──
    const oldDlGeo = this._dropLine.geometry;
    const newDlGeo = new THREE.BufferGeometry().setFromPoints([
      V3(P2.x, shaftTopY, P2.z),
      V3(P2.x, eeY - 0.015, P2.z)
    ]);
    this._dropLine.geometry = newDlGeo;
    this._dropLine.computeLineDistances();
    oldDlGeo.dispose();

    // ── Target reticle + beam ──
    if (pTgt3) {
      this._targetReticle.visible = true;
      this._targetReticle.position.copy(pTgt3);
      if (this._beamLine) {
        this._scene.remove(this._beamLine);
        this._beamLine.geometry.dispose();
      }
      const eeV3 = V3(P2.x, eeY - 0.015, P2.z);
      const bg = new THREE.BufferGeometry().setFromPoints([eeV3, pTgt3.clone()]);
      this._beamLine = new THREE.Line(bg, this._mBeam);
      this._beamLine.computeLineDistances();
      this._scene.add(this._beamLine);
    } else {
      this._targetReticle.visible = false;
      if (this._beamLine) {
        this._scene.remove(this._beamLine);
        this._beamLine.geometry.dispose();
        this._beamLine = null;
      }
    }

    // Store computed EE world position for external use
    this._eeWorldPos = V3(P2.x, eeY - 0.015, P2.z);

    // ── Move payload with EE if attached ──
    if (this._payloadAttached) {
      this._payload.position.set(P2.x, eeY - 0.032, P2.z);
    }

    return result;
  }

  /* ════════════════════════════════════════════════════════
     Trail
     ════════════════════════════════════════════════════════ */
  addTrailPoint(pos3) {
    if (!this._trailLine) return;
    const posAttr = this._trailLine.geometry.attributes.position;
    const arr = posAttr.array;

    // Shift back
    for (let i = TRAIL_N - 1; i > 0; i--) {
      arr[i * 3]     = arr[(i - 1) * 3];
      arr[i * 3 + 1] = arr[(i - 1) * 3 + 1];
      arr[i * 3 + 2] = arr[(i - 1) * 3 + 2];
    }
    arr[0] = pos3.x; arr[1] = pos3.y; arr[2] = pos3.z;
    posAttr.needsUpdate = true;
    this._trailIdx++;
  }

  resetTrail() {
    if (!this._trailLine) return;
    const arr = this._trailLine.geometry.attributes.position.array;
    arr.fill(0);
    this._trailLine.geometry.attributes.position.needsUpdate = true;
    this._trailIdx = 0;
  }

  /* ════════════════════════════════════════════════════════
     Perception Camera — simulated pinhole camera + frustum
     ════════════════════════════════════════════════════════ */
  _initPerceptionCamera() {
    // Secondary camera for perception simulation
    // near=0.01 (not 0.05) so the table surface at y≈0 is visible from y=1.20
    this._percCamera = new THREE.PerspectiveCamera(60, 320 / 240, 0.01, 5.0);
    this._percCamera.position.set(0.30, 1.20, 0.00);
    this._percCamera.rotation.set(-Math.PI / 2, 0, 0); // Looking down
    this._scene.add(this._percCamera);

    // Camera helper draws the FOV frustum wireframe
    this._percHelper = new THREE.CameraHelper(this._percCamera);
    this._scene.add(this._percHelper);

    // Camera body mesh (small box to represent the physical camera)
    const camBodyMat = new THREE.MeshPhysicalMaterial({
      color: 0x2a2d38, roughness: 0.3, metalness: 0.85,
      clearcoat: 0.5, envMapIntensity: 1.4
    });
    this._camBodyMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.03, 0.05),
      camBodyMat
    );
    this._camBodyMesh.castShadow = true;
    this._scene.add(this._camBodyMesh);

    // Camera lens (cylinder)
    const lensMat = new THREE.MeshPhysicalMaterial({
      color: 0x111122, roughness: 0.05, metalness: 0.4,
      clearcoat: 1.0, envMapIntensity: 2.0
    });
    this._camLensMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.014, 0.02, 16),
      lensMat
    );
    this._scene.add(this._camLensMesh);

    // LED indicator light
    this._camLED = new THREE.Mesh(
      new THREE.SphereGeometry(0.004, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0x00ff44 })
    );
    this._scene.add(this._camLED);

    // Start hidden — activated by CameraPanel
    this._percActive = false;
    this._percHelper.visible = false;
    this._camBodyMesh.visible = false;
    this._camLensMesh.visible = false;
    this._camLED.visible = false;

    // Off-screen render target — avoids resizing the main canvas (FIX 1)
    this._percRT = new THREE.WebGLRenderTarget(320, 240, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
    });
  }

  /**
   * Update the perception camera's position, rotation, and FOV.
   * @param {number} tx  - Position X (Three.js coords)
   * @param {number} ty  - Position Y (Three.js coords, up)
   * @param {number} tz  - Position Z (Three.js coords)
   * @param {number} rx  - Rotation X (rad)
   * @param {number} ry  - Rotation Y (rad)
   * @param {number} rz  - Rotation Z (rad)
   * @param {number} fov - Vertical FOV (degrees)
   */
  updatePerceptionCamera(tx, ty, tz, rx, ry, rz, fov) {
    this._percCamera.position.set(tx, ty, tz);
    this._percCamera.rotation.set(rx, ry, rz, 'XYZ');
    this._percCamera.fov = fov;
    this._percCamera.updateProjectionMatrix();
    this._percHelper.update();

    // Move camera body mesh to match
    this._camBodyMesh.position.set(tx, ty, tz);
    this._camBodyMesh.rotation.set(rx, ry, rz, 'XYZ');

    // Lens points downward from camera body
    const lensOffset = new THREE.Vector3(0, -0.025, 0);
    lensOffset.applyEuler(new THREE.Euler(rx, ry, rz, 'XYZ'));
    this._camLensMesh.position.set(tx + lensOffset.x, ty + lensOffset.y, tz + lensOffset.z);
    this._camLensMesh.rotation.set(rx, ry, rz, 'XYZ');

    // LED on top-right
    const ledOffset = new THREE.Vector3(0.015, 0.016, -0.02);
    ledOffset.applyEuler(new THREE.Euler(rx, ry, rz, 'XYZ'));
    this._camLED.position.set(tx + ledOffset.x, ty + ledOffset.y, tz + ledOffset.z);
  }

  /**
   * Render the perception camera view to an external canvas.
   * Uses a WebGLRenderTarget so the main viewport is never disturbed.
   * @param {HTMLCanvasElement} targetCanvas
   */
  renderPerceptionView(targetCanvas) {
    if (!targetCanvas || !this._percCamera || !this._percRT) return;

    // Temporarily hide camera body visuals from perception view
    const wasHelperVisible    = this._percHelper.visible;
    const wasBodyVisible      = this._camBodyMesh.visible;
    const wasLensVisible      = this._camLensMesh.visible;
    const wasLEDVisible       = this._camLED.visible;
    this._percHelper.visible    = false;
    this._camBodyMesh.visible   = false;
    this._camLensMesh.visible   = false;
    this._camLED.visible        = false;

    // Render into offscreen render target (no main canvas resize)
    this._renderer.setRenderTarget(this._percRT);
    this._renderer.render(this._scene, this._percCamera);
    this._renderer.setRenderTarget(null);

    // Restore visibility before restoring render target
    this._percHelper.visible    = wasHelperVisible;
    this._camBodyMesh.visible   = wasBodyVisible;
    this._camLensMesh.visible   = wasLensVisible;
    this._camLED.visible        = wasLEDVisible;

    // Read pixels from render target and draw onto the target canvas
    const w = this._percRT.width;
    const h = this._percRT.height;
    const buffer = new Uint8Array(w * h * 4);
    this._renderer.readRenderTargetPixels(this._percRT, 0, 0, w, h, buffer);

    // WebGL renders bottom-up; flip vertically when drawing to 2D canvas
    const ctx = targetCanvas.getContext('2d');
    const imgData = ctx.createImageData(w, h);
    for (let row = 0; row < h; row++) {
      const src = (h - 1 - row) * w * 4;
      const dst = row * w * 4;
      imgData.data.set(buffer.subarray(src, src + w * 4), dst);
    }
    ctx.putImageData(imgData, 0, 0);
  }

  /** Toggle perception camera visibility */
  setPerceptionActive(active) {
    this._percActive = active;
    this._percHelper.visible = active;
    this._camBodyMesh.visible = active;
    this._camLensMesh.visible = active;
    this._camLED.visible = active;
  }

  /* ════════════════════════════════════════════════════════
     Render Loop
     ════════════════════════════════════════════════════════ */
  start() {
    const loop = () => {
      requestAnimationFrame(loop);
      this._controls.update();
      this._renderer.render(this._scene, this._camera);

    };
    loop();
  }

  /* ════════════════════════════════════════════════════════
     Link Resizing — dynamic DH parameter + mesh updates
     ════════════════════════════════════════════════════════ */

  /**
   * Dynamically resize a SCARA link.
   * Updates the DH config 'a' (or 'd') parameter and rebuilds the mesh geometry.
   * @param {number} index  - Index into _linkMeshes (0=upper arm, 1=forearm)
   * @param {number} newLen - New length in meters
   */
  resizeLink(index, newLen) {
    const entry = this._linkMeshes[index];
    if (!entry) return;
    // Update the mutable DH config
    SCARA_DH_CONFIG[entry.dhIndex][entry.dhKey] = newLen;
    // Rebuild the box geometry (SCARA arms are BoxGeometry with length along Z)
    const oldGeo = entry.mesh.geometry;
    const params = oldGeo.parameters;
    entry.mesh.geometry.dispose();
    entry.mesh.geometry = new THREE.BoxGeometry(params.width, params.height, newLen);
  }

  /**
   * Highlight a link with emissive glow.
   * @param {number} index - Link index to highlight
   */
  highlightLink(index) {
    this.clearHighlight();
    if (index < 0 || index >= this._linkMeshes.length) return;
    const mat = this._linkMeshes[index].mesh.material;
    this._savedEmissive = mat.emissive.getHex();
    this._savedEmissiveIntensity = mat.emissiveIntensity;
    mat.emissive.setHex(0x00e5ff);
    mat.emissiveIntensity = 0.6;
    this._highlightedLink = index;
  }

  /** Clear link highlight */
  clearHighlight() {
    if (this._highlightedLink >= 0 && this._highlightedLink < this._linkMeshes.length) {
      const mat = this._linkMeshes[this._highlightedLink].mesh.material;
      mat.emissive.setHex(this._savedEmissive || 0x000000);
      mat.emissiveIntensity = this._savedEmissiveIntensity || 0;
    }
    this._highlightedLink = -1;
  }

  /* ════════════════════════════════════════════════════════
     Workspace overlay (RoboAnalyzer reachability)
     ════════════════════════════════════════════════════════ */

  _ensureWorkspaceGroup() {
    if (this._wsGroup) return;
    this._wsGroup = new THREE.Group();
    this._wsGroup.name = 'workspaceOverlay';
    this._scene.add(this._wsGroup);
  }

  /**
   * Plot workspace sample cells in the 3D scene (DH → Three mapping).
   * @param {Array<{x,y,z,status,mu}>} cells
   * @param {boolean} visible
   */
  setWorkspaceOverlay(cells, visible = true) {
    this._ensureWorkspaceGroup();
    this.clearWorkspaceOverlay();

    if (!visible || !cells?.length) {
      this._wsGroup.visible = false;
      return;
    }

    const show = cells.filter((c) => c.status !== 'unreachable');
    if (!show.length) {
      this._wsGroup.visible = false;
      return;
    }

    const geo = new THREE.SphereGeometry(0.007, 6, 4);
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, show.length);
    const color = new THREE.Color();
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();

    show.forEach((cell, i) => {
      const p = dhPositionToThree(cell.x, cell.y, cell.z);
      pos.set(p.x, p.y, p.z);
      m.makeTranslation(pos.x, pos.y, pos.z);
      mesh.setMatrixAt(i, m);
      if (cell.status === 'reachable') {
        const t = Math.min(1, (cell.mu || 0) * 35);
        color.setHSL(0.38 + t * 0.12, 0.85, 0.42 + t * 0.2);
      } else {
        color.setRGB(1, 0.4, 0.15);
      }
      mesh.setColorAt(i, color);
    });

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this._wsGroup.add(mesh);
    this._wsGroup.visible = true;
  }

  clearWorkspaceOverlay() {
    if (!this._wsGroup) return;
    while (this._wsGroup.children.length) {
      const child = this._wsGroup.children[0];
      child.geometry?.dispose();
      child.material?.dispose();
      this._wsGroup.remove(child);
    }
  }

  /* ════════════════════════════════════════════════════════
     Getters
     ════════════════════════════════════════════════════════ */
  get camera()       { return this._camera; }
  get scene()        { return this._scene; }
  get renderer()     { return this._renderer; }
  get controls()     { return this._controls; }
  get targetSphere() { return this._mTgtS; }
  get dragPlane()    { return this._dragPlane; }
  get TRAIL_N()      { return TRAIL_N; }
  get eeWorldPos()   { return this._eeWorldPos; }
  get payload()      { return this._payload; }
  get payloadAttached() { return this._payloadAttached; }
  get dropZoneMesh() { return this._dropZoneMesh; }
  get transformControls() { return this._transformControls; }
  get percCamera()   { return this._percCamera; }

  /** Clickable link mesh entries (array of metadata) */
  get linkMeshes() { return this._linkMeshes; }

  /** Just the Three.js mesh objects for raycasting */
  get linkMeshArray() { return this._linkMeshes.map(e => e.mesh); }

  /** Register callback for object drag sync: (mesh) => void */
  set onObjectDragged(fn) { this._onObjectDragged = fn; }

  /** Toggle wireframe on all robot meshes */
  setWireframe(active) {
    this._scene.traverse(o => {
      if (o.isMesh && (o.material.color || o.material.emissive)) {
        // Expose grid and floor from wireframe
        if (o.name === "majorGrid" || o.type === "GridHelper") return;
        o.material.wireframe = active;
      }
    });
  }

  /** Toggle coordinate frames visibility */
  setAxesVisible(active) {
    this._axesHelpers.forEach(ax => ax.visible = active);
  }

  /**
   * Update the Manipulability Ellipsoid at the End Effector.
   */
  updateEllipsoid(visible, singularValues, rotation, mu, pos) {
    if (!this._ellipsoid) return;
    this._ellipsoid.visible = visible;
    if (!visible) return;

    this._ellipsoid.position.copy(pos);
    const s = singularValues.map(v => Math.max(v * 0.25, 0.001));
    this._ellipsoid.scale.set(s[0], s[1], s[2]);
    if (rotation) this._ellipsoid.setRotationFromMatrix(rotation);
    
    // Green (High Mu) -> Red (Singular)
    const normMu = Math.min(mu * 50.0, 1.0);
    this._ellipsoid.material.color.setHSL(0.35 * normMu, 1.0, 0.5);
  }
}
