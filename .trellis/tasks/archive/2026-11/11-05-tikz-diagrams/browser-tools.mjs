import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

/**
 * Starts an isolated local Chromium session for actual application acceptance.
 *
 * @param options browser viewport and optional executable path.
 * @returns a small CDP driver; callers must close it in a finally block.
 */
export async function openBrowser(options = {}) {
  const profile = await mkdtemp(resolve(tmpdir(), "outline-tikz-acceptance-"));
  const executable = options.executable || "/root/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome";
  const browser = spawn(executable, [
    "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
    "--hide-scrollbars", "--ignore-certificate-errors", "--no-first-run", "--no-default-browser-check",
    ...(options.blockExternalNetwork ? ["--proxy-server=http://127.0.0.1:1", "--proxy-bypass-list=127.0.0.1;localhost"] : []),
    "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  let log = "";
  browser.stderr.on("data", chunk => { log = (log + chunk.toString()).slice(-3000); });
  const pause = milliseconds => new Promise(resolvePromise => setTimeout(resolvePromise, milliseconds));
  let port;
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try {
      port = Number((await readFile(resolve(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]);
      break;
    } catch {
      if (browser.exitCode !== null) throw new Error(`Chromium exited: ${log}`);
      await pause(100);
    }
  }
  if (!port) { browser.kill(); throw new Error(`Chromium startup timeout: ${log}`); }
  const target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" }).then(response => response.json());
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolvePromise, reject) => { socket.onopen = resolvePromise; socket.onerror = reject; });
  let nextID = 0;
  const pending = new Map();
  const subscribers = new Map();
  const requests = [];
  const responses = [];
  const errors = [];
  const redact = value => String(value).replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted-token]").replace(/([?&](?:token|key|csrf|code)=)[^&\s]+/gi, "$1[redacted]");
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const item = pending.get(message.id);
      if (item) {
        clearTimeout(item.timer);
        pending.delete(message.id);
        if (message.error) item.reject(new Error(JSON.stringify(message.error)));
        else item.resolve(message.result);
      }
      return;
    }
    if (message.method === "Network.requestWillBeSent") requests.push({ id: message.params.requestId, url: redact(message.params.request.url), type: message.params.type });
    if (message.method === "Network.responseReceived") responses.push({ id: message.params.requestId, url: redact(message.params.response.url), status: message.params.response.status, type: message.params.type });
    if (message.method === "Runtime.exceptionThrown") errors.push(redact(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text));
    if (message.method === "Log.entryAdded" && message.params.entry.level === "error") errors.push(redact(message.params.entry.text));
    for (const handler of subscribers.get(message.method) || []) handler(message.params);
  };
  const send = (method, params = {}) => new Promise((resolvePromise, reject) => {
    const id = ++nextID;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 30000);
    pending.set(id, { resolve: resolvePromise, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(redact(result.exceptionDetails.exception?.description || result.exceptionDetails.text));
    return result.result.value;
  };
  const event = (name, timeout = 30000) => new Promise((resolvePromise, reject) => {
    const handler = value => {
      clearTimeout(timer);
      subscribers.set(name, (subscribers.get(name) || []).filter(item => item !== handler));
      resolvePromise(value);
    };
    const timer = setTimeout(() => {
      subscribers.set(name, (subscribers.get(name) || []).filter(item => item !== handler));
      reject(new Error(`Event timeout: ${name}`));
    }, timeout);
    subscribers.set(name, [...(subscribers.get(name) || []), handler]);
  });
  const navigate = async url => {
    const loaded = event("Page.loadEventFired");
    const result = await send("Page.navigate", { url });
    if (result.errorText) throw new Error(result.errorText);
    await loaded;
  };
  const waitFor = async (expression, timeout = 45000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      try { if (await evaluate(`Boolean(${expression})`)) return; } catch { /* Navigation can replace the execution context. */ }
      await pause(150);
    }
    throw new Error(`Condition timeout: ${expression.slice(0, 180)}`);
  };
  const click = async selector => {
    const box = await evaluate(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); if(!e)return null; e.scrollIntoView({block:'nearest',inline:'nearest'}); const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
    if (!box) throw new Error(`Missing click target: ${selector}`);
    await send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, x: box.x, y: box.y });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, x: box.x, y: box.y });
  };
  const key = async (keyName, code, modifiers = 0) => {
    const codes = { Enter: 13, Escape: 27, Tab: 9, End: 35, Home: 36, ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39, Backspace: 8, Delete: 46, a: 65, z: 90 };
    const windowsVirtualKeyCode = codes[keyName] || 0;
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: keyName, code: code || keyName, windowsVirtualKeyCode, modifiers, ...(keyName === "Enter" ? { text: "\r" } : {}) });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: keyName, code: code || keyName, modifiers });
  };
  const screenshot = async path => {
    await evaluate("document.fonts.ready.then(() => Promise.all([...document.querySelectorAll('[role=\"dialog\"] img[alt=\"预览\"]')].map(image => image.decode().catch(() => undefined)))).then(() => new Promise(resolvePromise => requestAnimationFrame(() => requestAnimationFrame(resolvePromise))))");
    const result = await send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
    await writeFile(path, Buffer.from(result.data, "base64"));
  };
  const close = async () => {
    socket.close();
    browser.kill("SIGTERM");
    await pause(200);
    if (browser.exitCode === null) browser.kill("SIGKILL");
    await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Log.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: options.width || 1440, height: options.height || 1000, deviceScaleFactor: options.dpr || 1, mobile: false });
  const on = (name, handler) => {
    subscribers.set(name, [...(subscribers.get(name) || []), handler]);
    return () => subscribers.set(name, (subscribers.get(name) || []).filter(item => item !== handler));
  };
  return { send, evaluate, navigate, waitFor, click, key, screenshot, close, requests, responses, errors, pause, on };
}
