import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

interface SentryClientConfig {
  dsn: string;
  environment?: string;
  release?: string;
  tracesSampleRate?: number;
}

declare global {
  interface Window {
    __SENTRY_CFG__?: SentryClientConfig;
  }
}

// Browser error tracking. The SDK chunk is only fetched when a DSN was
// injected by the server (root loader → Layout), so Sentry adds nothing to
// the bundle when observability is off.
const sentryCfg = window.__SENTRY_CFG__;
if (sentryCfg?.dsn) {
  import("@sentry/browser")
    .then((Sentry) => {
      Sentry.init({
        dsn: sentryCfg.dsn,
        environment: sentryCfg.environment,
        release: sentryCfg.release,
        tracesSampleRate: sentryCfg.tracesSampleRate ?? 0.1,
        integrations: [Sentry.browserTracingIntegration()],
      });
    })
    .catch(() => {
      /* Sentry failing to load must never break the app */
    });
}

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter />
    </StrictMode>,
  );
});
