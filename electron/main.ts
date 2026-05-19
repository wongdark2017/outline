import fs from "node:fs";
import path from "node:path";
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  shell,
  type MenuItemConstructorOptions,
} from "electron";

interface DesktopConfig {
  appUrl?: string;
  customOrigins: string[];
}

interface NavigationState {
  canGoBack: boolean;
  canGoForward: boolean;
}

const appName = "Outline";
const protocolScheme = "outline";
const defaultProductionUrl = "https://app.getoutline.com";
const retryDelayMs = 1000;
const maxDevelopmentRetries = 120;
const allowedOrigins = new Set<string>();

let mainWindow: BrowserWindow | undefined;
let config: DesktopConfig = {
  customOrigins: [],
};
let loadRetry: NodeJS.Timeout | undefined;
let pendingProtocolUrl: string | undefined;

app.setName(appName);

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
}

app.on("second-instance", (_event, commandLine) => {
  const protocolUrl = findProtocolUrl(commandLine);

  if (protocolUrl) {
    handleProtocolUrl(protocolUrl);
    return;
  }

  focusMainWindow();
});

app.on("open-url", (event, url) => {
  event.preventDefault();

  if (!app.isReady()) {
    pendingProtocolUrl = url;
    return;
  }

  handleProtocolUrl(url);
});

app.whenReady().then(() => {
  app.setAsDefaultProtocolClient(protocolScheme);

  config = readConfig();
  for (const origin of config.customOrigins) {
    allowedOrigins.add(origin);
  }

  const initialAppUrl = getInitialAppUrl();
  allowedOrigins.add(initialAppUrl.origin);

  createMainWindow(initialAppUrl);
  registerIpcHandlers();
  setApplicationMenu();

  const launchProtocolUrl = pendingProtocolUrl ?? findProtocolUrl(process.argv);
  if (launchProtocolUrl) {
    handleProtocolUrl(launchProtocolUrl);
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length) {
    focusMainWindow();
    return;
  }

  createMainWindow(getInitialAppUrl());
});

app.on("window-all-closed", () => {
  if (process.platform === "darwin") {
    return;
  }

  app.quit();
});

function createMainWindow(initialUrl: URL) {
  const iconPath = getAssetPath("icon.png");

  mainWindow = new BrowserWindow({
    backgroundColor: "#ffffff",
    height: 900,
    icon: iconPath,
    minHeight: 600,
    minWidth: 800,
    show: false,
    title: appName,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
      sandbox: true,
      spellcheck: true,
    },
    width: 1280,
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.on("focus", () => {
    mainWindow?.webContents.send("desktop:focus");
  });

  mainWindow.on("blur", () => {
    mainWindow?.webContents.send("desktop:blur");
  });

  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const parsed = parseHttpUrl(url);

    if (parsed && allowedOrigins.has(parsed.origin)) {
      navigateTo(parsed);
      return { action: "deny" };
    }

    openExternalUrl(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    handleExternalNavigation(event, url);
  });

  mainWindow.webContents.on("will-redirect", (event, url) => {
    handleExternalNavigation(event, url);
  });

  mainWindow.webContents.on("did-navigate", sendNavigationState);
  mainWindow.webContents.on("did-navigate-in-page", sendNavigationState);
  mainWindow.webContents.on("did-finish-load", sendNavigationState);

  loadUrlWithRetry(initialUrl);
}

function registerIpcHandlers() {
  ipcMain.on("desktop:get-version", (event) => {
    event.returnValue = app.getVersion();
  });

  ipcMain.handle("desktop:restart", () => {
    app.relaunch();
    app.exit(0);
  });

  ipcMain.handle("desktop:restart-and-install", () => {
    app.relaunch();
    app.exit(0);
  });

  ipcMain.handle("desktop:check-for-updates", () => undefined);

  ipcMain.handle("desktop:titlebar-double-click", () => {
    toggleMaximize();
  });

  ipcMain.handle("desktop:logout", () => {
    setNotificationCount(0);
  });

  ipcMain.handle("desktop:add-custom-host", (_event, host: string) => {
    const origin = normalizeOrigin(host);

    if (!origin) {
      return;
    }

    allowedOrigins.add(origin);
    config.customOrigins = Array.from(
      new Set([...config.customOrigins, origin])
    );
    writeConfig(config);
  });

  ipcMain.handle(
    "desktop:set-spellchecker-languages",
    (_event, languages: string[]) => {
      const normalizedLanguages = languages.filter((language) =>
        /^[a-z]{2,3}(-[A-Z]{2})?$/.test(language)
      );

      if (!normalizedLanguages.length) {
        return;
      }

      mainWindow?.webContents.session.setSpellCheckerLanguages(
        normalizedLanguages
      );
    }
  );

  ipcMain.handle(
    "desktop:set-notification-count",
    (_event, count: number | string) => {
      setNotificationCount(count);
    }
  );

  ipcMain.on("desktop:go-back", () => {
    goBack();
  });

  ipcMain.on("desktop:go-forward", () => {
    goForward();
  });
}

