import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import Koa from "koa";
import env from "@server/env";
import { renderApp } from "./app";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("development application entry", () => {
  it("loads the client and React refresh from the page's origin", async () => {
    vi.spyOn(env, "isProduction", "get").mockReturnValue(false);
    const request = new IncomingMessage(new Socket());
    request.url = "/";
    request.headers.host = "localhost:3000";
    const context = new Koa().createContext(
      request,
      new ServerResponse(request)
    );
    context.params = {};
    context.state.cspNonce = "test-nonce";

    await renderApp(context, async () => undefined);

    const body = String(context.body);
    expect(body).toContain('from "/static/@react-refresh"');
    expect(body).toContain('src="/static/@vite/client"');
    expect(body).toContain('src="/static/app/index.tsx"');
    expect(body).toContain('nonce="test-nonce"');
    expect(body).not.toContain(":3001");
  });
});
