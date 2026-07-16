import * as Sentry from "@sentry/node";

let started = false;

/**
 * Initialise Sentry for the node SSR server. No-op unless SENTRY_DSN_FRONTEND
 * is set, so the frontend runs identically with observability off.
 * Called once at module load from entry.server.tsx.
 */
export function initSentryServer(): void {
  const dsn = process.env.SENTRY_DSN_FRONTEND;
  if (!dsn || started) return;
  started = true;
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? "production",
    release: process.env.SENTRY_RELEASE || undefined,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.1"),
  });
}

export function sentryEnabled(): boolean {
  return started;
}

/** The browser SDK ingest origin (from the DSN), for the CSP connect-src. */
export function sentryIngestOrigin(): string | null {
  const dsn = process.env.SENTRY_DSN_FRONTEND;
  if (!dsn) return null;
  try {
    return new URL(dsn).origin;
  } catch {
    return null;
  }
}

/** Client Sentry config injected into the document for the browser SDK. */
export function sentryClientConfig() {
  const dsn = process.env.SENTRY_DSN_FRONTEND;
  if (!dsn) return null;
  return {
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? "production",
    release: process.env.SENTRY_RELEASE || undefined,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.1"),
  };
}

export { Sentry };
