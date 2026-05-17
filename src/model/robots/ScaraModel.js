import { SCARA_DH_CONFIG } from '../../math/KinematicsNDOF.js';
import { cloneDhTable } from '../RobotModel.js';

/** SCARA robot definition for the analyzer / simulator stack. */
export const SCARA_MODEL = {
  id: 'scara',
  name: '4-DOF SCARA (R-R-P-R)',
  dof: 4,
  dhTable: cloneDhTable(SCARA_DH_CONFIG),
  jointNames: ['θ₁ base', 'θ₂ elbow', 'd₃ stroke', 'θ₄ wrist'],
  editableLinks: [
    { jointIndex: 0, dhKey: 'a', label: 'Link 1 (L1)', min: 0.15, max: 0.45, meshLinkIndex: 0 },
    { jointIndex: 1, dhKey: 'a', label: 'Link 2 (L2)', min: 0.12, max: 0.40, meshLinkIndex: 1 },
  ],
};

/** Sync model table from the live runtime config (after slider / resize). */
export function syncScaraModelFromRuntime() {
  for (let i = 0; i < SCARA_MODEL.dhTable.length; i++) {
    Object.assign(SCARA_MODEL.dhTable[i], SCARA_DH_CONFIG[i]);
  }
}

export function applyScaraModelToRuntime() {
  for (let i = 0; i < SCARA_DH_CONFIG.length; i++) {
    Object.assign(SCARA_DH_CONFIG[i], SCARA_MODEL.dhTable[i]);
  }
}
