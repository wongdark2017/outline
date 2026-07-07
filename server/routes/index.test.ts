import { buildShare, buildDocument } from "@server/test/factories";
import { getTestServer } from "@server/test/support";
import { vi } from "vitest";

const server = getTestServer();

describe("/s/:id", () => {
  it("should return standard title in html when loading unpublished share", async () => {
    const share = await buildShare({
      published: false,
    });
    const res = await server.get(`/s/${share.id}`);
    const body = await res.text();
    expect(res.status).toEqual(404);
    expect(body).toContain("<title>Outline</title>");
  });

  it("should return standard title in html when share does not exist", async () => {
    const res = await server.get(`/s/junk`);
    const body = await res.text();
    expect(res.status).toEqual(404);
    expect(body).toContain("<title>Outline</title>");
  });

  it("should return standard title in html when document is deleted", async () => {
    const document = await buildDocument();
    const share = await buildShare({
      documentId: document.id,
      teamId: document.teamId,
    });
    await document.destroy();
    const res = await server.get(`/s/${share.id}`);
    const body = await res.text();
    expect(res.status).toEqual(404);
    expect(body).toContain("<title>Outline</title>");
  });

  it("should return document title in html when loading published share", async () => {
    const document = await buildDocument();
    const share = await buildShare({
      documentId: document.id,
      teamId: document.teamId,
    });
    const res = await server.get(`/s/${share.id}`);
    const body = await res.text();
    expect(res.status).toEqual(200);
    expect(body).toContain(`<title>${document.title}</title>`);
  });

  it("should return document title in html when loading published share with nested doc route", async () => {
    const document = await buildDocument();
    const share = await buildShare({
      documentId: document.id,
      teamId: document.teamId,
    });
    const res = await server.get(`/s/${share.id}/doc/${document.urlId}`);
    const body = await res.text();
    expect(res.status).toEqual(200);
    expect(body).toContain(`<title>${document.title}</title>`);
  });

  it("should return markdown when Accept header prefers text/markdown", async () => {
    const document = await buildDocument();
    const share = await buildShare({
      documentId: document.id,
      teamId: document.teamId,
    });
    const res = await server.get(`/s/${share.id}`, {
      headers: { Accept: "text/markdown" },
    });
    const body = await res.text();
    expect(res.status).toEqual(200);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    expect(body).toContain(`# ${document.title}`);
  });

  it("should return markdown when URL path ends with .md", async () => {
    const document = await buildDocument();
    const share = await buildShare({
      documentId: document.id,
      teamId: document.teamId,
    });
    const res = await server.get(`/s/${share.id}.md`);
    const body = await res.text();
    expect(res.status).toEqual(200);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    expect(body).toContain(`# ${document.title}`);
  });

  it("should return html when Accept header prefers text/html over text/markdown", async () => {
    const document = await buildDocument();
    const share = await buildShare({
      documentId: document.id,
      teamId: document.teamId,
    });
    const res = await server.get(`/s/${share.id}`, {
      headers: { Accept: "text/html, text/markdown" },
    });
    const body = await res.text();
    expect(res.status).toEqual(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(body).toContain(`<title>${document.title}</title>`);
  });

  it("should include child documents list in markdown when includeChildDocuments is true", async () => {
    const parent = await buildDocument();
    const child1 = await buildDocument({
      teamId: parent.teamId,
      collectionId: parent.collectionId,
      parentDocumentId: parent.id,
      title: "Child Document 1",
    });
    const child2 = await buildDocument({
      teamId: parent.teamId,
      collectionId: parent.collectionId,
      parentDocumentId: parent.id,
      title: "Child Document 2",
    });

    const share = await buildShare({
      documentId: parent.id,
      teamId: parent.teamId,
      includeChildDocuments: true,
    });

    const res = await server.get(`/s/${share.id}`, {
      headers: { Accept: "text/markdown" },
    });
    const body = await res.text();

    expect(res.status).toEqual(200);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    expect(body).toContain(`# ${parent.title}`);
    expect(body).toContain("---");
    expect(body).toContain("**Documents**");
    expect(body).toContain(`[${child1.title}]`);
    expect(body).toContain(`[${child2.title}]`);
  });

  it("should not include child documents list in markdown when includeChildDocuments is false", async () => {
    const parent = await buildDocument();
    await buildDocument({
      teamId: parent.teamId,
      collectionId: parent.collectionId,
      parentDocumentId: parent.id,
      title: "Child Document",
    });

    const share = await buildShare({
      documentId: parent.id,
      teamId: parent.teamId,
      includeChildDocuments: false,
    });

    const res = await server.get(`/s/${share.id}`, {
      headers: { Accept: "text/markdown" },
    });
    const body = await res.text();

    expect(res.status).toEqual(200);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    expect(body).toContain(`# ${parent.title}`);
    expect(body).not.toContain("**Documents**");
    expect(body).not.toContain("[Child Document]");
  });
});

describe("scanner path 404s", () => {
  it.each([
    "/.well-known/gpc.json",
    "/.env",
    "/.git/config",
    "/cgi-bin/test.cgi",
    "/wp-admin/setup-config.php",
    "/wp-login.php",
    "/xmlrpc.php",
    "/admin.php",
    "/phpmyadmin/index.php",
    "/actuator/health",
    "/HNAP1/",
  ])("returns 404 for %s without rendering the app shell", async (path) => {
    const res = await server.get(path);
    const body = await res.text();
    expect(res.status).toEqual(404);
    expect(body).not.toContain("<title>");
  });

  it("still serves the app shell for legitimate unknown paths", async () => {
    const res = await server.get("/some-app-route");
    expect(res.status).toEqual(200);
  });

  it("still serves the OAuth well-known endpoint", async () => {
    const res = await server.get("/.well-known/oauth-authorization-server");
    expect(res.status).toEqual(200);
    const body = await res.json();
    expect(body.issuer).toBeDefined();
  });
});

describe("development app shell assets", () => {
  it("serves same-origin Vite entrypoints in the app shell", async () => {
    const res = await server.get("/memos");
    const body = await res.text();

    expect(res.status).toEqual(200);
    expect(body).toContain('src="/static/@vite/client"');
    expect(body).toContain('src="/static/app/index.tsx"');
    expect(body).not.toContain("http://localhost:3001");
  });

  it("proxies Vite asset requests through the app origin", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response('console.log("vite proxy");', {
          status: 200,
          headers: {
            "content-type": "text/javascript",
            "cache-control": "no-cache",
          },
        })
      );

    const res = await server.get("/static/@vite/client?direct=1");
    const body = await res.text();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0].toString()).toBe(
      "http://localhost:3001/static/@vite/client?direct=1"
    );
    expect(res.status).toEqual(200);
    expect(res.headers.get("content-type")).toContain("text/javascript");
    expect(body).toContain('console.log("vite proxy");');

    fetchSpy.mockRestore();
  });
});
