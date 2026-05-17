/**
 * @deprecated Seed credentials live in .env (see .env.example).
 * Import appConfig.auth instead.
 */
import { appConfig } from '../config/appConfig.js';

export const DEFAULT_USER = {
  email: appConfig.auth.seedEmail,
  password: appConfig.auth.seedPassword,
  displayName: appConfig.auth.seedDisplayName,
};