function setApplicationMenu() {
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin"
      ? [
          {
            label: appName,
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          } satisfies MenuItemConstructorOptions,
        ]
      : []),
    {
      label: "File",
      submenu: [
        process.platform === "darwin"
          ? ({ role: "close" } satisfies MenuItemConstructorOptions)
          : ({ role: "quit" } satisfies MenuItemConstructorOptions),
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ] satisfies MenuItemConstructorOptions[],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ] satisfies MenuItemConstructorOptions[],
    },
    {
      label: "Navigate",
      submenu: [
        {
          accelerator:
            process.platform === "darwin" ? "Command+Left" : "Alt+Left",
          click: goBack,
          label: "Back",
        },
        {
          accelerator:
            process.platform === "darwin" ? "Command+Right" : "Alt+Right",
          click: goForward,
          label: "Forward",
        },
        { type: "separator" },
        {
          accelerator: "CommandOrControl+/",
          click: () => {
            mainWindow?.webContents.send("desktop:open-keyboard-shortcuts");
          },
          label: "Keyboard Shortcuts",
        },
        {
          accelerator: "CommandOrControl+F",
          click: () => {
            mainWindow?.webContents.send("desktop:find-in-page");
          },
          label: "Find",
        },
        {
          accelerator:
            process.platform === "darwin" ? "Command+Alt+F" : "Control+H",
          click: () => {
            mainWindow?.webContents.send("desktop:replace-in-page");
          },
          label: "Replace",
        },
      ] satisfies MenuItemConstructorOptions[],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(process.platform === "darwin"
          ? ([
              { type: "separator" },
              { role: "front" },
              { type: "separator" },
              { role: "window" },
            ] satisfies MenuItemConstructorOptions[])
          : ([{ role: "close" }] satisfies MenuItemConstructorOptions[])),
      ] satisfies MenuItemConstructorOptions[],
    },
    {
      label: "Help",
      submenu: [
        {
          click: () => {
            void shell.openExternal("https://docs.getoutline.com");
          },
          label: "Documentation",
        },
      ] satisfies MenuItemConstructorOptions[],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function getInitialAppUrl(): URL {
  const configuredUrl =
    process.env.OUTLINE_DESKTOP_URL ??
    process.env.URL ??
    config.appUrl ??
    (app.isPackaged
      ? defaultProductionUrl
      : `http://localhost:${process.env.PORT ?? "3000"}`);
  const parsed = parseHttpUrl(configuredUrl);

  if (parsed) {
    return parsed;
  }

  return new URL(defaultProductionUrl);
}

function handleProtocolUrl(input: string) {
  const parsed = parseProtocolUrl(input);

  if (!parsed) {
    focusMainWindow();
    return;
  }

  navigateTo(parsed);
}

function parseProtocolUrl(input: string): URL | undefined {
  let parsed: URL;

  try {
    parsed = new URL(input);
  } catch (_err) {
    return undefined;
  }

  if (parsed.protocol !== `${protocolScheme}:`) {
    return undefined;
  }

  if (!parsed.host) {
    return getInitialAppUrl();
  }

  const origin = getOriginForHost(parsed.host);
  return new URL(`${parsed.pathname}${parsed.search}${parsed.hash}`, origin);
}

function getOriginForHost(host: string): string {
  for (const origin of allowedOrigins) {
    const parsed = parseHttpUrl(origin);

    if (parsed?.host === host) {
      return parsed.origin;
    }
  }

  const protocol = isLocalHost(host) ? "http" : "https";
  const origin = `${protocol}://${host}`;
  allowedOrigins.add(origin);

  return origin;
}

function navigateTo(url: URL, replace = false) {
  allowedOrigins.add(url.origin);

  if (!mainWindow) {
    createMainWindow(url);
    return;
  }

  if (url.pathname === "/auth/redirect") {
    loadUrlWithRetry(url);
    focusMainWindow();
    return;
  }

  const currentUrl = parseHttpUrl(mainWindow.webContents.getURL());

  if (currentUrl?.origin === url.origin) {
    mainWindow.webContents.send(
      "desktop:redirect",
      `${url.pathname}${url.search}${url.hash}`,
      replace
    );
    focusMainWindow();
    return;
  }

  loadUrlWithRetry(url);
  focusMainWindow();
}

function loadUrlWithRetry(url: URL, attempt = 0) {
  if (!mainWindow) {
    return;
  }

  if (loadRetry) {
    clearTimeout(loadRetry);
    loadRetry = undefined;
  }

  mainWindow.loadURL(url.toString()).catch(() => {
    if (app.isPackaged || attempt >= maxDevelopmentRetries) {
      return;
    }

    loadRetry = setTimeout(() => {
      loadUrlWithRetry(url, attempt + 1);
    }, retryDelayMs);
  });
}

function handleExternalNavigation(event: Electron.Event, url: string) {
  const parsed = parseHttpUrl(url);

  if (!parsed) {
    event.preventDefault();
    return;
  }

  if (allowedOrigins.has(parsed.origin)) {
    return;
  }

  event.preventDefault();
  openExternalUrl(parsed.toString());
}

function openExternalUrl(input: string) {
  const parsed = parseHttpUrl(input);

  if (!parsed) {
    return;
  }

  void shell.openExternal(parsed.toString());
}

function parseHttpUrl(input: string): URL | undefined {
  try {
    const parsed = new URL(input);

    if (!["http:", "https:"].includes(parsed.protocol)) {
      return undefined;
    }

    return parsed;
  } catch (_err) {
    return undefined;
  }
}

function normalizeOrigin(input: string): string | undefined {
  const normalizedInput = /^[a-z][a-z\d+.-]*:\/\//i.test(input)
    ? input
    : `https://${input}`;
  const parsed = parseHttpUrl(normalizedInput);

  return parsed?.origin;
}

function isLocalHost(host: string): boolean {
  const hostname = host.split(":")[0].toLowerCase();
  return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname);
}

