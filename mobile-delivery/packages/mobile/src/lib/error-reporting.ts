import * as Sentry from 'sentry-expo';
import { env } from './env';

let initialized = false;

export function initErrorReporting() {
  if (initialized || !env.EXPO_PUBLIC_SENTRY_DSN) {
    initialized = true;
    return;
  }

  Sentry.init({
    dsn: env.EXPO_PUBLIC_SENTRY_DSN,
    enableInExpoDevelopment: false,
    debug: false,
  });
  initialized = true;
}

export function captureError(error: unknown) {
  if (!env.EXPO_PUBLIC_SENTRY_DSN) {
    return;
  }
  Sentry.Native.captureException(error);
}
