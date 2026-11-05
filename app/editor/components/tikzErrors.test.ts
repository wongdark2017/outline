import { createInstance } from "i18next";
import { getTikzErrorMessage } from "./tikzErrors";

const i18n = createInstance();

beforeAll(async () => {
  await i18n.init({
    lng: "en",
    fallbackLng: "en",
    resources: { en: { translation: {} } },
  });
});

describe("getTikzErrorMessage", () => {
  it("reports the original missing-package line without leaking placeholders", () => {
    const message = getTikzErrorMessage(
      i18n.t,
      undefined,
      { ok: false, reason: "compile", error: "TeX failed" },
      { detail: "TeX failed", missingPackage: "pgf-pie", line: 3 }
    );

    expect(message).toContain("Line 3");
    expect(message).toContain("pgf-pie");
    expect(message).not.toContain("{{");
    expect(message).not.toContain("Diagram compilation failed");
  });

  it("does not fabricate a line when a package cannot be located", () => {
    const message = getTikzErrorMessage(
      i18n.t,
      undefined,
      { ok: false, reason: "compile", error: "TeX failed" },
      { detail: "TeX failed", missingPackage: "pgf-pie" }
    );

    expect(message).toContain("pgf-pie");
    expect(message).not.toContain("Line");
    expect(message).not.toContain("{{");
  });

  it("keeps timeouts distinct from an older missing-package diagnostic", () => {
    const message = getTikzErrorMessage(
      i18n.t,
      undefined,
      { ok: false, reason: "timeout", error: "internal timeout" },
      { detail: "old compiler error", missingPackage: "old-package", line: 9 }
    );

    expect(message).toContain("10 seconds");
    expect(message).not.toContain("old-package");
    expect(message).not.toContain("internal timeout");
  });

  it("shows fixed save copy rather than an underlying server error", () => {
    const message = getTikzErrorMessage(i18n.t, "save", {
      ok: false,
      reason: "compile",
      error: "private upload endpoint",
    });

    expect(message).toContain("could not be saved");
    expect(message).not.toContain("private upload endpoint");
  });

  it("distinguishes unavailable source from absent source metadata", () => {
    expect(getTikzErrorMessage(i18n.t, "source")).toContain(
      "source could not be loaded"
    );
    expect(getTikzErrorMessage(i18n.t, "metadata")).toContain(
      "does not contain editable TikZ source"
    );
  });

  it("keeps intentional aborts silent", () => {
    expect(
      getTikzErrorMessage(i18n.t, undefined, {
        ok: false,
        reason: "aborted",
        error: "Render aborted",
      })
    ).toBeUndefined();
  });

  it("keeps engine and invalid-image failures distinct", () => {
    expect(
      getTikzErrorMessage(i18n.t, undefined, {
        ok: false,
        reason: "engine",
        error: "private loader failure",
      })
    ).toContain("engine could not be loaded");
    expect(
      getTikzErrorMessage(i18n.t, undefined, {
        ok: false,
        reason: "invalid-svg",
        error: "invalid XML",
      })
    ).toContain("No valid diagram");
  });
});
