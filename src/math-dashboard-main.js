const $ = (id) => document.getElementById(id);

const syncChannel = new BroadcastChannel('jinx_math_sync');
const cmdChannel = new BroadcastChannel('jinx_math_cmd');

const CFG = {
  rrr: {
    title: 'RRR Shadow Lamp Workspace',
    dof: 3,
    jointLabels: ['θ₁', 'θ₂', 'θ₃'],
    jointLimits: [
      [-180, 180],
      [15, 115],
      [20, 145],
    ],
    dh: [
      ['1', '0', '90°', '0.15', 'θ₁*'],
      ['2', '0.30', '0', '0', 'θ₂*'],
      ['3', '0.24', '0', '0', 'θ₃*'],
    ],
    hasElbow: true,
    hasSim: true,
  },
  scara: {
    title: '4-DOF SCARA Workstation',
    dof: 4,
    jointLabels: ['θ₁', 'θ₂', 'd₃', 'θ₄'],
    jointLimits: [
      [-180, 180],
      [-180, 180],
      [0, 200],
      [-180, 180],
    ],
    jointUnits: ['deg', 'deg', 'mm', 'deg'],
    dh: [
      ['1', '0', '0', '0.35', 'θ₁*'],
      ['2', '0.35', '180°', '0', 'θ₂*'],
      ['3', '0', '0', 'd₃*', '0'],
      ['4', '0', '0', '0', 'θ₄*'],
    ],
    hasElbow: false,
    hasSim: false,
  },
  welder: {
    title: '6-DOF Industrial Welder',
    dof: 6,
    jointLabels: ['θ₁', 'θ₂', 'θ₃', 'θ₄', 'θ₅', 'θ₆'],
    jointLimits: [
      [-180, 180],
      [-90, 90],
      [-120, 120],
      [-180, 180],
      [-120, 120],
      [-360, 360],
    ],
    dh: [
      ['1', '0', '90°', '0.20', 'θ₁*'],
      ['2', '0.30', '0', '0', 'θ₂*'],
      ['3', '0', '90°', '0', 'θ₃*'],
      ['4', '0', '-90°', '0.20', 'θ₄*'],
      ['5', '0', '90°', '0', 'θ₅*'],
      ['6', '0', '0', '0.08', 'θ₆*'],
    ],
    hasElbow: false,
    hasSim: false,
  },
};

let currentRobot = 'rrr';
let lastSync = null;
let lastMsgAt = 0;
let history = { error: [], mu: [], time: [] };
const MAX_HISTORY = 50;
let errorChart;
let muChart;

const chartDefaults = {
  responsive: true,
  maintainAspectRatio: false,
  scales: {
    x: { display: false },
    y: { grid: { color: '#333' }, ticks: { color: '#888', font: { size: 9 } } },
  },
  plugins: { legend: { display: false } },
  animation: false,
};

function sendCmd(payload) {
  cmdChannel.postMessage({ robot: currentRobot, ...payload });
}

function initCharts() {
  const errorCtx = $('errorChart').getContext('2d');
  errorChart = new Chart(errorCtx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{ data: [], borderColor: '#e06c75', borderWidth: 1.5, fill: false, pointRadius: 0 }],
    },
    options: chartDefaults,
  });

  const muCtx = $('muChart').getContext('2d');
  muChart = new Chart(muCtx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{ data: [], borderColor: '#98c379', borderWidth: 1.5, fill: false, pointRadius: 0 }],
    },
    options: chartDefaults,
  });
}

