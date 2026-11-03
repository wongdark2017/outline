import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import type { Duplex } from "node:stream";
import type { Context, Next } from "koa";
import env from "@server/env";
import { rejectUpgrade } from "@server/onupgrade";

const hmrPath = "/static/vite-hmr";
const requestHeaders = [
  "accept",
  "accept-language",
  "cache-control",
  "if-modified-since",
  "if-none-match",
  "if-range",
  "range",
];
const responseHeaders = [
  "cache-control",
  "content-encoding",
  "content-length",
  "content-range",
  "content-type",
  "etag",
  "last-modified",
  "vary",
];

/**
 * Recognize the dedicated development Vite WebSocket endpoint.
 *
 * @param request the incoming upgrade request.
 * @returns whether Vite owns this request.
 */
export function isViteHmrRequest(request: http.IncomingMessage): boolean {
  const protocol = request.headers["sec-websocket-protocol"];
  return (
    env.isDevelopment &&
    request.method === "GET" &&
    request.url?.split("?")[0] === hmrPath &&
    (protocol === "vite-hmr" || protocol === "vite-ping")
  );
}

/**
 * Stream development assets from the fixed local Vite server.
 *
 * @returns middleware serving Vite assets under the application's origin.
 */
export function createViteMiddleware() {
  const target = getViteTarget();

  return async function viteMiddleware(ctx: Context, next: Next) {
    if (!env.isDevelopment || !ctx.path.startsWith("/static/")) {
      return next();
    }

    if (ctx.method !== "GET" && ctx.method !== "HEAD") {
      ctx.status = 405;
      ctx.set("Allow", "GET, HEAD");
      return;
    }

    try {
      const response = await new Promise<http.IncomingMessage>(
        (resolve, reject) => {
          const request = target.request(
            {
              ...target.options,
              path: ctx.req.url,
              method: ctx.method,
              headers: copyHeaders(ctx.req.headers, requestHeaders),
            },
            resolve
          );
          request.once("error", reject);
          request.setTimeout(30_000, () =>
            request.destroy(new Error("Vite request timed out"))
          );
          ctx.res.once("close", () => request.destroy());
          request.end();
        }
      );

      ctx.status = response.statusCode ?? 502;
      for (const [name, value] of Object.entries(
        copyHeaders(response.headers, responseHeaders)
      )) {
        if (value !== undefined) {
          ctx.set(name, value);
        }
      }
      ctx.body = response;
    } catch {
      ctx.status = 502;
      ctx.type = "text/plain";
      ctx.body = "The local Vite development server is unavailable.";
    }
  };
}

/**
 * Forward Vite WebSocket upgrades without exposing a second browser port.
 *
 * @param server the application HTTP server.
 * @param serviceNames the enabled application services.
 */
export function attachViteHmrProxy(
  server: http.Server,
  serviceNames: string[]
) {
  const target = getViteTarget();
  const hasWebSocketService = serviceNames.some(
    (name) => name === "collaboration" || name === "websockets"
  );

  server.on(
    "upgrade",
    (request: http.IncomingMessage, socket: Duplex, head: Buffer) => {
      if (!isViteHmrRequest(request)) {
        if (!hasWebSocketService) {
          rejectUpgrade(socket);
        }
        return;
      }

      const upstream = target.request({
        ...target.options,
        path: request.url,
        method: "GET",
        headers: {
          ...copyHeaders(request.headers, [
            "origin",
            "sec-websocket-key",
            "sec-websocket-version",
            "sec-websocket-protocol",
            "sec-websocket-extensions",
          ]),
          connection: "Upgrade",
          upgrade: "websocket",
        },
      });

      upstream.setTimeout(30_000, () =>
        upstream.destroy(new Error("Vite upgrade timed out"))
      );
      upstream.once("error", () => {
        if (!socket.destroyed) {
          socket.end(
            "HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"
          );
        }
      });
      upstream.once("response", (response) => {
        response.resume();
        socket.end(
          "HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"
        );
      });
      upstream.once("upgrade", (response, upstreamSocket, upstreamHead) => {
        upstream.setTimeout(0);
        if (socket.destroyed) {
          upstreamSocket.destroy();
          return;
        }

        const headers = copyHeaders(response.headers, [
          "connection",
          "upgrade",
          "sec-websocket-accept",
          "sec-websocket-protocol",
          "sec-websocket-extensions",
        ]);
        socket.write(
          `HTTP/1.1 101 Switching Protocols\r\n${Object.entries(headers)
            .map(([name, value]) => `${name}: ${String(value)}\r\n`)
            .join("")}\r\n`
        );
        if (upstreamHead.length) {
          socket.write(upstreamHead);
        }
        if (head.length) {
          upstreamSocket.write(head);
        }

        upstreamSocket.on("error", () => socket.destroy());
        upstreamSocket.on("close", () => socket.destroy());
        socket.on("error", () => upstreamSocket.destroy());
        socket.on("close", () => upstreamSocket.destroy());
        upstreamSocket.pipe(socket).pipe(upstreamSocket);
      });
      socket.once("close", () => upstream.destroy());
      upstream.end();
    }
  );
}

function getViteTarget() {
  const certPath = path.resolve("server/config/certs/public.cert");
  const useTLS =
    fs.existsSync(certPath) &&
    fs.existsSync(path.resolve("server/config/certs/private.key"));

  return {
    request: (
      options: https.RequestOptions,
      callback?: (response: http.IncomingMessage) => void
    ) =>
      useTLS
        ? https.request(options, callback)
        : http.request(options, callback),
    options: {
      hostname: "127.0.0.1",
      port: 3001,
      ...(useTLS
        ? {
            ca: fs.readFileSync(certPath),
            allowPartialTrustChain: true,
            servername: new URL(env.URL).hostname,
          }
        : {}),
    },
  };
}

function copyHeaders(
  headers: http.IncomingHttpHeaders,
  names: string[]
): http.IncomingHttpHeaders {
  const result: http.IncomingHttpHeaders = {};
  for (const name of names) {
    const value = headers[name];
    if (value !== undefined) {
      result[name] = value;
    }
  }
  return result;
}