function focusMainWindow() {
  if (!mainWindow) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.focus();
}

function goBack() {
  if (!mainWindow?.webContents.canGoBack()) {
    return;
  }

  mainWindow.webContents.goBack();
}

function goForward() {
  if (!mainWindow?.webContents.canGoForward()) {
    return;
  }

  mainWindow.webContents.goForward();
}

function toggleMaximize() {
  if (!mainWindow) {
    return;
  }

  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
    return;
  }

  mainWindow.maximize();
}

function sendNavigationState() {
  if (!mainWindow) {
    return;
  }

  const state: NavigationState = {
    canGoBack: mainWindow.webContents.canGoBack(),
    canGoForward: mainWindow.webContents.canGoForward(),
  };

  mainWindow.webContents.send("desktop:navigation-state-changed", state);
}

function setNotificationCount(count: number | string) {
  if (typeof count === "number") {
    app.setBadgeCount(count);
    return;
  }

  if (process.platform === "darwin" && app.dock) {
    app.dock.setBadge(count);
    return;
  }

  app.setBadgeCount(count ? 1 : 0);
}

function findProtocolUrl(args: string[]): string | undefined {
  return args.find((arg) => arg.startsWith(`${protocolScheme}://`));
}

function getConfigPath(): string {
  return path.join(app.getPath("userData"), "desktop-config.json");
}

function getAssetPath(filename: string): string {
  return path.join(__dirname, "assets", filename);
}

function readConfig(): DesktopConfig {
  try {
    const rawConfig = fs.readFileSync(getConfigPath(), "utf8");
    const parsedConfig: unknown = JSON.parse(rawConfig);

    if (!isRecord(parsedConfig)) {
      return { customOrigins: [] };
    }

    return {
      appUrl:
        typeof parsedConfig.appUrl === "string"
          ? parsedConfig.appUrl
          : undefined,
      customOrigins: Array.isArray(parsedConfig.customOrigins)
        ? parsedConfig.customOrigins.filter(
            (origin) => typeof origin === "string" && !!parseHttpUrl(origin)
          )
        : [],
    };
  } catch (_err) {
    return { customOrigins: [] };
  }
}

function writeConfig(nextConfig: DesktopConfig) {
  fs.mkdirSync(path.dirname(getConfigPath()), { recursive: true });
  fs.writeFileSync(getConfigPath(), JSON.stringify(nextConfig, null, 2));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
