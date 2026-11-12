# SDK 0.18.1 SVG 场景往返验证

日期：2026-11-12。测试浏览器：本机缓存 Chromium Headless 1248。React peer range 为 `^17.0.2 || ^18.2.0 || ^19.0.0`，项目使用 React 19。SDK 的 `browserslist.production` 包含 Safari 12+、Edge 79+、Chrome 70+ 等下限；产品验收仍需真实 Safari/iOS 与 Electron 操作。

## 可复现的浏览器探针

在仓库根目录构建一个临时浏览器模块：

```sh
node_modules/.bin/esbuild node_modules/@excalidraw/excalidraw/dist/prod/index.js --bundle --platform=browser --format=esm --outfile=/tmp/excalidraw-probe.mjs --loader:.css=empty
```

创建 `/tmp/excalidraw-probe.html`，其中的 `type="module"` 脚本如下，再用文件访问权限运行 Chromium：

```js
import { convertToExcalidrawElements, exportToSvg, loadFromBlob } from "./excalidraw-probe.mjs";
const elements = convertToExcalidrawElements([
  { type: "rectangle", x: 10, y: 20, width: 80, height: 60 },
  { type: "image", x: 100, y: 20, width: 20, height: 20, fileId: "file1" },
]);
const files = {
  file1: {
    id: "file1",
    mimeType: "image/png",
    dataURL: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/ct8AAAAASUVORK5CYII=",
    created: Date.now(),
    lastRetrieved: Date.now(),
  },
};
const svg = await exportToSvg({
  elements,
  appState: { exportEmbedScene: true, exportWithDarkMode: false },
  files,
});
const serialized = new XMLSerializer().serializeToString(svg);
const url = URL.createObjectURL(new Blob([serialized], { type: "image/svg+xml" }));
const downloaded = await fetch(url, { cache: "no-store" }).then((response) => response.blob());
const restored = await loadFromBlob(downloaded, null, null);
document.getElementById("result").textContent = JSON.stringify({
  ok: restored.elements.length === 2 && restored.elements[0].id === elements[0].id && !!restored.files.file1,
  metadata: serialized.includes("excalidraw"),
  size: downloaded.size,
  fileCount: Object.keys(restored.files).length,
});
```

```sh
/root/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell --no-sandbox --disable-gpu --allow-file-access-from-files --dump-dom --virtual-time-budget=30000 file:///tmp/excalidraw-probe.html
```

结果：`{"ok":true,"metadata":true,"size":2495,"fileCount":1}`。导出 SVG 经 Blob URL 下载后可恢复两个元素和内嵌图片。Blob URL 只模拟附件取回；当前本机没有运行中的 Outline 服务或已认证附件端点，因此未实测 `attachments.create` 的网络上传/下载。SDK 在 Vitest/jsdom 中直接执行会受 `open-color` JSON import attribute 与未实现的 canvas API 阻挡，本验证使用真实浏览器。

## 构建资源验证

`yarn vite:build` 成功。构建产物包含独立的 `ExcalidrawEditor.*.js`（约 527 KB）和 `ExcalidrawEditor.*.css`（约 142 KB）。service worker 的预缓存清单中均没有这两个资源。字体从 `server/static/excalidraw/fonts` 复制到 `build/app/excalidraw/fonts`，共有 234 个 `.woff2` 文件；画布代码在打开后才设置 `EXCALIDRAW_ASSET_PATH`。尚未执行浏览器网络首屏录制和固定场景的交互延迟测量。
