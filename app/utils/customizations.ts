import type {
  CustomizationBackground,
  CustomizationBackgroundFit,
  CustomizationScript,
  CustomizationsInfo,
} from "@shared/types/customizations";

/**
 * Checks the recovery flag before any customization or cached code executes.
 *
 * @param search the current location search string.
 * @returns true when all customization effects must be bypassed.
 */
export function isCustomizationRecoveryRequested(search: string): boolean {
  return new URLSearchParams(search).get("disableCustomizations") === "1";
}

/**
 * Creates an application-relative recovery URL without dropping other fields.
 *
 * @param location the pathname, query, and hash of the location to recover.
 * @returns the location with the recovery flag enabled.
 */
export function getCustomizationRecoveryUrl(location: {
  pathname: string;
  search: string;
  hash: string;
}): string {
  const params = new URLSearchParams(location.search);
  params.set("disableCustomizations", "1");
  return `${location.pathname}?${params.toString()}${location.hash}`;
}

/**
 * Resolves the independent personal background override or workspace default.
 *
 * @param info the current authorized customization response.
 * @returns the background selected independently of the color theme.
 */
export function getCustomizationBackground(
  info: CustomizationsInfo
): CustomizationBackground {
  return info.personal.background.source === "personal"
    ? info.personal.background
    : info.workspace.background;
}

/**
 * Returns a script only when both server policy and exact consent match.
 *
 * @param info the fresh authorized customization response.
 * @returns the consented current revision, or null without authorization.
 */
export function getEnabledCustomizationScript(
  info: CustomizationsInfo
): CustomizationScript | null {
  const { script } = info.workspace;

  if (
    !info.scriptsAllowed ||
    !info.scriptEnabled ||
    !script ||
    info.personal.enabledScriptId !== script.id ||
    info.personal.enabledScriptDigest !== script.digest
  ) {
    return null;
  }

  return script;
}

/** The saved appearance effects owned by the authenticated application. */
export interface CustomizationStyleState {
  backgroundUrl?: string;
  backgroundFit: CustomizationBackgroundFit;
  workspaceCss: string;
  personalCss: string;
}

/**
 * Owns screen-only customization styles and keeps personal CSS after workspace
 * CSS, including when lazy styled-components insert another base stylesheet.
 */
export class CustomizationStyleManager {
  constructor(ownerDocument: Document) {
    this.document = ownerDocument;
    this.base = this.createStyle("background");
    this.workspace = this.createStyle("workspace");
    this.personal = this.createStyle("personal");
    this.observer = new MutationObserver(() => this.ensureOrder());
    this.observer.observe(ownerDocument.head, { childList: true });
  }

  /**
   * Applies saved appearance without changing script consent or execution.
   *
   * @param state the independent background and ordered CSS source documents.
   */
  apply(state: CustomizationStyleState): void {
    this.active = true;
    this.setText(this.workspace, state.workspaceCss);
    this.setText(this.personal, state.personalCss);

    if (state.backgroundUrl) {
      this.removeRootBackground();
      this.document.body.setAttribute(
        "data-outline-customization-background",
        ""
      );
      this.document.body.style.setProperty(
        "--outline-customization-background-image",
        `url(${JSON.stringify(state.backgroundUrl)})`
      );
      this.document.body.style.setProperty(
        "--outline-customization-background-size",
        state.backgroundFit === "repeat" ? "auto" : state.backgroundFit
      );
      this.document.body.style.setProperty(
        "--outline-customization-background-repeat",
        state.backgroundFit === "repeat" ? "repeat" : "no-repeat"
      );
      this.setText(this.base, backgroundStyles);
    } else {
      this.clearBackground();
      this.setText(this.base, "");
    }

    this.ensureOrder();
  }

  /** Removes all appearance effects while retaining the manager for recovery. */
  clear(): void {
    this.active = false;
    this.base.remove();
    this.workspace.remove();
    this.personal.remove();
    this.clearBackground();
  }

  /** Removes owned DOM nodes and disconnects base-stylesheet observation. */
  dispose(): void {
    this.observer.disconnect();
    this.clear();
  }

  private document: Document;

  private base: HTMLStyleElement;

  private workspace: HTMLStyleElement;

  private personal: HTMLStyleElement;

  private observer: MutationObserver;

  private active = false;

  private rootBackground?: RootBackground;

  private createStyle(scope: string): HTMLStyleElement {
    const element = this.document.createElement("style");
    element.dataset.outlineCustomization = scope;
    element.media = "screen";
    return element;
  }

  private setText(element: HTMLStyleElement, source: string): void {
    if (element.textContent !== source) {
      element.textContent = source;
    }
  }

  private ensureOrder(): void {
    if (!this.active || this.document.head.lastElementChild === this.personal) {
      return;
    }

    this.document.head.append(this.base, this.workspace, this.personal);
  }

  private clearBackground(): void {
    this.restoreRootBackground();
    this.document.body.removeAttribute("data-outline-customization-background");
    for (const name of [
      "--outline-customization-background-image",
      "--outline-customization-background-size",
      "--outline-customization-background-repeat",
    ]) {
      this.document.body.style.removeProperty(name);
    }
  }

  private removeRootBackground(): void {
    if (this.rootBackground) {
      return;
    }

    const element = this.document.getElementById("root");
    if (!element) {
      return;
    }

    const value = element.style.getPropertyValue("background");
    this.rootBackground = {
      element,
      value,
      priority: element.style.getPropertyPriority("background"),
    };

    // The startup shorthand covers the image painted on the body. Only remove
    // that shorthand, preserving independently authored background longhands.
    if (value) {
      element.style.removeProperty("background");
    }
  }

  private restoreRootBackground(): void {
    const background = this.rootBackground;
    this.rootBackground = undefined;

    if (
      !background?.value ||
      Array.from(background.element.style).some(
        (property) =>
          property === "background" || property.startsWith("background-")
      )
    ) {
      return;
    }

    background.element.style.setProperty(
      "background",
      background.value,
      background.priority
    );
  }
}

interface RootBackground {
  element: HTMLElement;
  value: string;
  priority: string;
}

const backgroundStyles = `
  body[data-outline-customization-background] {
    --outline-customization-layout-background: transparent;
    --outline-customization-background-overlay: color-mix(in srgb, var(--outline-customization-surface, Canvas) 92%, transparent);
    background-image:
      linear-gradient(var(--outline-customization-background-overlay), var(--outline-customization-background-overlay)),
      var(--outline-customization-background-image);
    background-position: center;
    background-size: var(--outline-customization-background-size);
    background-repeat: var(--outline-customization-background-repeat);
    background-attachment: fixed;
  }
  :where(body[data-outline-customization-background]) [data-outline-part="content"] {
    background: transparent;
  }
`;
