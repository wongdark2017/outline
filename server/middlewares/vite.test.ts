import { once } from "node:events";
import http from "node:http";
import https from "node:https";
import { Socket } from "node:net";
import { gzipSync } from "node:zlib";
import Koa from "koa";
import helmet from "koa-helmet";
import WebSocket from "ws";
import env from "@server/env";
import onupgrade, { rejectUnhandledUpgrades } from "@server/onupgrade";
import { server as msw } from "@server/test/msw";
import {
  attachViteHmrProxy,
  createViteMiddleware,
  isViteHmrRequest,
} from "./vite";

const httpRequest = http.request;
const httpsRequest = https.request;
let upstream: http.Server;
let frontend: http.Server;
let websocketServer: WebSocket.Server;
let upstreamPort: number;
let baseURL: string;
let requests: http.IncomingMessage[];
const gzipAsset = gzipSync(Buffer.from("engine-fixture"));

function redirectRequest(original: typeof http.request) {
  return (
    input: http.RequestOptions | string | URL,
    optionsOrCallback?:
      | http.RequestOptions
      | ((response: http.IncomingMessage) => void),
    callback?: (response: http.IncomingMessage) => void
  ) => {
    const listener =
      typeof optionsOrCallback === "function" ? optionsOrCallback : callback;
    if (typeof input === "string" || input instanceof URL) {
      return original(
        input,
        typeof optionsOrCallback === "object" ? optionsOrCallback : {},
        listener
      );
    }
    if (input.hostname === "127.0.0.1" && input.port === 3001) {
      return httpRequest({ ...input, port: upstreamPort }, listener);
    }
    return original(input, listener);
  };
}

beforeAll(async () => {
  msw.close();
  requests = [];
  upstream = http.createServer((request, response) => {
    requests.push(request);
    if (request.url === "/static/unavailable") {
      request.socket.destroy();
      return;
    }
    if (request.url?.split("?")[0].endsWith(".gz")) {
      response.setHeader("Content-Type", "application/octet-stream");
      response.setHeader("Content-Encoding", "gzip");
      response.setHeader("Content-Length", gzipAsset.length);
      response.setHeader("ETag", '"gzip-fixture"');
      response.setHeader("Last-Modified", "Thu, 05 Nov 2026 00:00:00 GMT");
      if (
        request.headers["if-none-match"] === '"gzip-fixture"' ||
        request.headers["if-modified-since"] === "Thu, 05 Nov 2026 00:00:00 GMT"
      ) {
        response.writeHead(304).end();
        return;
      }
      response.end(gzipAsset);
      return;
    }
    response.setHeader("Content-Type", "text/javascript");
    response.setHeader("ETag", '"fixture"');
    response.setHeader("Cache-Control", "no-cache");
    response.setHeader("Set-Cookie", "viteCookie=should-not-reach-browser");
    if (request.headers["if-none-match"] === '"fixture"') {
      response.writeHead(304).end();
      return;
    }
    response.write("export ");
    response.end(`default ${JSON.stringify(request.url)}`);
  });
  websocketServer = new WebSocket.Server({ noServer: true });
  upstream.on("upgrade", (request, socket, head) => {
    requests.push(request);
    websocketServer.handleUpgrade(request, socket, head, (client) => {
      client.send("connected");
      client.on("message", (message) => client.send(message));
    });
  });
  await new Promise<void>((resolve) =>
    upstream.listen(0, "127.0.0.1", resolve)
  );
  const upstreamAddress = upstream.address();
  if (!upstreamAddress || typeof upstreamAddress === "string") {
    throw new Error("Missing test upstream address");
  }
  upstreamPort = upstreamAddress.port;

  const app = new Koa();
  app.use(helmet());
  app.use(createViteMiddleware());
  app.use((ctx) => {
    ctx.body = "application";
  });
  frontend = http.createServer(app.callback());
  onupgrade(frontend);
  attachViteHmrProxy(frontend, ["web"]);
  rejectUnhandledUpgrades(frontend);
  await new Promise<void>((resolve) =>
    frontend.listen(0, "127.0.0.1", resolve)
  );
  const frontendAddress = frontend.address();
  if (!frontendAddress || typeof frontendAddress === "string") {
    throw new Error("Missing test application address");
  }
  baseURL = `http://127.0.0.1:${frontendAddress.port}`;
});

