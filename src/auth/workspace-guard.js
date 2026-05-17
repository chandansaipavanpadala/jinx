import { requireAuth } from './authGuard.js';
import { showFullscreenHintIfNeeded } from '../ui/FullscreenHint.js';
import { getDatabase } from '../database/index.js';

function recordWorkspaceVisit() {
  const id = document.body?.dataset?.workspace;
  if (!id) return;
  try {
    getDatabase().workspaces.recordVisit(id);
  } catch {
    /* ignore storage errors */
  }
}

if (requireAuth()) {
  recordWorkspaceVisit();
  showFullscreenHintIfNeeded({ delayMs: 1000 });
}
