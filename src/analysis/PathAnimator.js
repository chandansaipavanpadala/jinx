/**
 * PathAnimator.js — joint-space path playback with optional trapezoidal timing.
 */
import { trapProfile } from '../math/Trajectory.js';

/**
 * @typedef {Object} PathAnimatorOptions
 * @property {number[]} qStart
 * @property {number[]} qEnd
 * @property {number} duration — seconds
 * @property {function(number[]):void} onFrame — called with interpolated q
 * @property {function():void} [onComplete]
 * @property {number} [vmax=1.2] [amax=2.0] — trap profile limits (normalized s)
 */

export class PathAnimator {
  constructor() {
    this._raf = null;
    this._running = false;
    this._t0 = 0;
    this._opts = null;
  }

  get running() {
    return this._running;
  }

  /**
   * @param {PathAnimatorOptions} opts
   */
  play(opts) {
    this.stop();
    this._opts = opts;
    this._running = true;
    this._t0 = performance.now();
    const loop = (now) => {
      if (!this._running) return;
      const t = (now - this._t0) / 1000;
      const { duration, qStart, qEnd, vmax, amax, onFrame, onComplete } = this._opts;
      const { s } = trapProfile(Math.min(t, duration), duration, vmax ?? 1.2, amax ?? 2.0);
      const q = qStart.map((qs, i) => qs + s * (qEnd[i] - qs[i]));
      onFrame(q);
      if (t >= duration) {
        onFrame(qEnd);
        this._running = false;
        onComplete?.();
        return;
      }
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    this._running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
  }
}
