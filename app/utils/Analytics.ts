import type { PublicEnv } from "@shared/types";
import { IntegrationService } from "@shared/types";
import env from "~/env";

const excalidrawActions = new Set([
  "open",
  "ready",
  "save_success",
  "save_failure",
  "draft_restore",
  "conflict_shown",
  "conflict_resolved",
]);

const excalidrawMetadataValues: Record<string, readonly string[]> = {
  mode: ["new", "edit"],
  source: ["slash", "toolbar", "double_click", "enter"],
  result: ["continue", "duplicate", "overwrite"],
  reason: ["export", "size", "upload"],
};

const trackSafely = (send: () => void) => {
  try {
    send();
  } catch {
    // Analytics failures must not interrupt editing or saving.
  }
};

/**
 * Helper class to track events across various analytics integrations
 */
export default class Analytics {
  /**
   * Send an event to Analytics
   *
   * @param event The event name
   * @param action The action name
   * @param metadata Additional parameters to attach to the event
   * @returns Nothing.
   */
  public static track = (
    event: string,
    action: string,
    metadata?: Record<string, string>
  ) => {
    if (event !== "excalidraw") {
      if (window.ga) {
        window.ga("send", "event", event, action);
      }

      if (window.gtag) {
        window.gtag("event", event, { action, ...metadata });
      }
      return;
    }

    if (!excalidrawActions.has(action)) {
      return;
    }

    const integrations: PublicEnv["analytics"] = env.analytics ?? [];
    const safeMetadata = Object.fromEntries(
      Object.entries(metadata ?? {}).filter(([key, value]) =>
        excalidrawMetadataValues[key]?.includes(value)
      )
    );

    // GA3
    if (window.ga && env.GOOGLE_ANALYTICS_ID?.startsWith("UA-")) {
      trackSafely(() => window.ga("send", "event", event, action));
    }

    // GA4
    if (
      window.gtag &&
      (env.GOOGLE_ANALYTICS_ID?.startsWith("G-") ||
        integrations.some(
          (integration) =>
            integration.service === IntegrationService.GoogleAnalytics
        ))
    ) {
      trackSafely(() =>
        window.gtag("event", event, { action, ...safeMetadata })
      );
    }

    if (
      window._paq &&
      integrations.some(
        (integration) => integration.service === IntegrationService.Matomo
      )
    ) {
      trackSafely(() => window._paq?.push(["trackEvent", event, action]));
    }

    if (
      window.umami &&
      integrations.some(
        (integration) => integration.service === IntegrationService.Umami
      )
    ) {
      trackSafely(() => {
        void Promise.resolve(
          window.umami?.track(event, { action, ...safeMetadata })
        ).catch(() => undefined);
      });
    }
  };
}