function buildJointControls() {
  const c = CFG[currentRobot] || CFG.rrr;
  const host = $('joint-controls');
  host.innerHTML = '';

  c.jointLabels.forEach((label, i) => {
    const [min, max] = c.jointLimits[i];
    const unit = c.jointUnits?.[i] || 'deg';
    const row = document.createElement('div');
    row.className = 'joint-row';
    row.innerHTML = `
      <span class="joint-label">${label}</span>
      <button type="button" class="btn-jog" data-joint="${i}" data-dir="-1">−</button>
      <input type="range" class="joint-slider" id="js-${i}" min="${min}" max="${max}" value="0" step="${unit === 'mm' ? 1 : 0.5}" />
      <button type="button" class="btn-jog" data-joint="${i}" data-dir="1">+</button>
      <span class="joint-val" id="jv-${i}">0</span>
    `;
    host.appendChild(row);

    const slider = row.querySelector('.joint-slider');
    slider.addEventListener('input', () => {
      const val = parseFloat(slider.value);
      $(`jv-${i}`).textContent = unit === 'mm' ? `${val.toFixed(0)} mm` : `${val.toFixed(1)}°`;
      pushJointStateFromSliders();
    });

    row.querySelectorAll('.btn-jog').forEach((btn) => {
      btn.addEventListener('click', () => {
        const step = parseFloat($('step-deg').value) || 5;
        const dir = parseInt(btn.dataset.dir, 10);
        const delta = unit === 'mm' ? dir * step : dir * step;
        slider.value = Math.min(max, Math.max(min, parseFloat(slider.value) + delta));
        slider.dispatchEvent(new Event('input'));
      });
    });
  });
}

function readJointSlidersRad() {
  const c = CFG[currentRobot] || CFG.rrr;
  const q = [];
  for (let i = 0; i < c.dof; i++) {
    const v = parseFloat($(`js-${i}`).value);
    const unit = c.jointUnits?.[i] || 'deg';
    q.push(unit === 'mm' ? v / 1000 : (v * Math.PI) / 180);
  }
  return q;
}

function pushJointStateFromSliders() {
  sendCmd({ type: 'fk', q: readJointSlidersRad() });
}

function syncSlidersFromQ(q) {
  const c = CFG[currentRobot] || CFG.rrr;
  if (!q) return;
  for (let i = 0; i < c.dof; i++) {
    const slider = $(`js-${i}`);
    const valEl = $(`jv-${i}`);
    if (!slider) continue;
    const unit = c.jointUnits?.[i] || 'deg';
    const display = unit === 'mm' ? q[i] * 1000 : (q[i] * 180) / Math.PI;
    slider.value = display;
    if (valEl) {
      valEl.textContent = unit === 'mm' ? `${display.toFixed(0)} mm` : `${display.toFixed(1)}°`;
    }
  }
}

function initDashboard(robot) {
  currentRobot = robot;
  const c = CFG[robot] || CFG.rrr;
  $('robot-title').textContent = c.title;

  const ja = $('joint-angles');
  ja.innerHTML = '';
  c.jointLabels.forEach((l, i) => {
    const item = document.createElement('div');
    item.className = 'data-item';
    item.innerHTML = `<div class="data-label">${l}</div><div class="data-value" id="q-${i}">0.0°</div>`;
    ja.appendChild(item);
  });

  const dhBody = $('dh-table').querySelector('tbody');
  dhBody.innerHTML = '';
  c.dh.forEach((row) => {
    dhBody.innerHTML += `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`;
  });

  const jm = $('jac-matrix');
  jm.style.gridTemplateColumns = `repeat(${c.dof}, 1fr)`;
  jm.innerHTML = '';
  for (let i = 0; i < 3 * c.dof; i++) {
    jm.innerHTML += `<div class="matrix-cell" id="j-${i}">0.00</div>`;
  }

  $('ik-elbow-row').style.display = c.hasElbow ? '' : 'none';
  $('btn-toggle-sim').style.display = c.hasSim ? '' : 'none';

  buildJointControls();
  history = { error: [], mu: [], time: [] };
}

function updateConnectionStatus() {
  const el = $('conn-status');
  const online = lastMsgAt && Date.now() - lastMsgAt < 2000;
  el.textContent = online ? 'Connected' : 'No simulator';
  el.style.borderColor = online ? 'var(--accent)' : '#b64a4a';
  el.style.color = online ? 'var(--accent)' : '#e06c75';
}