beforeEach(() => {
  requests.length = 0;
  vi.spyOn(env, "isDevelopment", "get").mockReturnValue(true);
  vi.spyOn(http, "request").mockImplementation(redirectRequest(httpRequest));
  vi.spyOn(https, "request").mockImplementation(redirectRequest(httpsRequest));
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const client of websocketServer.clients) {
    client.terminate();
  }
});

afterAll(async () => {
  websocketServer.close();
  await Promise.all([
    new Promise<void>((resolve) => frontend.close(() => resolve())),
    new Promise<void>((resolve) => upstream.close(() => resolve())),
  ]);
  msw.listen({ onUnhandledRequest: "error" });
});

describe("development Vite proxy", () => {
  it("sets a same-origin WebAssembly policy only on the pinned TikZ worker", async () => {
    const worker = await fetch(
      `${baseURL}/static/tikzjax-e374921f/run-tex.js?v=1`
    );
    expect(worker.headers.get("content-security-policy")).toBe(
      "default-src 'none';script-src 'self' 'wasm-unsafe-eval';connect-src 'self'"
    );

    for (const pathname of [
      "/static/tikzjax-e374921f/other.js",
      "/static/tikzjax-e374921f/run-tex.js.map",
      "/static/tikzjax-e374921f/run-tex.js/extra",
      "/static/tikzjax-e374921f-other/run-tex.js",
      "/static/tikzjax-other/run-tex.js",
      "/static/@vite/client",
      "/",
    ]) {
      const response = await fetch(`${baseURL}${pathname}`);
      expect(response.headers.get("content-security-policy")).toContain(
        "script-src 'self';"
      );
      expect(response.headers.get("content-security-policy")).not.toContain(
        "wasm-unsafe-eval"
      );
    }
  });

  it.each(["core.dump.gz", "tex.wasm.gz", "tex_files/pgfplots.sty.gz"])(
    "preserves compressed engine bytes for the browser to read %s",
    async (asset) => {
      const response = await fetch(
        `${baseURL}/static/tikzjax-e374921f/${asset}`
      );
      expect(response.headers.get("content-encoding")).toBeNull();
      expect(response.headers.get("content-length")).toBe(
        String(gzipAsset.length)
      );
      const contents = Buffer.from(await response.arrayBuffer());
      expect(contents.subarray(0, 2)).toEqual(Buffer.from([0x1f, 0x8b]));
      expect(contents).toEqual(gzipAsset);
    }
  );

  it.each(["core.dump.gz", "tex.wasm.gz", "tex_files/pgfplots.sty.gz"])(
    "replaces stale HTTP encoding metadata for %s",
    async (asset) => {
      const response = await fetch(
        `${baseURL}/static/tikzjax-e374921f/${asset}?v=1`,
        {
          headers: {
            "If-None-Match": '"gzip-fixture"',
            "If-Modified-Since": "Thu, 05 Nov 2026 00:00:00 GMT",
          },
        }
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-encoding")).toBeNull();
      expect(Buffer.from(await response.arrayBuffer())).toEqual(gzipAsset);
      expect(requests[0].headers["if-none-match"]).toBeUndefined();
      expect(requests[0].headers["if-modified-since"]).toBeUndefined();
    }
  );

  it("preserves conditional requests outside the pinned engine assets", async () => {
    const response = await fetch(`${baseURL}/static/ordinary.gz`, {
      headers: { "If-None-Match": '"gzip-fixture"' },
    });

    expect(response.status).toBe(304);
    expect(requests[0].headers["if-none-match"]).toBe('"gzip-fixture"');
  });

  it.each([
    "/static/ordinary.gz",
    "/static/tikzjax-e374921f/ordinary.gz",
    "/static/tikzjax-other/core.dump.gz",
    "/static/tikzjax-e374921f-other/core.dump.gz",
  ])(
    "preserves HTTP gzip encoding outside engine assets at %s",
    async (pathname) => {
      const response = await fetch(`${baseURL}${pathname}`);
      expect(response.headers.get("content-encoding")).toBe("gzip");
      expect(response.headers.get("content-length")).toBe(
        String(gzipAsset.length)
      );
      expect(await response.text()).toBe("engine-fixture");
    }
  );

  it("streams JavaScript and preserves queries without forwarding credentials", async () => {
    const response = await fetch(`${baseURL}/static/@vite/client?v=123`, {
      headers: {
        Cookie: "accessToken=private",
        Authorization: "Bearer private",
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/javascript");
    expect(response.headers.get("etag")).toBe('"fixture"');
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.text()).toBe(
      'export default "/static/@vite/client?v=123"'
    );
    expect(requests[0].headers.cookie).toBeUndefined();
    expect(requests[0].headers.authorization).toBeUndefined();
    expect(requests[0].headers.host).toBe(`127.0.0.1:${upstreamPort}`);
  });

  it("preserves conditional caching and HEAD responses", async () => {
    const cached = await fetch(`${baseURL}/static/app/index.tsx`, {
      headers: { "If-None-Match": '"fixture"' },
    });
    expect(cached.status).toBe(304);
    expect(await cached.text()).toBe("");

    const head = await fetch(`${baseURL}/static/app/index.tsx`, {
      method: "HEAD",
    });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-type")).toContain("text/javascript");
    expect(await head.text()).toBe("");
  });

  it("restricts proxy paths and HTTP methods", async () => {
    const app = await fetch(`${baseURL}/api/auth.info`);
    expect(await app.text()).toBe("application");
    const rejected = await fetch(`${baseURL}/static/app/index.tsx`, {
      method: "POST",
    });
    expect(rejected.status).toBe(405);
    expect(rejected.headers.get("allow")).toBe("GET, HEAD");
    expect(requests).toHaveLength(0);
  });

  it("does not proxy production assets or HMR", async () => {
    vi.spyOn(env, "isDevelopment", "get").mockReturnValue(false);
    const response = await fetch(`${baseURL}/static/app/index.tsx`);
    expect(await response.text()).toBe("application");
    expect(requests).toHaveLength(0);
    for (const asset of ["run-tex.js", "core.dump.gz"]) {
      const production = await fetch(
        `${baseURL}/static/tikzjax-e374921f/${asset}`
      );
      expect(await production.text()).toBe("application");
      expect(production.headers.get("content-security-policy")).not.toContain(
        "wasm-unsafe-eval"
      );
    }
  });

  it("returns an explicit bad gateway when Vite is unavailable", async () => {
    const response = await fetch(`${baseURL}/static/unavailable`);
    expect(response.status).toBe(502);
    expect(await response.text()).toContain(
      "Vite development server is unavailable"
    );
  });

  it("tunnels HMR with its token and protocol while removing cookies", async () => {
    const client = new WebSocket(
      `${baseURL.replace("http", "ws")}/static/vite-hmr?token=fixture`,
      "vite-hmr",
      {
        headers: {
          Cookie: "accessToken=private",
          Authorization: "Bearer private",
        },
      }
    );
    const [message] = await once(client, "message");
    expect(String(message)).toBe("connected");
    expect(client.protocol).toBe("vite-hmr");
    expect(requests[0].url).toBe("/static/vite-hmr?token=fixture");
    expect(requests[0].headers.cookie).toBeUndefined();
    expect(requests[0].headers.authorization).toBeUndefined();
    client.send("hot-update");
    const [echo] = await once(client, "message");
    expect(String(echo)).toBe("hot-update");
    client.close();
    await once(client, "close");
  });

  it("rejects unknown upgrades when only the web service is running", async () => {
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(`${baseURL}/unknown`, {
        headers: { Connection: "Upgrade", Upgrade: "websocket" },
      });
      request.once("response", (response) => {
        response.resume();
        resolve(response.statusCode);
      });
      request.once("error", reject);
      request.end();
    });
    expect(status).toBe(400);
  });

  it("recognizes only development HMR upgrades", () => {
    const request = new http.IncomingMessage(new Socket());
    request.method = "GET";
    request.url = "/static/vite-hmr?token=fixture";
    request.headers["sec-websocket-protocol"] = "vite-hmr";
    expect(isViteHmrRequest(request)).toBe(true);
    request.url = "/static/vite-hmr-extra";
    expect(isViteHmrRequest(request)).toBe(false);
    request.url = "/static/vite-hmr";
    request.headers["sec-websocket-protocol"] = "unknown";
    expect(isViteHmrRequest(request)).toBe(false);
    request.headers["sec-websocket-protocol"] = "vite-ping";
    expect(isViteHmrRequest(request)).toBe(true);
    vi.spyOn(env, "isDevelopment", "get").mockReturnValue(false);
    expect(isViteHmrRequest(request)).toBe(false);
  });
});
