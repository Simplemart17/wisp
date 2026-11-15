/**
 * Browser error monitoring. Runs before hydration; a no-op without a DSN.
 * What may leave the browser is decided in lib/shared/sentry.ts — read that
 * before adding an integration here (in particular: never session replay).
 */
import * as Sentry from "@sentry/nextjs";

import { SENTRY_DSN, sentryBaseOptions } from "@/lib/shared/sentry";

if (SENTRY_DSN) {
  Sentry.init(sentryBaseOptions);
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
