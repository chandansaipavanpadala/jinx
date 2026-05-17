import { AuthService } from './AuthService.js';

function basePath() {
  return import.meta.env.BASE_URL || '/';
}

function loginUrl() {
  return `${basePath()}login.html`;
}

function homeUrl() {
  return `${basePath()}index.html`;
}

export function requireAuth() {
  if (!AuthService.isAuthenticated()) {
    const returnTo = encodeURIComponent(
      window.location.pathname + window.location.search + window.location.hash,
    );
    window.location.replace(`${loginUrl()}?return=${returnTo}`);
    return false;
  }
  return true;
}

export function redirectIfAuthenticated() {
  if (AuthService.isAuthenticated()) {
    const params = new URLSearchParams(window.location.search);
    const ret = params.get('return');
    window.location.replace(ret ? decodeURIComponent(ret) : homeUrl());
    return true;
  }
  return false;
}

export { loginUrl, homeUrl };
