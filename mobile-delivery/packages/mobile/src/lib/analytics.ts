import { env } from './env';

let bootstrapped = false;
let client: any = null;

export async function bootstrapAnalytics() {
  if (bootstrapped || !env.EXPO_PUBLIC_POSTHOG_KEY) {
    bootstrapped = true;
    return;
  }

  const { PostHog } = await import('posthog-react-native');
  client = new PostHog(env.EXPO_PUBLIC_POSTHOG_KEY, {
    host: env.EXPO_PUBLIC_POSTHOG_HOST,
  });
  bootstrapped = true;
}

export function track(event: string, properties?: Record<string, unknown>) {
  client?.capture(event, properties);
}

export function trackScreen(name: string, properties?: Record<string, unknown>) {
  client?.screen(name, properties);
}
