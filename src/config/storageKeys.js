/** Versioned storage keys — bump suffix when document shape changes. */
export const STORAGE_KEYS = {
  USER: 'jinx_user_v1',
  SESSION: 'jinx_session_v1',
  SESSION_REMEMBER: 'jinx_session_persistent_v1',
  RECENT_WORKSPACES: 'jinx_recent_workspaces_v1',
  SAVED_CONFIGS: 'jinx_saved_configs_v1',
  PREFERENCES: 'jinx_preferences_v1',
};

/** Session-scoped preference fields (stored via session driver). */
export const SESSION_PREF_KEYS = {
  FULLSCREEN_PENDING: 'fullscreen_pending',
  FULLSCREEN_DISMISSED: 'fullscreen_dismissed',
};
