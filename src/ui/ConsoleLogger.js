export class ConsoleLogger {
  constructor(containerId = 'consoleBody') {
    this.container = document.getElementById(containerId);
    this.maxLines = 100;
  }

  _getTimeString() {
    const now = new Date();
    const pad = (n, len=2) => n.toString().padStart(len, '0');
    return `[${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(), 3)}]`;
  }

  _append(type, tag, msg) {
    if (!this.container) return;
    const line = document.createElement('div');
    line.className = `log-line ${type}`;
    
    const timeSpan = document.createElement('span');
    timeSpan.className = 'log-time';
    timeSpan.textContent = this._getTimeString();
    
    const tagSpan = document.createElement('span');
    tagSpan.style.color = 'var(--text-dim)';
    tagSpan.style.marginRight = '8px';
    tagSpan.textContent = `[${tag.padEnd(5, ' ')}]`;
    
    const msgSpan = document.createElement('span');
    msgSpan.textContent = msg;
    
    line.appendChild(timeSpan);
    line.appendChild(tagSpan);
    line.appendChild(msgSpan);
    
    this.container.appendChild(line);
    
    // Auto-scroll
    this.container.scrollTop = this.container.scrollHeight;
    
    // Trim
    while (this.container.children.length > this.maxLines) {
      this.container.removeChild(this.container.firstChild);
    }
  }

  info(msg) { this._append('info', 'SYS', msg); }
  log(msg) { this._append('', 'INFO', msg); }
  warn(msg) { this._append('warn', 'WARN', msg); }
  error(msg) { this._append('error', 'ERROR', msg); }
  
  clear() {
    if (this.container) this.container.innerHTML = '';
  }
}

// Global instance for the page
export const logger = new ConsoleLogger();
