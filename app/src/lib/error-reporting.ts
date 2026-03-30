import { env } from './env';

let initialized = false;

export function initErrorReporting() {
  if (initialized || !env.EXPO_PUBLIC_SENTRY_DSN) {
    initialized = true;
    return;
  }
  initialized = true;
}

export function captureError(_error: unknown) {
  if (!env.EXPO_PUBLIC_SENTRY_DSN) {
    return;
  }
}
