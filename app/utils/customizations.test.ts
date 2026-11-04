import type {
  CustomizationsInfo,
  PersonalCustomizationBackground,
} from "@shared/types/customizations";
import type { CustomizationStyleState } from "./customizations";
import {
  CustomizationStyleManager,
  getCustomizationBackground,
  getCustomizationRecoveryUrl,
  getEnabledCustomizationScript,
  isCustomizationRecoveryRequested,
} from "./customizations";

function settings(): CustomizationsInfo {
  return {
    workspace: {
      background: { asset: null, fit: "cover", version: 0 },
      css: { source: ".workspace {}", version: 1 },
      script: {
        id: "revision-one",
        revision: 1,
        digest: "digest-one",
        source: "export function activate() {}",
        modules: {},
        url: "/api/customizations.module/revision-one/entry.js",
        createdAt: "2026-11-04T00:00:00Z",
      },
    },
    personal: {
      background: {
        asset: null,
        fit: "contain",
        source: "inherit",
        version: 0,
      },
      css: { source: ".personal {}", version: 2 },
      enabledScriptId: "revision-one",
      enabledScriptDigest: "digest-one",
    },
    scriptEnabled: true,
    scriptsAllowed: true,
    canManage: false,
  };
}

describe("customization recovery", () => {
  it("only enables recovery from the explicit recovery query flag", () => {
    expect(isCustomizationRecoveryRequested("?disableCustomizations=1")).toBe(
      true
    );
    expect(
      isCustomizationRecoveryRequested("?other=1&disableCustomizations=1")
    ).toBe(true);
    expect(isCustomizationRecoveryRequested("?disableCustomizations=0")).toBe(
      false
    );
    expect(isCustomizationRecoveryRequested("?disableCustomizations")).toBe(
      false
    );
    expect(isCustomizationRecoveryRequested("")).toBe(false);
  });

  it("preserves the application location and query in a recovery URL", () => {
    expect(
      getCustomizationRecoveryUrl({
        pathname: "/settings/customizations",
        search: "?tab=css",
        hash: "#editor",
      })
    ).toBe("/settings/customizations?tab=css&disableCustomizations=1#editor");
  });
});

describe("customization resolution", () => {
  it("requires current exact consent as well as both server flags", () => {
    const info = settings();
    expect(getEnabledCustomizationScript(info)).toBe(info.workspace.script);
    expect(
      getEnabledCustomizationScript({ ...info, scriptEnabled: false })
    ).toBeNull();
    expect(
      getEnabledCustomizationScript({ ...info, scriptsAllowed: false })
    ).toBeNull();
    expect(
      getEnabledCustomizationScript({
        ...info,
        personal: { ...info.personal, enabledScriptId: "older" },
      })
    ).toBeNull();
    expect(
      getEnabledCustomizationScript({
        ...info,
        personal: { ...info.personal, enabledScriptDigest: "older" },
      })
    ).toBeNull();
    expect(
      getEnabledCustomizationScript({
        ...info,
        workspace: { ...info.workspace, script: null },
      })
    ).toBeNull();
  });

  it("resolves personal backgrounds independently of color themes", () => {
    const info = settings();
    expect(getCustomizationBackground(info)).toBe(info.workspace.background);
    const personal: PersonalCustomizationBackground = {
      ...info.personal.background,
      source: "personal",
    };
    expect(
      getCustomizationBackground({
        ...info,
        personal: { ...info.personal, background: personal },
      })
    ).toBe(personal);
  });
});

