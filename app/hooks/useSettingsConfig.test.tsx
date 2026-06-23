import { ThemeProvider } from "styled-components";
import * as React from "react";
import * as ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { light } from "@shared/styles/theme";
import type { ConfigItem } from "./useSettingsConfig";

const mocks = vi.hoisted(() => ({
  currentTeam: { id: "team-id" },
  currentUser: {
    id: "user-id",
    isSystemAdmin: false,
  },
  integrations: {
    fetchAll: vi.fn(),
  },
  policy: {
    createApiKey: false,
    createExport: false,
    createImport: false,
    listApiKeys: false,
    listGroups: false,
    listOAuthClients: false,
    listShares: false,
    listUsers: false,
    readTemplate: false,
    update: false,
  },
}));

vi.mock("~/components/LazyLoad", () => ({
  createLazyComponent: () => ({
    Component: () => null,
    preload: vi.fn(),
  }),
}));

vi.mock("~/hooks/useCurrentTeam", () => ({
  default: () => mocks.currentTeam,
}));

vi.mock("~/hooks/useCurrentUser", () => ({
  default: () => mocks.currentUser,
}));

vi.mock("~/hooks/usePolicy", () => ({
  default: () => mocks.policy,
}));

vi.mock("~/hooks/useStores", () => ({
  default: () => ({
    integrations: mocks.integrations,
  }),
}));

vi.mock("~/utils/PluginManager", () => ({
  Hook: {
    Settings: "Settings",
  },
  PluginManager: {
    getHooks: () => [],
  },
}));

import useSettingsConfig from "./useSettingsConfig";

describe("useSettingsConfig", () => {
  let container: HTMLDivElement;
  let renderedConfig: ConfigItem[] = [];

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    renderedConfig = [];
    mocks.integrations.fetchAll.mockReset();
    mocks.currentUser = {
      id: "user-id",
      isSystemAdmin: false,
    };
  });

  afterEach(() => {
    ReactDOM.unmountComponentAtNode(container);
    container.remove();
  });

  async function renderHook() {
    function TestComponent() {
      renderedConfig = useSettingsConfig();
      return null;
    }

    await act(async () => {
      ReactDOM.render(
        <ThemeProvider theme={light}>
          <TestComponent />
        </ThemeProvider>,
        container
      );
      await Promise.resolve();
    });
  }

  it("shows System Info only to system admins", async () => {
    await renderHook();

    expect(renderedConfig.some((item) => item.name === "System Info")).toBe(
      false
    );

    ReactDOM.unmountComponentAtNode(container);
    mocks.currentUser = {
      id: "user-id",
      isSystemAdmin: true,
    };

    await renderHook();

    expect(renderedConfig.some((item) => item.name === "System Info")).toBe(
      true
    );
  });
});
