import type { Memo, User } from "@server/models";
import { MemoVisibility } from "@server/models/Memo";
import { buildMemo, buildUser } from "@server/test/factories";
import { getTestServer } from "@server/test/support";

const server = getTestServer();

describe("#memos.create", () => {
  let user: User;

  beforeEach(async () => {
    user = await buildUser();
  });

  it("requires authentication", async () => {
    const res = await server.post("/api/memos.create", {
      body: {
        content: {
          type: "doc",
          content: [{ type: "paragraph" }],
        },
      },
    });

    expect(res.status).toEqual(401);
  });

  it("creates a memo", async () => {
    const res = await server.post("/api/memos.create", user, {
      body: {
        visibility: MemoVisibility.Workspace,
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "hello #capture" }],
            },
          ],
        },
      },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.visibility).toEqual(MemoVisibility.Workspace);
    expect(body.data.tags).toEqual(["capture"]);
  });
});

describe("#memos.list", () => {
  let user: User;
  let memos: Memo[];

  beforeEach(async () => {
    user = await buildUser();
    memos = await Promise.all([
      buildMemo({
        userId: user.id,
        teamId: user.teamId,
        tags: ["alpha"],
        createdAt: new Date("2026-06-25T10:00:00Z"),
      }),
      buildMemo({
        userId: user.id,
        teamId: user.teamId,
        tags: ["beta"],
        createdAt: new Date("2026-06-25T11:00:00Z"),
      }),
    ]);
  });

  it("lists memos in reverse chronological order", async () => {
    const res = await server.post("/api/memos.list", user);
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.map((memo: { id: string }) => memo.id)).toEqual([
      memos[1].id,
      memos[0].id,
    ]);
  });

  it("filters by tag", async () => {
    const res = await server.post("/api/memos.list", user, {
      body: {
        tag: "alpha",
      },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toEqual(memos[0].id);
  });
});

describe("#memos.update", () => {
  it("allows the owner to update content", async () => {
    const user = await buildUser();
    const memo = await buildMemo({
      userId: user.id,
      teamId: user.teamId,
      tags: ["before"],
    });

    const res = await server.post("/api/memos.update", user, {
      body: {
        id: memo.id,
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "updated #after" }],
            },
          ],
        },
      },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.tags).toEqual(["after"]);
  });

  it("rejects another user", async () => {
    const user = await buildUser();
    const anotherUser = await buildUser({ teamId: user.teamId });
    const memo = await buildMemo({
      userId: user.id,
      teamId: user.teamId,
    });

    const res = await server.post("/api/memos.update", anotherUser, {
      body: {
        id: memo.id,
        content: {
          type: "doc",
          content: [{ type: "paragraph" }],
        },
      },
    });

    expect(res.status).toEqual(403);
  });
});

describe("#memos.info", () => {
  it("allows another team member to read a workspace memo", async () => {
    const user = await buildUser();
    const teammate = await buildUser({ teamId: user.teamId });
    const memo = await buildMemo({
      userId: user.id,
      teamId: user.teamId,
      visibility: MemoVisibility.Workspace,
    });

    const res = await server.post("/api/memos.info", teammate, {
      body: {
        id: memo.id,
      },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.id).toEqual(memo.id);
  });
});

describe("#memos.archive and #memos.delete", () => {
  it("archives then soft deletes a memo", async () => {
    const user = await buildUser();
    const memo = await buildMemo({
      userId: user.id,
      teamId: user.teamId,
    });

    const archiveRes = await server.post("/api/memos.archive", user, {
      body: { id: memo.id },
    });
    const archiveBody = await archiveRes.json();

    expect(archiveRes.status).toEqual(200);
    expect(archiveBody.data.archivedAt).toBeTruthy();

    const deleteRes = await server.post("/api/memos.delete", user, {
      body: { id: memo.id },
    });
    const deleteBody = await deleteRes.json();

    expect(deleteRes.status).toEqual(200);
    expect(deleteBody.success).toEqual(true);
  });
});

describe("#memos.tags", () => {
  it("returns distinct tags for the current user", async () => {
    const user = await buildUser();

    await buildMemo({
      userId: user.id,
      teamId: user.teamId,
      tags: ["alpha", "beta"],
    });
    await buildMemo({
      userId: user.id,
      teamId: user.teamId,
      tags: ["beta", "gamma"],
    });

    const res = await server.post("/api/memos.tags", user, {
      body: {
        query: "be",
      },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data).toEqual(["beta"]);
  });
});