function updateUI(d) {
  lastSync = d;
  lastMsgAt = Date.now();
  updateConnectionStatus();

  $('ee-pos').textContent = `(${d.ee[0].toFixed(4)}, ${d.ee[1].toFixed(4)}, ${d.ee[2].toFixed(4)}) m`;
  d.q.forEach((v, i) => {
    const el = $(`q-${i}`);
    if (el) {
      const c = CFG[currentRobot];
      const unit = c?.jointUnits?.[i] || 'deg';
      el.textContent = unit === 'mm' ? `${(v * 1000).toFixed(0)} mm` : `${((v * 180) / Math.PI).toFixed(1)}°`;
    }
  });
  syncSlidersFromQ(d.q);

  $('ik-error').textContent = (d.error ?? 0).toExponential(2);
  $('reach-r').textContent = `${(d.reach ?? 0).toFixed(3)} m`;
  $('mu-val').textContent = (d.mu ?? 0).toFixed(5);
  $('det-val').textContent = (d.detJ ?? 0).toFixed(5);

  const badge = $('ik-status');
  if (d.converged === false) {
    badge.textContent = 'IK failed';
    badge.className = 'ik-badge bad';
  } else if (d.status === 'limit') {
    badge.textContent = 'At limit';
    badge.className = 'ik-badge warn';
  } else {
    badge.textContent = d.converged ? 'Converged' : 'Live';
    badge.className = 'ik-badge ok';
  }

  if (d.jacobian) {
    d.jacobian.flat().forEach((v, i) => {
      const el = $(`j-${i}`);
      if (el) el.textContent = v.toFixed(3);
    });
  }

  const ikFocused = ['ik-x', 'ik-y', 'ik-z'].includes(document.activeElement?.id);
  if (d.ee && !ikFocused) {
    $('ik-x').value = d.ee[0].toFixed(3);
    $('ik-y').value = d.ee[1].toFixed(3);
    $('ik-z').value = d.ee[2].toFixed(3);
  }

  $('traj-sdot').textContent = (d.sdot ?? 0).toFixed(3);
  $('traj-sddot').textContent = (d.sddot ?? 0).toFixed(3);
  $('move-mode').textContent = d.mode || '—';

  history.time.push('');
  history.error.push(d.error ?? 0);
  history.mu.push(d.mu ?? 0);
  if (history.time.length > MAX_HISTORY) {
    history.time.shift();
    history.error.shift();
    history.mu.shift();
  }

  errorChart.data.labels = history.time;
  errorChart.data.datasets[0].data = history.error;
  errorChart.update();

  muChart.data.labels = history.time;
  muChart.data.datasets[0].data = history.mu;
  muChart.update();

  $('time-sync').textContent = `T+ ${new Date().toLocaleTimeString()}`;
}

function bindControls() {
  $('btn-apply-ik').addEventListener('click', () => {
    const target = [
      parseFloat($('ik-x').value),
      parseFloat($('ik-y').value),
      parseFloat($('ik-z').value),
    ];
    const payload = { type: 'ik', target };
    if (CFG[currentRobot]?.hasElbow) {
      payload.elbow = $('ik-elbow').value === 'up' ? 1 : -1;
    }
    sendCmd(payload);
  });

  $('btn-capture-ee').addEventListener('click', () => {
    if (!lastSync?.ee) return;
    $('ik-x').value = lastSync.ee[0].toFixed(3);
    $('ik-y').value = lastSync.ee[1].toFixed(3);
    $('ik-z').value = lastSync.ee[2].toFixed(3);
  });

  $('btn-home').addEventListener('click', () => sendCmd({ type: 'home' }));

  $('btn-toggle-sim').addEventListener('click', () => sendCmd({ type: 'toggle_sim' }));

  const eeStep = 0.02;
  document.querySelectorAll('[data-ee]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const axis = btn.dataset.ee;
      const dir = parseInt(btn.dataset.dir, 10);
      const delta = [0, 0, 0];
      if (axis === 'x') delta[0] = dir * eeStep;
      if (axis === 'y') delta[1] = dir * eeStep;
      if (axis === 'z') delta[2] = dir * eeStep;
      sendCmd({ type: 'jog_ee', delta });
    });
  });

  $('btn-send-joints').addEventListener('click', () => pushJointStateFromSliders());
}

syncChannel.onmessage = (e) => {
  const d = e.data;
  if (d.robot !== currentRobot) initDashboard(d.robot);
  updateUI(d);
};

setInterval(updateConnectionStatus, 500);

const urlParams = new URLSearchParams(window.location.search);
const robotType = urlParams.get('robot') || 'rrr';
if (urlParams.get('embedded') === 'true') {
  const header = document.querySelector('header');
  if (header) header.style.display = 'none';
}

initCharts();
initDashboard(robotType);
bindControls();
updateConnectionStatus();
