import { MemoVisibility } from "@server/models/Memo";
import { buildMemo, buildUser } from "@server/test/factories";
import { serialize } from "./index";

describe("memo policy", () => {
  it("allows the owner to manage a memo", async () => {
    const user = await buildUser();
    const memo = await buildMemo({
      userId: user.id,
      teamId: user.teamId,
    });

    expect(serialize(user, memo)).toMatchObject({
      read: true,
      update: true,
      archive: true,
      delete: true,
    });
  });

  it("allows teammates to read workspace memos only", async () => {
    const owner = await buildUser();
    const teammate = await buildUser({
      teamId: owner.teamId,
    });
    const workspaceMemo = await buildMemo({
      userId: owner.id,
      teamId: owner.teamId,
      visibility: MemoVisibility.Workspace,
    });
    const privateMemo = await buildMemo({
      userId: owner.id,
      teamId: owner.teamId,
      visibility: MemoVisibility.Private,
    });

    expect(serialize(teammate, workspaceMemo)).toMatchObject({
      read: true,
      update: false,
      archive: false,
      delete: false,
    });
    expect(serialize(teammate, privateMemo)).toMatchObject({
      read: false,
      update: false,
      archive: false,
      delete: false,
    });
  });
});
