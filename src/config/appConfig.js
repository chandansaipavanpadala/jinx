/**
 * Application configuration (Vite env → runtime).
 * Production builds must not ship default passwords unless explicitly set in CI secrets.
 */
const env = import.meta.env;

function flag(name, defaultValue = false) {
  const v = env[name];
  if (v === undefined || v === '') return defaultValue;
  return v === 'true' || v === '1';
}

export const appConfig = {
  mode: env.MODE,
  isProduction: env.PROD,
  isDevelopment: env.DEV,
  baseUrl: env.BASE_URL || '/',

  database: {
    /** `local` | `api` */
    driver: env.VITE_DB_DRIVER || 'local',
    apiBaseUrl: (env.VITE_API_BASE_URL || '').replace(/\/$/, ''),
  },

  auth: {
    /**
     * Seed a default workstation user when the profile store is empty.
     * Off in production unless VITE_ALLOW_SEED_USER=true (e.g. demo deploy).
     */
    allowSeedUser:
      flag('VITE_ALLOW_SEED_USER', false) ||
      (env.DEV && env.VITE_ALLOW_SEED_USER !== 'false' && Boolean(env.VITE_SEED_PASSWORD)),
    seedEmail: env.VITE_SEED_EMAIL || '',
    seedPassword: env.VITE_SEED_PASSWORD || '',
    seedDisplayName: env.VITE_SEED_DISPLAY_NAME || 'JINX Operator',
    sessionTtlMs: (Number(env.VITE_SESSION_HOURS) || 12) * 60 * 60 * 1000,
    rememberTtlMs: (Number(env.VITE_REMEMBER_DAYS) || 30) * 24 * 60 * 60 * 1000,
    /** Pre-fill login email in dev/demo only (never the password). */
    prefillLoginEmail: env.DEV || flag('VITE_PREFILL_LOGIN_EMAIL', false),
  },
};

/** Resolve app-relative paths for GitHub Pages base URL. */
export function resolveAppPath(relativePath) {
  const base = appConfig.baseUrl.endsWith('/')
    ? appConfig.baseUrl
    : `${appConfig.baseUrl}/`;
  const rel = relativePath.replace(/^\//, '');
  return `${base}${rel}`;
}
