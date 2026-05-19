import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";

interface NavigationState {
  canGoBack: boolean;
  canGoForward: boolean;
}

interface DesktopBridge {
  platform: NodeJS.Platform;
  version: () => string;
  restart: () => Promise<void>;
  restartAndInstall: () => Promise<void>;
  checkForUpdates: () => Promise<void>;
  onTitlebarDoubleClick: () => Promise<void>;
  onLogout: () => Promise<void>;
  addCustomHost: (host: string) => Promise<void>;
  setSpellCheckerLanguages: (languages: string[]) => Promise<void>;
  setNotificationCount: (count: number | string) => Promise<void>;
  focus: (callback: () => void) => void;
  blur: (callback: () => void) => void;
  redirect: (callback: (path: string, replace: boolean) => void) => void;
  updateDownloaded: (callback: () => void) => void;
  openKeyboardShortcuts: (callback: () => void) => void;
  goBack: () => void;
  goForward: () => void;
  onNavigationStateChanged: (
    callback: (state: NavigationState) => void
  ) => () => void;
  onFindInPage: (callback: () => void) => void;
  onReplaceInPage: (callback: () => void) => void;
}

const bridge: DesktopBridge = {
  platform: process.platform,
  version: () => ipcRenderer.sendSync("desktop:get-version"),
  restart: async () => {
    await ipcRenderer.invoke("desktop:restart");
  },
  restartAndInstall: async () => {
    await ipcRenderer.invoke("desktop:restart-and-install");
  },
  checkForUpdates: async () => {
    await ipcRenderer.invoke("desktop:check-for-updates");
  },
  onTitlebarDoubleClick: async () => {
    await ipcRenderer.invoke("desktop:titlebar-double-click");
  },
  onLogout: async () => {
    await ipcRenderer.invoke("desktop:logout");
  },
  addCustomHost: async (host: string) => {
    await ipcRenderer.invoke("desktop:add-custom-host", host);
  },
  setSpellCheckerLanguages: async (languages: string[]) => {
    await ipcRenderer.invoke("desktop:set-spellchecker-languages", languages);
  },
  setNotificationCount: async (count: number | string) => {
    await ipcRenderer.invoke("desktop:set-notification-count", count);
  },
  focus: (callback: () => void) => {
    ipcRenderer.on("desktop:focus", () => callback());
  },
  blur: (callback: () => void) => {
    ipcRenderer.on("desktop:blur", () => callback());
  },
  redirect: (callback: (path: string, replace: boolean) => void) => {
    ipcRenderer.on(
      "desktop:redirect",
      (_event: IpcRendererEvent, path: string, replace: boolean) => {
        callback(path, replace);
      }
    );
  },
  updateDownloaded: (callback: () => void) => {
    ipcRenderer.on("desktop:update-downloaded", () => callback());
  },
  openKeyboardShortcuts: (callback: () => void) => {
    ipcRenderer.on("desktop:open-keyboard-shortcuts", () => callback());
  },
  goBack: () => {
    ipcRenderer.send("desktop:go-back");
  },
  goForward: () => {
    ipcRenderer.send("desktop:go-forward");
  },
  onNavigationStateChanged: (callback: (state: NavigationState) => void) => {
    const listener = (_event: IpcRendererEvent, state: NavigationState) => {
      callback(state);
    };
    ipcRenderer.on("desktop:navigation-state-changed", listener);

    return () => {
      ipcRenderer.removeListener("desktop:navigation-state-changed", listener);
    };
  },
  onFindInPage: (callback: () => void) => {
    ipcRenderer.on("desktop:find-in-page", () => callback());
  },
  onReplaceInPage: (callback: () => void) => {
    ipcRenderer.on("desktop:replace-in-page", () => callback());
  },
};

contextBridge.exposeInMainWorld("DesktopBridge", bridge);
