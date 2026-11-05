import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const chromePath =
  process.env.TIKZ_UI_CHROME ||
  "/root/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome";
const pause = (milliseconds) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
const profile = await mkdtemp(resolve(tmpdir(), "outline-tikz-ui-"));
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".png": "image/png",
  ".json": "application/json",
};
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(
      new URL(request.url, "http://local").pathname
    );
    const target = resolve(root, `.${pathname}`);
    if (!target.startsWith(root + sep)) {
      response.writeHead(403).end();
      return;
    }
    const contents = await readFile(target);
    response.writeHead(200, {
      "Content-Type": mimeTypes[extname(target)] || "text/plain",
    });
    response.end(contents);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolvePromise) =>
  server.listen(0, "127.0.0.1", resolvePromise)
);
const baseURL = `http://127.0.0.1:${server.address().port}`;
const preflight = await fetch(`${baseURL}/ui-preview.html`).then((response) =>
  response.text()
);
if (!preflight.includes("TikZ 界面设计预览 · Outline")) {
  server.close();
  throw new Error("Preview identity check failed");
}

const browser = spawn(
  chromePath,
  [
    "--headless=new",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "pipe"] }
);
let browserLog = "";
browser.stderr.on("data", (chunk) => {
  browserLog = (browserLog + chunk.toString()).slice(-4000);
});
let socket;
const report = {
  scope: "Static design prototype; no TeX compilation or attachment upload",
  captures: [],
  checks: [],
};
const check = (condition, label) => {
  if (!condition) throw new Error(label);
  report.checks.push(label);
};

