import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import Koa from "koa";
import env from "@server/env";
import createCSPMiddleware from "./csp";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CSP font sources", () => {
  it("allows the Vite origin to serve local math fonts in development", async () => {
    vi.spyOn(env, "isProduction", "get").mockReturnValue(false);
    const request = new IncomingMessage(new Socket());
    request.headers.host = "localhost:3000";
    const context = new Koa().createContext(
      request,
      new ServerResponse(request)
    );

    await createCSPMiddleware()(context, async () => undefined);

    const policy = context.response.get("Content-Security-Policy");
    const fonts = policy
      .split(";")
      .find((directive) => directive.startsWith("font-src"));
    expect(fonts).toContain("'self'");
    expect(fonts).toContain(env.URL.replace(`:${env.PORT}`, ":3001"));
    expect(fonts).not.toMatch(/(?:^|\s)https:(?:\s|$)/);
  });

  it("preserves the default font policy in production", async () => {
    vi.spyOn(env, "isProduction", "get").mockReturnValue(true);
    const request = new IncomingMessage(new Socket());
    request.headers.host = "localhost:3000";
    const context = new Koa().createContext(
      request,
      new ServerResponse(request)
    );

    await createCSPMiddleware()(context, async () => undefined);

    const policy = context.response.get("Content-Security-Policy");
    expect(policy).not.toContain("font-src");
    expect(policy).not.toContain("localhost:3001");
  });
});
