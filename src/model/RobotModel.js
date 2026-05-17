/**
 * RobotModel.js — serial manipulator definition (RoboAnalyzer-style model layer).
 * Pure data + helpers; math lives in KinematicsNDOF / Kinematics.
 */

/**
 * @typedef {Object} DhJoint
 * @property {number} a
 * @property {number} alpha
 * @property {number} d
 * @property {number} theta
 * @property {'R'|'P'} type
 * @property {number} limitMin
 * @property {number} limitMax
 */

/**
 * @typedef {Object} RobotModelDef
 * @property {string} id
 * @property {string} name
 * @property {number} dof
 * @property {DhJoint[]} dhTable
 * @property {{ jointIndex: number, dhKey: string }[]} [editableLinks]
 */

/** Deep-clone a DH table so analysis does not mutate globals accidentally. */
export function cloneDhTable(dhTable) {
  return dhTable.map((j) => ({ ...j }));
}

/** @param {RobotModelDef} model */
export function getDhTable(model) {
  return model.dhTable;
}

/**
 * Apply a DH parameter edit on the live table (mutates in place).
 * @returns {boolean} whether the key is allowed
 */
export function setDhParameter(dhTable, jointIndex, key, value) {
  const allowed = ['a', 'alpha', 'd', 'theta'];
  if (!allowed.includes(key)) return false;
  if (!dhTable[jointIndex]) return false;
  dhTable[jointIndex][key] = value;
  return true;
}

/** DH (x,y,z) → Three.js (x, y, z) used by JINX SCARA/welder scenes */
export function dhPositionToThree(x, y, z) {
  return { x, y: z, z: -y };
}

/** Three.js → DH */
export function threePositionToDh(x, y, z) {
  return { x, y: -z, z: y };
}

/**
 * Manipulability index μ = √det(J·Jᵀ) using position rows only.
 * @param {Float64Array|number[][]} J6 — 6×N Jacobian (row-major flat or 2D)
 * @param {number} n
 */
export function manipulabilityPosition(J6, n) {
  const A = new Float64Array(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let k = 0; k < n; k++) {
        const jr = J6[r * n + k] ?? J6[r]?.[k] ?? 0;
        const jc = J6[c * n + k] ?? J6[c]?.[k] ?? 0;
        sum += jr * jc;
      }
      A[r * 3 + c] = sum;
    }
  }
  const det =
    A[0] * (A[4] * A[8] - A[5] * A[7]) -
    A[1] * (A[3] * A[8] - A[5] * A[6]) +
    A[2] * (A[3] * A[7] - A[4] * A[6]);
  return Math.sqrt(Math.max(0, det));
}