try {
  let debugPort;
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try {
      debugPort = Number(
        (await readFile(resolve(profile, "DevToolsActivePort"), "utf8")).split(
          "\n"
        )[0]
      );
      break;
    } catch {
      if (browser.exitCode !== null)
        throw new Error(`Browser exited: ${browserLog}`);
      await pause(100);
    }
  }
  if (!debugPort) throw new Error(`Browser startup timed out: ${browserLog}`);
  const target = await fetch(
    `http://127.0.0.1:${debugPort}/json/new?about:blank`,
    { method: "PUT" }
  ).then((response) => response.json());
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolvePromise, reject) => {
    socket.onopen = resolvePromise;
    socket.onerror = reject;
  });
  let nextID = 0;
  const pending = new Map();
  const subscribers = new Map();
  const requests = [];
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const waiter = pending.get(message.id);
      if (waiter) {
        clearTimeout(waiter.timer);
        pending.delete(message.id);
        if (message.error)
          waiter.reject(new Error(JSON.stringify(message.error)));
        else waiter.resolve(message.result);
      }
      return;
    }
    if (message.method === "Network.requestWillBeSent")
      requests.push(message.params.request.url);
    const handlers = subscribers.get(message.method) || [];
    handlers.forEach((handler) => handler(message.params));
  };
  const send = (method, params = {}) =>
    new Promise((resolvePromise, reject) => {
      const id = ++nextID;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 15000);
      pending.set(id, { resolve: resolvePromise, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const event = (name) =>
    new Promise((resolvePromise, reject) => {
      const handler = (value) => {
        clearTimeout(timer);
        subscribers.set(
          name,
          (subscribers.get(name) || []).filter((item) => item !== handler)
        );
        resolvePromise(value);
      };
      const timer = setTimeout(() => {
        subscribers.set(
          name,
          (subscribers.get(name) || []).filter((item) => item !== handler)
        );
        reject(new Error(`Event timeout: ${name}`));
      }, 15000);
      subscribers.set(name, [...(subscribers.get(name) || []), handler]);
    });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails)
      throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");

  const cases = [
    ["01-slash", "slash", 1440, 1000, 1],
    ["02-editor", "editor", 1440, 1000, 1],
    ["03-error", "error", 1440, 1000, 1],
    ["04-image", "image", 1440, 1000, 1],
    ["05-lightbox", "lightbox", 1440, 1000, 1],
    ["06-dark", "dark", 1440, 1000, 1],
    ["07-mobile", "editor", 390, 844, 2],
    ["08-mobile-error", "error", 390, 844, 2],
    ["09-source-error", "source-error", 1440, 1000, 1],
    ["10-dark-image", "dark-image", 1440, 1000, 1],
    ["11-readonly", "readonly", 1440, 1000, 1],
    ["12-loading", "loading", 1440, 1000, 1],
    ["13-saving", "saving", 1440, 1000, 1],
    ["14-save-error", "save-error", 1440, 1000, 1],
    ["15-timeout", "timeout", 1440, 1000, 1],
    ["16-mobile-narrow", "error", 320, 736, 2],
  ];

  for (const [name, screen, width, height, dpr] of cases) {
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: dpr,
      mobile: width <= 736,
    });
    const loaded = event("Page.loadEventFired");
    await send("Page.navigate", {
      url: `${baseURL}/ui-preview.html?screen=${screen}`,
    });
    await loaded;
    await evaluate("document.fonts.ready.then(() => true)");
    await pause(100);
    const measurements = await evaluate(`(() => {
      const bounds = (selector) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const { x, y, width, height, right, bottom } = element.getBoundingClientRect();
        return { x, y, width, height, right, bottom };
      };
      return {
        title: document.title,
        url: location.href,
        screen: document.body.dataset.screen,
        viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
        overflow: document.documentElement.scrollWidth > innerWidth,
        modal: bounds('.modal'), panels: bounds('.panels'), save: bounds('#save'),
        error: bounds('.error-region'), footer: bounds('.modal-footer'),
        errorText: document.querySelector('.error-hint')?.textContent,
        saveDisabled: document.querySelector('#save')?.disabled,
        saveText: document.querySelector('#save')?.textContent,
        focus: document.activeElement.id,
        previewBackground: document.querySelector('.preview-area') && getComputedStyle(document.querySelector('.preview-area')).backgroundColor,
        editButtons: document.querySelectorAll('[aria-label="编辑 TikZ"]').length,
        imageFilter: document.querySelector('.document-figure .graph') && getComputedStyle(document.querySelector('.document-figure .graph')).filter,
        sourceText: document.querySelector('#source')?.textContent,
      };
    })()`);
    check(
      measurements.title === "TikZ 界面设计预览 · Outline",
      `${name}: correct page identity`
    );
    check(
      measurements.viewport.width === width &&
        measurements.viewport.height === height &&
        measurements.viewport.dpr === dpr,
      `${name}: viewport and DPR match`
    );
    check(!measurements.overflow, `${name}: no page horizontal overflow`);
    if (measurements.modal) {
      check(
        measurements.save.bottom <= height + 1 &&
          measurements.save.right <= width + 1 &&
          measurements.save.y >= 0,
        `${name}: Save remains visible`
      );
      check(
        measurements.footer.bottom <= height + 1,
        `${name}: footer remains visible`
      );
      check(
        measurements.focus === "source",
        `${name}: code panel receives initial focus`
      );
      check(
        measurements.previewBackground === "rgb(255, 255, 255)",
        `${name}: preview stays white`
      );
      check(
        measurements.saveDisabled === !["editor", "dark"].includes(screen),
        `${name}: correct Save state`
      );
      if (measurements.error) {
        check(
          measurements.error.height <= 120 + 1 &&
            measurements.error.y >= measurements.panels.bottom - 1 &&
            measurements.error.bottom <= measurements.footer.y + 1,
          `${name}: inline error position and 120px cap`
        );
      }
    }
    if (screen === "source-error")
      check(
        !measurements.sourceText.includes("tikzpicture"),
        `${name}: no default source after load failure`
      );
    if (screen === "readonly")
      check(
        measurements.editButtons === 0,
        `${name}: no edit action for readers`
      );
    if (["image", "lightbox", "dark-image"].includes(screen))
      check(measurements.editButtons === 1, `${name}: one TikZ edit action`);
    if (screen === "dark-image")
      check(
        measurements.imageFilter.includes("invert(1)"),
        `${name}: dark image filter is scoped`
      );
    const screenshot = await send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    });
    await writeFile(
      resolve(root, `${name}.png`),
      Buffer.from(screenshot.data, "base64")
    );
    report.captures.push({
      file: `${name}.png`,
      ...measurements,
      screenshot: {
        full_page: false,
        screenshot_scale: "device",
        expectedWidth: width * dpr,
        expectedHeight: height * dpr,
      },
    });
    console.log(`Captured ${name}.png (${width}×${height}, DPR ${dpr})`);
  }

  await evaluate("setScreen('image')");
  await evaluate(
    "document.querySelector('.image-toolbar [data-screen=editor]').click()"
  );
  check(
    await evaluate("document.body.dataset.screen === 'editor'"),
    "Prototype toolbar opens editor state"
  );
  await evaluate("document.querySelector('#save').click()");
  check(
    await evaluate(
      "document.body.dataset.screen === 'saving' && document.querySelector('#save').disabled"
    ),
    "Prototype Save switches to saving state without uploading"
  );
  await send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
  });
  check(
    await evaluate(
      "document.body.dataset.screen === 'image' && !document.querySelector('.modal')"
    ),
    "Prototype Escape closes the dialog"
  );
  check(
    requests.every((url) => url.startsWith(baseURL)),
    "Prototype sends no external network request"
  );
  report.checkCount = report.checks.length;
  report.browser = (await send("Browser.getVersion")).product;
  await writeFile(
    resolve(root, "capture.json"),
    JSON.stringify(report, null, 2) + "\n"
  );
  console.log(
    `PASS: ${report.captures.length} captures and ${report.checkCount} prototype checks`
  );
} finally {
  if (socket) socket.close();
  browser.kill("SIGTERM");
  await new Promise((resolvePromise) => server.close(resolvePromise));
  await pause(200);
  if (browser.exitCode === null) browser.kill("SIGKILL");
  await rm(profile, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100,
  });
}