describe("CustomizationStyleManager", () => {
  it("owns screen-only ordered styles and clears image state on recovery", async () => {
    const manager = new CustomizationStyleManager(document);
    const existing = document.createElement("style");
    existing.textContent = ".base {}";
    document.head.append(existing);

    manager.apply({
      backgroundUrl: "/api/customizations.background?id=image-one",
      backgroundFit: "cover",
      workspaceCss: ".test { color: red; }",
      personalCss: ".test { color: blue; }",
    });

    const nodes = [
      ...document.head.querySelectorAll<HTMLStyleElement>(
        "[data-outline-customization]"
      ),
    ];
    expect(nodes.map((node) => node.dataset.outlineCustomization)).toEqual([
      "background",
      "workspace",
      "personal",
    ]);
    expect(nodes.every((node) => node.media === "screen")).toBe(true);
    expect(
      document.body.hasAttribute("data-outline-customization-background")
    ).toBe(true);

    const lazyBase = document.createElement("style");
    lazyBase.textContent = ".lazy {}";
    document.head.append(lazyBase);
    await vi.waitFor(() =>
      expect(document.head.lastElementChild).toBe(nodes[2])
    );
    expect(lazyBase.nextElementSibling).toBe(nodes[0]);

    manager.clear();
    expect(
      document.head.querySelectorAll("[data-outline-customization]")
    ).toHaveLength(0);
    expect(
      document.body.hasAttribute("data-outline-customization-background")
    ).toBe(false);
    expect(
      document.body.style.getPropertyValue(
        "--outline-customization-background-image"
      )
    ).toBe("");
    expect(existing.isConnected).toBe(true);
    manager.dispose();
    existing.remove();
    lazyBase.remove();
  });

  it("updates sources without accumulating styles or changing their order", () => {
    const manager = new CustomizationStyleManager(document);
    manager.apply({
      backgroundUrl: "/api/customizations.background?id=image-one",
      backgroundFit: "cover",
      workspaceCss: ".one {}",
      personalCss: ".two {}",
    });
    manager.apply({
      backgroundFit: "repeat",
      workspaceCss: ".three {}",
      personalCss: "",
    });

    const nodes = [
      ...document.head.querySelectorAll<HTMLStyleElement>(
        "[data-outline-customization]"
      ),
    ];
    expect(nodes).toHaveLength(3);
    expect(nodes[0].textContent).toBe("");
    expect(nodes[1].textContent).toBe(".three {}");
    expect(nodes[2].textContent).toBe("");
    expect(
      document.body.hasAttribute("data-outline-customization-background")
    ).toBe(false);
    expect(
      document.body.style.getPropertyValue(
        "--outline-customization-background-image"
      )
    ).toBe("");
    manager.dispose();
  });

  describe("startup root background", () => {
    let root: HTMLDivElement;
    let manager: CustomizationStyleManager;
    const state: CustomizationStyleState = {
      backgroundUrl: "/api/customizations.background?id=image-one",
      backgroundFit: "cover",
      workspaceCss: "",
      personalCss: "",
    };

    beforeEach(() => {
      root = document.createElement("div");
      root.id = "root";
      root.style.background = "#242428";
      root.style.color = "green";
      document.body.append(root);
      manager = new CustomizationStyleManager(document);
    });

    afterEach(() => {
      manager.dispose();
      root.remove();
    });

    it("reveals the body image only while a saved image is active", () => {
      const original = root.style.background;
      manager.apply({ ...state, backgroundUrl: undefined });
      expect(root.style.background).toBe(original);

      manager.apply(state);
      expect(Array.from(root.style)).not.toContain("background");
      expect(getComputedStyle(root).backgroundColor).toBe("rgba(0, 0, 0, 0)");
      expect(root.style.color).toBe("green");

      root.style.marginTop = "9px";
      manager.apply({ ...state, backgroundUrl: undefined });
      expect(root.style.background).toBe(original);
      expect(root.style.color).toBe("green");
      expect(root.style.marginTop).toBe("9px");
    });

    it("keeps the original snapshot through repeated applies and image replacement", () => {
      root.style.setProperty("background", "#242428", "important");
      const original = root.style.background;

      manager.apply(state);
      manager.apply(state);
      manager.apply({ ...state, backgroundUrl: "/second-image" });
      expect(Array.from(root.style)).not.toContain("background");

      manager.apply({ ...state, backgroundUrl: undefined });
      expect(root.style.background).toBe(original);
      expect(root.style.getPropertyPriority("background")).toBe("important");
    });

    it.each(["clear", "dispose"])(
      "restores the latest original background once on %s",
      (cleanup) => {
        manager.apply(state);
        manager.clear();

        root.style.setProperty("background", "#123456", "important");
        const original = root.style.background;
        manager.apply(state);
        expect(Array.from(root.style)).not.toContain("background");

        if (cleanup === "clear") {
          manager.clear();
          manager.clear();
        } else {
          manager.dispose();
          manager.dispose();
        }

        expect(root.style.background).toBe(original);
        expect(root.style.getPropertyPriority("background")).toBe("important");
        expect(root.style.color).toBe("green");
      }
    );

    it("preserves a background authored by a script during activation", () => {
      manager.apply(state);
      root.style.setProperty("background", "#123456", "important");
      const authored = root.style.background;

      manager.apply({ ...state, backgroundUrl: "/second-image" });
      expect(root.style.background).toBe(authored);

      manager.clear();
      manager.dispose();
      expect(root.style.background).toBe(authored);
      expect(root.style.getPropertyPriority("background")).toBe("important");
    });

    it.each([
      { property: "background-color", value: "rgb(18, 52, 86)" },
      { property: "background-image", value: 'url("/script-image")' },
    ])(
      "preserves a newly authored $property on cleanup",
      ({ property, value }) => {
        manager.apply(state);
        root.style.setProperty(property, value, "important");
        const authored = root.style.getPropertyValue(property);

        manager.apply({ ...state, backgroundUrl: undefined });
        manager.clear();
        expect(root.style.getPropertyValue(property)).toBe(authored);
        expect(root.style.getPropertyPriority(property)).toBe("important");
        expect(root.style.getPropertyValue("background")).toBe("");
      }
    );

    it("leaves independently authored longhands intact without a startup shorthand", () => {
      root.style.removeProperty("background");
      root.style.backgroundColor = "red";

      manager.apply(state);
      expect(root.style.backgroundColor).toBe("red");

      root.style.background = "blue";
      manager.apply(state);
      manager.clear();
      expect(root.style.background).toBe("blue");
    });
  });
});
