import FloatingPanel from './FloatingPanel.js';

export default class MathDashboardPanel {
  /**
   * @param {Object} opts
   * @param {HTMLElement} opts.mountRoot - Parent element for the FloatingPanel
   * @param {string} opts.robotType - Type of robot ('rrr', 'scara', 'welder')
   */
  constructor(opts) {
    this._mountRoot = opts.mountRoot;
    this._robotType = opts.robotType || 'rrr';
    this._panel = null;
    this._mounted = false;
  }

  _ensureMounted() {
    if (this._mounted) return;
    this._mounted = true;

    // Create container for iframe
    const container = document.createElement('div');
    container.style.cssText = 'width: 850px; height: 550px; display: flex; flex-direction: column; overflow: hidden; background: var(--bg-dash); border-radius: 0 0 8px 8px;';

    const iframe = document.createElement('iframe');
    // We pass a query param just in case, but math-dashboard gets robot type from broadcast channel too
    iframe.src = `math-dashboard.html?robot=${this._robotType}&embedded=true`;
    iframe.style.cssText = 'width: 100%; height: 100%; border: none; outline: none; background: transparent;';
    
    container.appendChild(iframe);

    // Create the floating panel
    this._panel = new FloatingPanel({
      id: 'fp-math',
      title: 'Math Dashboard',
      icon: '📊',
      contentEl: container,
      startX: 60,
      startY: 60,
      startHidden: false,
    });
    this._panel.mount(this._mountRoot);
  }

  show() {
    this._ensureMounted();
    this._panel.show();
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
  }

  get isVisible() {
    return this._panel ? this._panel.isVisible : false;
  }
}
