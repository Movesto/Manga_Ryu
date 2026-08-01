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

// Register the PWA service worker so the site is installable ("Add to Home
// Screen"), works offline (shell + cached chapters), and serves assets/images
// cache-first. Deferred a tick so it doesn't compete with hydration — but NOT
// gated on window "load", which can stall indefinitely behind slow images.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  setTimeout(() => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* SW registration failing must never break the app */
    });
  }, 1200);
}
