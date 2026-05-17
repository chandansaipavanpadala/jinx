/**
 * SceneManager.js — Three.js 3D Scene Controller for the RRR Lamp
 *
 * Encapsulates ALL rendering concerns:
 *   Scene, Camera, Renderer, OrbitControls, POV camera,
 *   Lighting, Materials, Environment meshes, Robot meshes,
 *   Target/glow/trail visuals, and the animation loop.
 *
 * Zero DOM manipulation (no getElementById text updates).
 * The UI Controller (Part 4) reads getters and calls methods.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { fkMat, V3, L1, L2, L3, RAD, linkLengths, clamp } from '../math/Kinematics.js';

const TRAIL_N = 60;

export default class SceneManager {
  /* ════════════════════════════════════════════════════════
     Constructor
     ════════════════════════════════════════════════════════ */
  constructor(canvasContainerId = 'cw', povContainerId = 'camPov') {
    const wrap = document.getElementById(canvasContainerId);
    const povWrap = document.getElementById(povContainerId);

    /* ── Scene ── */
    this._scene = new THREE.Scene();
    this._scene.background = new THREE.Color(0x17181c);
    this._scene.fog = new THREE.Fog(0x17181c, 2.5, 6.0);

    /* ── Main Camera ── */
    this._camera = new THREE.PerspectiveCamera(
      44, wrap.clientWidth / wrap.clientHeight, 0.01, 10
    );
    this._camera.position.set(1.0, 0.95, 1.0);

    /* ── Renderer ── */
    this._renderer = new THREE.WebGLRenderer({ antialias: true });
    this._renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this._renderer.shadowMap.enabled = true;
    this._renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this._renderer.setSize(wrap.clientWidth, wrap.clientHeight);
    this._renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this._renderer.toneMappingExposure = 1.3;
    wrap.insertBefore(this._renderer.domElement, wrap.firstChild);

    /* ── Environment map (studio look) ── */
    const pmrem = new THREE.PMREMGenerator(this._renderer);
    pmrem.compileEquirectangularShader();
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(
      new THREE.BoxGeometry(100, 100, 100),
      new THREE.MeshBasicMaterial({ color: 0x050510, side: THREE.BackSide })
    ));
    const envLight = new THREE.RectAreaLight(0xffffff, 5, 10, 10);
    envLight.position.set(5, 10, 5);
    envLight.lookAt(0, 0, 0);
    envScene.add(envLight);
    this._scene.environment = pmrem.fromScene(envScene).texture;

    /* ── OrbitControls ── */
    this._controls = new OrbitControls(this._camera, this._renderer.domElement);
    this._controls.target.set(0.25, 0.38, 0);
    this._controls.enableDamping = true;
    this._controls.dampingFactor = 0.07;
    this._controls.minDistance = 0.2;
    this._controls.maxDistance = 4;
    this._camera.lookAt(this._controls.target);

    /* ── POV Camera ── */
    this._povRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this._povRenderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this._povRenderer.shadowMap.enabled = true;
    this._povRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    this._povRenderer.toneMappingExposure = 1.1;
    this._povRenderer.setSize(200, 150);
    povWrap.appendChild(this._povRenderer.domElement);

    this._povCamera = new THREE.PerspectiveCamera(55, 200 / 150, 0.01, 10);
    this._povCamera.position.set(0.0, 0.50, 0.30);
    this._povCamera.lookAt(0.35, 0.0, 0.0);

    /* ── Lighting ── */
    this._initLighting();

    /* ── Materials ── */
    this._initMaterials();

    /* ── Environment meshes (floor, table, reachability) ── */
    this._initEnvironment();

    /* ── Robot lamp meshes ── */
    this._initLampGeometry();

    /* ── Target, glow rings, beam, trail ── */
    this._initTargetAndTrail();

    /* ── Shadow-avoidance demo (hand + workspace patch) ── */
    this._initShadowDemo();

    /* ── Drag plane for raycaster (table surface y=0.025) ── */
    this._dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.025);

    /* ── Resize handler ── */
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
     Lighting
     ════════════════════════════════════════════════════════ */
  _initLighting() {
    const s = this._scene;
    
    // Main directional light (studio lighting)
    this._dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
    this._dirLight.position.set(2, 4, 2);
    this._dirLight.castShadow = true;
    this._dirLight.shadow.mapSize.set(2048, 2048);
    this._dirLight.shadow.bias = -0.0004;
    this._dirLight.shadow.camera.near = 0.1;
    this._dirLight.shadow.camera.far = 10;
    this._dirLight.shadow.camera.top = this._dirLight.shadow.camera.right = 2;
    this._dirLight.shadow.camera.bottom = this._dirLight.shadow.camera.left = -2;
    s.add(this._dirLight);

    this._ambient = new THREE.AmbientLight(0x9090a0, 0.4);
    s.add(this._ambient);

    this._hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.3);
    s.add(this._hemi);

    // Retain lamp head spot (it's a shadow lamp simulator after all)
    this._spot = new THREE.SpotLight(0xFFFFFF, 2.0);
    this._spot.angle = 0.40;
    this._spot.penumbra = 0.40;
    this._spot.decay = 1.4;
    this._spot.distance = 2.0;
    this._spot.castShadow = true;
    this._spot.shadow.mapSize.set(1024, 1024);
    this._spot.shadow.bias = -0.001;
    s.add(this._spot);
    this._spotTgt = new THREE.Object3D();
    s.add(this._spotTgt);
    this._spot.target = this._spotTgt;

    // Small point light near head to illuminate shade interior
    this._lPt = new THREE.PointLight(0xFFFFFF, 0.5, 1.2);
    s.add(this._lPt);
  }

  /* ════════════════════════════════════════════════════════
     Materials
     ════════════════════════════════════════════════════════ */
  _initMaterials() {
    // Professional Engineering Gray for main body
    this._mBody = new THREE.MeshStandardMaterial({
      color: 0x4a4a4e,      // neutral industrial gray
      roughness: 0.8,
      metalness: 0.2,
    });
    // Darker tone for joints to provide contrast
    this._mJoint = new THREE.MeshStandardMaterial({
      color: 0x2d2d30,
      roughness: 0.7,
      metalness: 0.3,
    });
    this._mShIn = new THREE.MeshStandardMaterial({
      color: 0xE0E0E0, roughness: 0.6, emissive: 0x111111,
      emissiveIntensity: 0.1, side: THREE.BackSide
    });
    // High-visibility selection material (Engineering blue)
    this._mHighlightMat = new THREE.MeshStandardMaterial({
      color: 0x3a96dd, roughness: 0.6, emissive: 0x3a96dd,
      emissiveIntensity: 0.1
    });
    this._mCone = new THREE.MeshBasicMaterial({
      color: 0xFFF870, transparent: true, opacity: 0.03,
      side: THREE.DoubleSide, depthWrite: false
    });
    this._mBeam = new THREE.LineDashedMaterial({
      color: 0xE8C020, dashSize: 0.02, gapSize: 0.01
    });
    this._mTgt = new THREE.MeshStandardMaterial({
      color: 0x3a96dd, roughness: 0.3, metalness: 0.8
    });
    this._mTrail = new THREE.LineBasicMaterial({
      color: 0x3a96dd, transparent: true, opacity: 0.8, depthWrite: false
    });
  }

  /* ════════════════════════════════════════════════════════
     Environment (Floor, Table, Reachability)
     ════════════════════════════════════════════════════════ */
  _initEnvironment() {
    const s = this._scene;

    // Matte Floor
    const floorG = new THREE.PlaneGeometry(10, 10);
    floorG.rotateX(-Math.PI / 2);
    const floor = new THREE.Mesh(floorG, new THREE.MeshStandardMaterial({
      color: 0x181818, roughness: 1.0
    }));
    floor.position.y = -0.76;
    floor.receiveShadow = true;
    s.add(floor);

    // Custom Engineering Grid (Minor and Major lines)
    const minorGrid = new THREE.GridHelper(10, 100, 0x222222, 0x1a1a1c);
    minorGrid.position.y = -0.756;
    minorGrid.material.transparent = true;
    minorGrid.material.opacity = 0.18;
    s.add(minorGrid);
    
    const majorGrid = new THREE.GridHelper(10, 20, 0x444444, 0x333333);
    majorGrid.position.y = -0.755;
    majorGrid.material.transparent = true;
    majorGrid.material.opacity = 0.18;
    majorGrid.name = "majorGrid";
    s.add(majorGrid);

    // World Origin Axes (0.3m scale)
    const axesHelper = new THREE.AxesHelper(0.3);
    s.add(axesHelper);

    // Table top
    const tblTopMat = new THREE.MeshStandardMaterial({
      color: 0x5A3418, roughness: 0.68, metalness: 0.05
    });
    const tblTop = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.04, 0.75), tblTopMat);
    tblTop.position.set(0.35, -0.02, 0);
    tblTop.castShadow = true;
    tblTop.receiveShadow = true;
    s.add(tblTop);

    // Gold trim strip
    const trimM = new THREE.MeshStandardMaterial({
      color: 0xA07820, roughness: 0.25, metalness: 0.60
    });
    const trimMesh = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.005, 0.005), trimM);
    trimMesh.position.set(0.35, -0.0025, 0.375);
    s.add(trimMesh);

    // Table legs
    const legMat = new THREE.MeshStandardMaterial({
      color: 0x381E0C, roughness: 0.80, metalness: 0.04
    });
    [[-0.14, 0.32], [-0.14, -0.32], [0.84, 0.32], [0.84, -0.32]].forEach(([x, z]) => {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.72, 0.05), legMat);
      leg.position.set(x, -0.40, z);
      leg.castShadow = leg.receiveShadow = true;
      s.add(leg);
    });

    // Table surface grid
    const tGrid = new THREE.GridHelper(1.0, 20, 0x7A5030, 0x5A3818);
    tGrid.position.set(0.35, 0.001, 0);
    s.add(tGrid);

    // Table boundary line
    const tBoundMat = new THREE.LineBasicMaterial({
      color: 0xFF6020, transparent: true, opacity: 0.5
    });
    const tBoundGeo = new THREE.BufferGeometry().setFromPoints([
      V3(-0.15, 0.003, -0.30), V3(0.85, 0.003, -0.30),
      V3(0.85, 0.003, 0.30), V3(-0.15, 0.003, 0.30),
      V3(-0.15, 0.003, -0.30)
    ]);
    s.add(new THREE.Line(tBoundGeo, tBoundMat));

    // Reachability dome
    const reachG = new THREE.SphereGeometry(
      L2 + L3, 64, 32, 0, Math.PI * 2, 0, Math.PI / 2
    );
    const reachM = new THREE.MeshStandardMaterial({
      color: 0x00e5ff, transparent: true, opacity: 0.03,
      side: THREE.BackSide, depthWrite: false
    });
    const reachDome = new THREE.Mesh(reachG, reachM);
    reachDome.position.y = L1;
    s.add(reachDome);
    reachDome.add(new THREE.LineSegments(
      new THREE.EdgesGeometry(reachG),
      new THREE.LineBasicMaterial({
        color: 0x00e5ff, transparent: true, opacity: 0.1
      })
    ));
  }

  /* ════════════════════════════════════════════════════════
     Robot Lamp Geometry
     ════════════════════════════════════════════════════════ */
  _initLampGeometry() {
    const lamp = new THREE.Group();
    this._scene.add(lamp);
    this._lamp = lamp;

    const mb = this._mBody, mj = this._mJoint;

    // Base
    const mBase = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.093, 0.012, 32), mb);
    mBase.position.y = 0.006;
    mBase.castShadow = mBase.receiveShadow = true;
    lamp.add(mBase);

    // Gold accent ring
    const mAccent = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.007, 32), mj);
    mAccent.position.set(0, 0.013, 0);
    lamp.add(mAccent);

    // Column (Link 1 — base height d₁)
    this._mCol = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, L1, 16), mb);
    this._mCol.position.y = L1 / 2;
    this._mCol.castShadow = true;
    lamp.add(this._mCol);

    // Shoulder joint motor
    this._mSh = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.040, 24), mj);
    this._mSh.castShadow = true;
    lamp.add(this._mSh);

    // Lower arm (Link 2 — a₂)
    this._mLow = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, L2, 16), mb);
    this._mLow.castShadow = true;
    lamp.add(this._mLow);

    // Elbow motor
    this._mEl = new THREE.Mesh(new THREE.CylinderGeometry(0.030, 0.030, 0.035, 24), mj);
    this._mEl.castShadow = true;
    lamp.add(this._mEl);

    // Upper arm (Link 3 — a₃)
    this._mUp = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, L3, 16), mb);
    this._mUp.castShadow = true;
    lamp.add(this._mUp);

    // Wrist motor
    this._mWrist = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.032, 24), mj);
    this._mWrist.castShadow = true;
    lamp.add(this._mWrist);

    // Offset Brackets
    this._mBrak1 = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.06, 16), mj);
    this._mBrak1.castShadow = true;
    lamp.add(this._mBrak1);

    this._mBrak2 = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.06, 16), mj);
    this._mBrak2.castShadow = true;
    lamp.add(this._mBrak2);

    // Shade outer + inner
    this._mSO = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.048, 0.062, 24), this._mShOut);
    this._mSO.castShadow = true;
    lamp.add(this._mSO);
    this._mSI = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.048, 0.062, 24), this._mShIn);
    lamp.add(this._mSI);

    // Bulb
    this._mBulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.010, 12, 12),
      new THREE.MeshStandardMaterial({
        color: 0xFFFAD0, emissive: 0xFFF8A0,
        emissiveIntensity: 2.0, roughness: 0.1
      })
    );
    lamp.add(this._mBulb);

    // Light cone (unit, scaled per frame)
    this._mLC = new THREE.Mesh(
      new THREE.ConeGeometry(1, 1, 32, 1, true), this._mCone
    );
    this._mLC.renderOrder = 1;
    lamp.add(this._mLC);

    // Standardized metadata for UI interaction
    this.linkMeshes = [
      { mesh: this._mCol, key: 'L1', label: 'Link 1 (Column)', radius: [0.022, 0.026], defaultLen: L1, min: 0.05, max: 0.40 },
      { mesh: this._mLow, key: 'L2', label: 'Link 2 (Lower Arm)', radius: [0.022, 0.022], defaultLen: L2, min: 0.10, max: 0.60 },
      { mesh: this._mUp,  key: 'L3', label: 'Link 3 (Upper Arm)', radius: [0.018, 0.018], defaultLen: L3, min: 0.08, max: 0.50 },
    ];
    this.linkMeshArray = this.linkMeshes.map(l => l.mesh);

    // Coordinate Frames (Init invisible)
    this._axesHelpers = [];
    [this._mSh, this._mEl, this._mWrist].forEach(parent => {
      const axes = new THREE.AxesHelper(0.12);
      axes.visible = false;
      parent.add(axes);
      this._axesHelpers.push(axes);
    });
  }

  /* ════════════════════════════════════════════════════════
     Target sphere, glow rings, beam line, trail dots
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
    this._target = this._targetReticle;

    // Glow ring (Interactive hover indicator)
    const gRingG = new THREE.RingGeometry(0.05, 0.06, 32);
    gRingG.rotateX(-Math.PI / 2);
    this._glow = new THREE.Mesh(gRingG, new THREE.MeshBasicMaterial({
      color: 0x3a96dd, transparent: true, opacity: 0.3, side: THREE.DoubleSide
    }));
    this._glow.visible = false;
    s.add(this._glow);

    // Beam Line
    const beamG = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0)]);
    this._beamLine = new THREE.LineSegments(beamG, this._mBeam);
    s.add(this._beamLine);

    // Dynamic Trail (Line-based)
    const trailG = new THREE.BufferGeometry();
    const trailPosArr = new Float32Array(TRAIL_N * 3);
    trailG.setAttribute('position', new THREE.BufferAttribute(trailPosArr, 3));
    this._trailLine = new THREE.Line(trailG, this._mTrail);
    s.add(this._trailLine);

    // Manipulability Ellipsoid
    this._ellipsoid = new THREE.Mesh(
      new THREE.SphereGeometry(1, 32, 24),
      new THREE.MeshStandardMaterial({
        color: 0x00ff80, transparent: true, opacity: 0.35,
        depthWrite: false, side: THREE.DoubleSide
      })
    );
    this._ellipsoid.visible = false;
    s.add(this._ellipsoid);

    this._trailIdx = 0;
  }

  /* ════════════════════════════════════════════════════════
     Shadow-avoidance demo meshes
     ════════════════════════════════════════════════════════ */
  _initShadowDemo() {
    const s = this._scene;
    const zTable = 0.025;

    this._workspaceCenter = new THREE.Vector3(0.35, zTable, 0);
    this._handRadius = 0.048;

    const wsMat = new THREE.MeshStandardMaterial({
      color: 0x1e5c32,
      emissive: 0x0d3020,
      emissiveIntensity: 0.35,
      roughness: 0.85,
      metalness: 0.05,
    });
    this._workspacePatch = new THREE.Mesh(
      new THREE.PlaneGeometry(0.24, 0.17),
      wsMat
    );
    this._workspacePatch.rotation.x = -Math.PI / 2;
    this._workspacePatch.position.copy(this._workspaceCenter).add(V3(0, 0.001, 0));
    this._workspacePatch.receiveShadow = true;
    this._workspacePatch.visible = false;
    s.add(this._workspacePatch);

    const wsBorder = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(0.24, 0.17)),
      new THREE.LineBasicMaterial({ color: 0x40e080, transparent: true, opacity: 0.85 })
    );
    wsBorder.rotation.x = -Math.PI / 2;
    wsBorder.position.copy(this._workspacePatch.position);
    wsBorder.visible = false;
    s.add(wsBorder);
    this._workspaceBorder = wsBorder;

    const handMat = new THREE.MeshStandardMaterial({
      color: 0xc4866a,
      roughness: 0.65,
      metalness: 0.08,
    });
    this._handMesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.032, 0.08, 6, 12),
      handMat
    );
    this._handMesh.castShadow = true;
    this._handMesh.receiveShadow = true;
    this._handMesh.visible = false;
    s.add(this._handMesh);

    this._handRobotX = 0.35;
    this._handRobotY = 0.05;
    this.setHandTablePosition(this._handRobotX, this._handRobotY);

    this._shadowDemoActive = false;
    this._savedLight = null;
  }

  /** Place occluder on table (robot x, robot y on table plane). */
  setHandTablePosition(xRobot, yRobot) {
    const zTable = 0.025;
    this._handRobotX = xRobot;
    this._handRobotY = yRobot;
    this._handMesh.position.set(xRobot, zTable + 0.055, -yRobot);
  }

  getWorkspaceCenter3() {
    return this._workspaceCenter.clone();
  }

  /**
   * Geometric proxy: is the hand near the lamp→workspace ray?
   * @returns {{ level: 'low'|'high', distance: number, t: number }}
   */
  estimateShadowRisk(lampPos, workspacePt, handPos) {
    const d = this._pointSegmentDistance(handPos, lampPos, workspacePt);
    const ab = workspacePt.clone().sub(lampPos);
    const ap = handPos.clone().sub(lampPos);
    const lenSq = ab.lengthSq();
    const t = lenSq > 1e-8 ? clamp(ap.dot(ab) / lenSq, 0, 1) : 0;
    const margin = this._handRadius + 0.025;
    if (d > margin || t < 0.08 || t > 0.92) {
      return { level: 'low', distance: d, t };
    }
    return { level: 'high', distance: d, t };
  }

  _pointSegmentDistance(p, a, b) {
    const ab = b.clone().sub(a);
    const ap = p.clone().sub(a);
    const t = clamp(ap.dot(ab) / Math.max(ab.lengthSq(), 1e-8), 0, 1);
    return p.distanceTo(a.clone().addScaledVector(ab, t));
  }

  /** Dim studio lights so lamp spot shadows read clearly. */
  setShadowDemoActive(active) {
    this._shadowDemoActive = active;
    if (!this._savedLight && active) {
      this._savedLight = {
        dir: this._dirLight.intensity,
        dirCast: this._dirLight.castShadow,
        amb: this._ambient.intensity,
        hemi: this._hemi.intensity,
        spot: this._spot.intensity,
      };
    }
    if (active) {
      this._dirLight.intensity = 0.12;
      this._dirLight.castShadow = false;
      this._ambient.intensity = 0.1;
      this._hemi.intensity = 0.06;
      this._spot.intensity = 5.0;
      this._spot.angle = 0.48;
    } else if (this._savedLight) {
      this._dirLight.intensity = this._savedLight.dir;
      this._dirLight.castShadow = this._savedLight.dirCast;
      this._ambient.intensity = this._savedLight.amb;
      this._hemi.intensity = this._savedLight.hemi;
      this._spot.intensity = this._savedLight.spot;
      this._spot.angle = 0.40;
      this._savedLight = null;
    }
    this._handMesh.visible = active;
    this._workspacePatch.visible = active;
    this._workspaceBorder.visible = active;
  }

  /* ════════════════════════════════════════════════════════
     Public Methods
     ════════════════════════════════════════════════════════ */

  /** Align a cylinder mesh between two 3D points */
  alignCyl(mesh, P1, P2) {
    const d = P2.clone().sub(P1), l = d.length();
    if (l < 1e-4) return;
    mesh.position.copy(P1).addScaledVector(d.normalize(), l / 2);
    mesh.quaternion.setFromUnitVectors(V3(0, 1, 0), d.normalize());
  }

  /**
   * Update all 3D meshes for a given joint configuration.
   * Returns the FK result for the UI layer to use.
   *
   * @param {number} t1 - Joint 1 angle (rad)
   * @param {number} t2 - Joint 2 angle (rad)
   * @param {number} t3 - Joint 3 angle (rad)
   * @param {THREE.Vector3|null} pTgt3 - Target point on table (or null)
   * @returns {{ x, y, z, r, P0, P1, P2, P3 }} FK result
   */
  updateScene(t1, t2, t3, pTgt3) {
    const f = fkMat(t1, t2, t3);
    const { P1, P2, P3 } = f;

    const sideAx = new THREE.Vector3(-Math.sin(t1), 0, -Math.cos(t1));
    const offV = sideAx.clone().multiplyScalar(0.06);

    // Column — reposition for dynamic L1
    this._mCol.position.y = P1.y / 2;

    // Shoulder
    this._mSh.position.copy(P1).add(offV);
    this._mSh.quaternion.setFromUnitVectors(V3(0, 1, 0), sideAx);

    // Shoulder Bracket
    this.alignCyl(this._mBrak1, P1, P1.clone().add(offV));

    // Lower arm
    this.alignCyl(this._mLow, P1.clone().add(offV), P2.clone().add(offV));

    // Elbow
    this._mEl.position.copy(P2).add(offV);
    this._mEl.quaternion.setFromUnitVectors(V3(0, 1, 0), sideAx);

    // Upper arm
    this.alignCyl(this._mUp, P2.clone().add(offV), P3.clone().add(offV));

    // Wrist
    this._mWrist.position.copy(P3).add(offV);
    this._mWrist.quaternion.setFromUnitVectors(V3(0, 1, 0), sideAx);

    // Wrist Bracket
    this.alignCyl(this._mBrak2, P3.clone().add(offV), P3);

    // Shade direction
    const shDir = pTgt3 ? pTgt3.clone().sub(P3).normalize() : V3(0, -1, 0);
    this._mSO.position.copy(P3).addScaledVector(shDir, 0.062 / 2);
    this._mSI.position.copy(P3).addScaledVector(shDir, 0.062 / 2);
    this._mSO.quaternion.setFromUnitVectors(V3(0, 1, 0), shDir.clone().negate());
    this._mSI.quaternion.setFromUnitVectors(V3(0, 1, 0), shDir.clone().negate());

    // Bulb
    this._mBulb.position.copy(P3).addScaledVector(shDir, 0.008);

    // Light cone
    const cLen = pTgt3 ? Math.min(P3.distanceTo(pTgt3) * 1.1, 0.55) : 0.50;
    const cR = cLen * 0.27;
    this._mLC.position.copy(P3).addScaledVector(shDir, cLen / 2);
    this._mLC.quaternion.setFromUnitVectors(V3(0, 1, 0), shDir.clone().negate());
    this._mLC.scale.set(cR, cLen, cR);

    // Spot & point lights
    this._spot.position.copy(P3);
    this._spotTgt.position.copy(pTgt3 || V3(P3.x, 0, P3.z));
    this._lPt.position.copy(P3).addScaledVector(shDir, 0.06);

    // Target reticle + beam
    if (pTgt3) {
      this._targetReticle.visible = true;
      this._targetReticle.position.copy(pTgt3);
      if (this._beamLine) {
        this._scene.remove(this._beamLine);
        this._beamLine.geometry.dispose();
      }
      const bg = new THREE.BufferGeometry().setFromPoints([P3.clone(), pTgt3.clone()]);
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

    return f;
  }

  /**
   * Add a trail point using the line buffer.
   * Call this each simulation frame.
   */
  addTrailPoint(pos3) {
    if (!this._trailLine) return;
    const posAttr = this._trailLine.geometry.attributes.position;
    const arr = posAttr.array;
    // Shift all points back by one
    for (let i = TRAIL_N - 1; i > 0; i--) {
      arr[i * 3]     = arr[(i - 1) * 3];
      arr[i * 3 + 1] = arr[(i - 1) * 3 + 1];
      arr[i * 3 + 2] = arr[(i - 1) * 3 + 2];
    }
    arr[0] = pos3.x; arr[1] = pos3.y; arr[2] = pos3.z;
    posAttr.needsUpdate = true;
    this._trailIdx++;
    this._trailLine.geometry.setDrawRange(0, Math.min(this._trailIdx, TRAIL_N));
  }

  /** Reset the trail line buffer */
  resetTrail() {
    if (!this._trailLine) return;
    const arr = this._trailLine.geometry.attributes.position.array;
    arr.fill(0);
    this._trailLine.geometry.attributes.position.needsUpdate = true;
    this._trailIdx = 0;
    this._trailLine.geometry.setDrawRange(0, 0);
  }

  /**
   * Update the POV camera position (extrinsic translation).
   * @param {number} tx
   * @param {number} ty
   * @param {number} tz
   */
  updatePovCamera(tx, ty, tz) {
    this._povCamera.position.set(tx, ty, tz);
    this._povCamera.lookAt(0.35, 0.02, 0.0);
    this._povCamera.updateMatrixWorld();
  }

  /** Start the render loop */
  start() {
    const loop = () => {
      requestAnimationFrame(loop);
      this._controls.update();
      this._renderer.render(this._scene, this._camera);
      this._povRenderer.render(this._scene, this._povCamera);
    };
    loop();
  }

  /* ════════════════════════════════════════════════════════
     Engineering View Controls
     ════════════════════════════════════════════════════════ */

  /** Highlight a specific link mesh */
  highlightLink(index) {
    this.clearHighlight();
    const entry = this.linkMeshes[index];
    if (entry) {
      entry.mesh._oldMat = entry.mesh.material;
      entry.mesh.material = this._mHighlightMat;
    }
  }

  /** Clear any active highlights */
  clearHighlight() {
    this.linkMeshes.forEach(l => {
      if (l.mesh._oldMat) {
        l.mesh.material = l.mesh._oldMat;
        delete l.mesh._oldMat;
      }
    });
  }

  /** Toggle wireframe mode for all robot meshes */
  setWireframe(enabled) {
    this._scene.traverse(obj => {
      if (obj.isMesh && obj.material && obj !== this._mBulb) {
        obj.material.wireframe = enabled;
      }
    });
  }

  /** Toggle joint coordinate frames */
  setAxesVisible(enabled) {
    this._axesHelpers.forEach(ah => ah.visible = enabled);
  }

  /** Change camera projection mode */
  setCameraMode(isOrtho) {
    // Note: To keep it simple, we use a single Perspective camera 
    // with a very narrow FOV for "pseudo-ortho" or we could swap.
    // For now, let's just adjust FOV or add logic if needed.
    if (isOrtho) {
      this._camera.fov = 15;
      this._camera.position.multiplyScalar(2);
    } else {
      this._camera.fov = 44;
      this._camera.position.set(1.0, 0.95, 1.0);
    }
    this._camera.updateProjectionMatrix();
  }

  /** Dynamically resize a link and its geometry */
  resizeLink(index, newLen) {
    const entry = this.linkMeshes[index];
    if (!entry) return;
    const [r1, r2] = entry.radius;
    entry.mesh.geometry.dispose();
    entry.mesh.geometry = new THREE.CylinderGeometry(r1, r2, newLen, 16);
    // Update kinematic constant
    linkLengths[entry.key] = newLen;
  }

  /** Highlight a specific link mesh */
  highlightLink(index) {
    this.clearHighlight();
    const entry = this.linkMeshes[index];
    if (entry) {
      entry.mesh._oldMat = entry.mesh.material;
      entry.mesh.material = this._mHighlightMat;
    }
  }

  /** Clear any active highlights */
  clearHighlight() {
    this.linkMeshes.forEach(l => {
      if (l.mesh._oldMat) {
        l.mesh.material = l.mesh._oldMat;
        delete l.mesh._oldMat;
      }
    });
  }

  /**
   * Update the Manipulability Ellipsoid at the End Effector.
   * @param {boolean} visible
   * @param {number[]} singularValues - Axes lengths
   * @param {THREE.Matrix4} rotation - Orientation matrix
   * @param {number} mu - Manipulability index
   * @param {THREE.Vector3} pos - Position at EE
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

  /* ════════════════════════════════════════════════════════
     Getters
     ════════════════════════════════════════════════════════ */

  get camera() { return this._camera; }
  get scene() { return this._scene; }
  get renderer() { return this._renderer; }
  get controls() { return this._controls; }
  get targetSphere() { return this._targetReticle; }
  get dragPlane() { return this._dragPlane; }
  get TRAIL_N() { return TRAIL_N; }
  get handMesh() { return this._handMesh; }
  get workspacePatch() { return this._workspacePatch; }
}
