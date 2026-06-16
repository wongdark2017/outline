import { User } from "@server/models";
import presentUser from "./user";

describe("presentUser password state", () => {
  it("includes hasPassword only when includePasswordState is enabled", () => {
    const user = User.build({
      id: "123",
      name: "Test User",
      passwordHash: "hashed-password",
    });

    expect(
      presentUser(user, {
        includePasswordState: true,
      })
    ).toMatchObject({
      hasPassword: true,
    });

    expect(
      presentUser(user, {
        includeDetails: true,
      })
    ).not.toHaveProperty("hasPassword");
  });
});
