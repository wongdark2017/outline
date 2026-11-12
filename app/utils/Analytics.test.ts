import { IntegrationService } from "@shared/types";
import env from "~/env";
import Analytics from "./Analytics";

vi.mock("~/env", () => ({
  default: { GOOGLE_ANALYTICS_ID: undefined, analytics: [] },
}));

beforeEach(() => {
  env.GOOGLE_ANALYTICS_ID = undefined;
  env.analytics = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Analytics.track Excalidraw events", () => {
  it("sends one fixed action to each configured service with only allowed data", () => {
    env.GOOGLE_ANALYTICS_ID = "UA-TEST";
    env.analytics = [
      {
        service: IntegrationService.GoogleAnalytics,
        settings: { measurementId: "G-TEST" },
      },
      {
        service: IntegrationService.Matomo,
        settings: { measurementId: "1" },
      },
      {
        service: IntegrationService.Umami,
        settings: { measurementId: "test" },
      },
    ];

    const ga = vi.fn();
    const gtag = vi.fn();
    const paq: string[][] = [];
    const umami = vi.fn();
    vi.stubGlobal("ga", ga);
    vi.stubGlobal("gtag", gtag);
    vi.stubGlobal("_paq", paq);
    vi.stubGlobal("umami", { track: umami });

    Analytics.track("excalidraw", "open", {
      mode: "new",
      source: "slash",
      reason: "unexpected-error-message",
      documentId: "private-id",
      title: "private-title",
    });

    expect(ga).toHaveBeenCalledExactlyOnceWith(
      "send",
      "event",
      "excalidraw",
      "open"
    );
    expect(gtag).toHaveBeenCalledExactlyOnceWith("event", "excalidraw", {
      action: "open",
      mode: "new",
      source: "slash",
    });
    expect(paq).toEqual([["trackEvent", "excalidraw", "open"]]);
    expect(umami).toHaveBeenCalledExactlyOnceWith("excalidraw", {
      action: "open",
      mode: "new",
      source: "slash",
    });
  });

  it("does not send Excalidraw events without a configured service", () => {
    const ga = vi.fn();
    const gtag = vi.fn();
    const paq: string[][] = [];
    const umami = vi.fn();
    vi.stubGlobal("ga", ga);
    vi.stubGlobal("gtag", gtag);
    vi.stubGlobal("_paq", paq);
    vi.stubGlobal("umami", { track: umami });

    Analytics.track("excalidraw", "ready", { mode: "new" });

    expect(ga).not.toHaveBeenCalled();
    expect(gtag).not.toHaveBeenCalled();
    expect(paq).toEqual([]);
    expect(umami).not.toHaveBeenCalled();
  });

  it("ignores actions outside the approved event list", () => {
    env.analytics = [
      {
        service: IntegrationService.Umami,
        settings: { measurementId: "test" },
      },
    ];
    const umami = vi.fn();
    vi.stubGlobal("umami", { track: umami });

    Analytics.track("excalidraw", "stroke", { mode: "edit" });

    expect(umami).not.toHaveBeenCalled();
  });

  it("continues sending after a provider throws", () => {
    env.GOOGLE_ANALYTICS_ID = "UA-TEST";
    env.analytics = [
      {
        service: IntegrationService.GoogleAnalytics,
        settings: { measurementId: "G-TEST" },
      },
      {
        service: IntegrationService.Matomo,
        settings: { measurementId: "1" },
      },
      {
        service: IntegrationService.Umami,
        settings: { measurementId: "test" },
      },
    ];
    const throwing = vi.fn(() => {
      throw new Error("tracker failed");
    });
    const umami = vi.fn();
    vi.stubGlobal("ga", throwing);
    vi.stubGlobal("gtag", throwing);
    vi.stubGlobal("_paq", { push: throwing });
    vi.stubGlobal("umami", { track: umami });

    expect(() => Analytics.track("excalidraw", "save_success")).not.toThrow();
    expect(throwing).toHaveBeenCalledTimes(3);
    expect(umami).toHaveBeenCalledExactlyOnceWith("excalidraw", {
      action: "save_success",
    });
  });

  it("ignores an asynchronous Umami failure", async () => {
    env.analytics = [
      {
        service: IntegrationService.Umami,
        settings: { measurementId: "test" },
      },
    ];
    const umami = vi.fn().mockRejectedValue(new Error("tracker failed"));
    vi.stubGlobal("umami", { track: umami });

    expect(() => Analytics.track("excalidraw", "ready")).not.toThrow();
    await Promise.resolve();
    expect(umami).toHaveBeenCalledExactlyOnceWith("excalidraw", {
      action: "ready",
    });
  });
});
