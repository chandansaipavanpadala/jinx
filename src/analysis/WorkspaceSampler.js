/**
 * WorkspaceSampler.js — grid reachability analysis (RoboAnalyzer-style).
 */
import { ik_dls, jacobian } from '../math/KinematicsNDOF.js';
import { manipulabilityPosition } from '../model/RobotModel.js';

/**
 * Sample Cartesian grid in DH frame at fixed Z.
 * @param {Object} opts
 * @param {Object[]} opts.dhTable
 * @param {number} opts.zFixed — DH z height for slice (m)
 * @param {number} [opts.xMin=-0.55] [opts.xMax=0.55] [opts.yMin=-0.55] [opts.yMax=0.55]
 * @param {number} [opts.resolution=15]
 * @param {number[]} [opts.qSeed]
 * @param {function(number):void} [opts.onProgress] — 0..1
 * @returns {Promise<{ cells: Array, nx: number, ny: number, stats: Object }>}
 */
export async function sampleWorkspaceSlice({
  dhTable,
  zFixed,
  xMin = -0.55,
  xMax = 0.55,
  yMin = -0.55,
  yMax = 0.55,
  resolution = 15,
  qSeed = [0, 0, 0.1, 0],
  onProgress,
}) {
  const nx = resolution;
  const ny = resolution;
  const cells = [];
  let reachable = 0;
  let singular = 0;
  const qWork = [...qSeed];
  const total = nx * ny;
  let done = 0;

  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      const x = xMin + (ix / Math.max(1, nx - 1)) * (xMax - xMin);
      const y = yMin + (iy / Math.max(1, ny - 1)) * (yMax - yMin);
      const target = [x, y, zFixed];

      const ik = ik_dls(target, qWork, dhTable, 80, 0.08, 2e-3);
      let mu = 0;
      let status = 'unreachable';

      if (ik.converged) {
        for (let k = 0; k < dhTable.length; k++) qWork[k] = ik.q[k];
        const { J, cols } = jacobian(ik.q, dhTable);
        mu = manipulabilityPosition(J, cols);
        status = mu < 0.008 ? 'singular' : 'reachable';
        if (status === 'reachable') reachable++;
        else singular++;
      }

      cells.push({ ix, iy, x, y, z: zFixed, status, error: ik.error, mu, q: ik.converged ? [...ik.q] : null });

      done++;
      if (onProgress && done % 8 === 0) {
        onProgress(done / total);
        await new Promise((r) => setTimeout(r, 0));
      }
    }
  }

  if (onProgress) onProgress(1);

  return {
    cells,
    nx,
    ny,
    bounds: { xMin, xMax, yMin, yMax, zFixed },
    stats: {
      total,
      reachable,
      singular,
      unreachable: total - reachable - singular,
      reachPct: ((reachable / total) * 100).toFixed(1),
    },
  };
}
