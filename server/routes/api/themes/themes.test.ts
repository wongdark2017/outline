import { randomUUID } from "node:crypto";
import { TeamPreference, ThemeChoice, UserPreference } from "@shared/types";
import { Team, Theme, User } from "@server/models";
import {
  buildAdmin,
  buildGuestUser,
  buildTheme,
  buildUser,
  buildViewer,
} from "@server/test/factories";
import { getTestServer } from "@server/test/support";

const server = getTestServer();

describe("#themes.create", () => {
  it("should require authentication", async () => {
    const res = await server.post("/api/themes.create", {
      body: { name: "Sunset" },
    });
    expect(res.status).toEqual(401);
  });

  it("should create a theme for a member", async () => {
    const user = await buildUser();
    const res = await server.post("/api/themes.create", user, {
      body: {
        name: "Sunset",
        light: { accent: "#d23f31" },
        dark: { accent: "#ff7a6b", background: "#1a1010" },
      },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.name).toEqual("Sunset");
    expect(body.data.light).toEqual({ accent: "#d23f31" });
    expect(body.data.dark.background).toEqual("#1a1010");
    expect(body.data.createdById).toEqual(user.id);
    expect(body.policies[0].abilities.update).toBe(true);

    const theme = await Theme.findByPk(body.data.id, { rejectOnEmpty: true });
    expect(theme.teamId).toEqual(user.teamId);
    expect(theme.dark).toEqual({ accent: "#ff7a6b", background: "#1a1010" });
  });

  it("should default to empty colors and trim the name", async () => {
    const user = await buildUser();
    const res = await server.post("/api/themes.create", user, {
      body: { name: "  Plain  " },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.name).toEqual("Plain");
    expect(body.data.light).toEqual({});
    expect(body.data.dark).toEqual({});
  });

  it("should allow a viewer to create a theme", async () => {
    const viewer = await buildViewer();
    const res = await server.post("/api/themes.create", viewer, {
      body: { name: "Sunset" },
    });
    expect(res.status).toEqual(200);
  });

  it("should not allow guests", async () => {
    const guest = await buildGuestUser();
    const res = await server.post("/api/themes.create", guest, {
      body: { name: "Sunset" },
    });
    expect(res.status).toEqual(403);
  });

  it("should reject keys outside the allowlist", async () => {
    const user = await buildUser();
    const res = await server.post("/api/themes.create", user, {
      body: { name: "Sunset", light: { fontFamily: "#000000" } },
    });
    expect(res.status).toEqual(400);
    expect(await Theme.count({ where: { teamId: user.teamId } })).toEqual(0);
  });

  it("should reject values that are not hex colors", async () => {
    const user = await buildUser();
    const res = await server.post("/api/themes.create", user, {
      body: {
        name: "Sunset",
        light: { background: "url(https://example.com/x)" },
      },
    });
    expect(res.status).toEqual(400);
    expect(await Theme.count({ where: { teamId: user.teamId } })).toEqual(0);
  });

  it("should reject a blank or missing name", async () => {
    const user = await buildUser();
    const blank = await server.post("/api/themes.create", user, {
      body: { name: "   " },
    });
    const missing = await server.post("/api/themes.create", user, {
      body: { light: {} },
    });

    expect(blank.status).toEqual(400);
    expect(missing.status).toEqual(400);
  });

  it("should reject a name that is too long", async () => {
    const user = await buildUser();
    const res = await server.post("/api/themes.create", user, {
      body: { name: "x".repeat(51) },
    });
    expect(res.status).toEqual(400);
  });

  it("should reject a duplicate name in the same workspace", async () => {
    const user = await buildUser();
    await buildTheme({ teamId: user.teamId, name: "Sunset" });
    const res = await server.post("/api/themes.create", user, {
      body: { name: "Sunset" },
    });
    expect(res.status).toEqual(400);
  });

  it("should allow the same name in another workspace", async () => {
    const user = await buildUser();
    await buildTheme({ name: "Sunset" });
    const res = await server.post("/api/themes.create", user, {
      body: { name: "Sunset" },
    });
    expect(res.status).toEqual(200);
  });

  it("should report a duplicate as a validation error whatever the name", async () => {
    const user = await buildUser();
    await buildTheme({ teamId: user.teamId, name: "Not found" });
    const res = await server.post("/api/themes.create", user, {
      body: { name: "Not found" },
    });
    const body = await res.json();

    expect(res.status).toEqual(400);
    expect(body.error).toEqual("validation_error");
    expect(body.message).toMatch(/already exists/);
  });
});

describe("#themes.list", () => {
  it("should require authentication", async () => {
    const res = await server.post("/api/themes.list");
    expect(res.status).toEqual(401);
  });

  it("should only return themes from the user's workspace", async () => {
    const user = await buildUser();
    const own = await buildTheme({ teamId: user.teamId });
    await buildTheme();

    const res = await server.post("/api/themes.list", user);
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.map((theme: { id: string }) => theme.id)).toEqual([
      own.id,
    ]);
    expect(body.pagination.total).toEqual(1);
    expect(body.policies).toHaveLength(1);
  });

  it("should order themes by name", async () => {
    const user = await buildUser();
    await buildTheme({ teamId: user.teamId, name: "Charlie" });
    await buildTheme({ teamId: user.teamId, name: "Alpha" });
    await buildTheme({ teamId: user.teamId, name: "Bravo" });

    const res = await server.post("/api/themes.list", user);
    const body = await res.json();

    expect(body.data.map((theme: { name: string }) => theme.name)).toEqual([
      "Alpha",
      "Bravo",
      "Charlie",
    ]);
  });

  it("should filter by name", async () => {
    const user = await buildUser();
    await buildTheme({ teamId: user.teamId, name: "Sunset" });
    await buildTheme({ teamId: user.teamId, name: "Sunrise" });
    await buildTheme({ teamId: user.teamId, name: "Midnight" });

    const res = await server.post("/api/themes.list", user, {
      body: { query: "sun" },
    });
    const body = await res.json();

    expect(body.data).toHaveLength(2);
    expect(body.pagination.total).toEqual(2);
  });

  it("should be available to guests", async () => {
    const guest = await buildGuestUser();
    await buildTheme({ teamId: guest.teamId });

    const res = await server.post("/api/themes.list", guest);
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data).toHaveLength(1);
    expect(body.policies[0].abilities.update).toBe(false);
  });
});

describe("#themes.info", () => {
  it("should require authentication", async () => {
    const res = await server.post("/api/themes.info", {
      body: { id: randomUUID() },
    });
    expect(res.status).toEqual(401);
  });

  it("should return a theme from the same workspace", async () => {
    const user = await buildUser();
    const theme = await buildTheme({
      teamId: user.teamId,
      createdById: user.id,
    });

    const res = await server.post("/api/themes.info", user, {
      body: { id: theme.id },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.id).toEqual(theme.id);
    expect(body.data.createdBy.id).toEqual(user.id);
  });

  it("should not return a theme from another workspace", async () => {
    const user = await buildUser();
    const other = await buildTheme();
    const res = await server.post("/api/themes.info", user, {
      body: { id: other.id },
    });
    expect(res.status).toEqual(403);
  });

  it("should return 404 for a theme that does not exist", async () => {
    const user = await buildUser();
    const res = await server.post("/api/themes.info", user, {
      body: { id: randomUUID() },
    });
    expect(res.status).toEqual(404);
  });

  it("should reject an invalid id", async () => {
    const user = await buildUser();
    const res = await server.post("/api/themes.info", user, {
      body: { id: "not-a-uuid" },
    });
    expect(res.status).toEqual(400);
  });
});

describe("#themes.update", () => {
  it("should require authentication", async () => {
    const res = await server.post("/api/themes.update", {
      body: { id: randomUUID(), name: "Dusk" },
    });
    expect(res.status).toEqual(401);
  });

  it("should allow the creator to update", async () => {
    const user = await buildUser();
    const theme = await buildTheme({
      teamId: user.teamId,
      createdById: user.id,
    });
    const res = await server.post("/api/themes.update", user, {
      body: { id: theme.id, name: "Dusk", light: { text: "#222222" } },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.name).toEqual("Dusk");
    expect(body.data.light).toEqual({ text: "#222222" });
    expect(body.data.createdBy.id).toEqual(user.id);

    await theme.reload();
    expect(theme.name).toEqual("Dusk");
    expect(theme.light).toEqual({ text: "#222222" });
  });

  it("should leave fields that are not sent unchanged", async () => {
    const user = await buildUser();
    const theme = await buildTheme({
      teamId: user.teamId,
      createdById: user.id,
      name: "Sunset",
      light: { accent: "#d23f31" },
      dark: { accent: "#ff7a6b" },
    });
    const res = await server.post("/api/themes.update", user, {
      body: { id: theme.id, name: "Dusk" },
    });

    expect(res.status).toEqual(200);

    await theme.reload();
    expect(theme.light).toEqual({ accent: "#d23f31" });
    expect(theme.dark).toEqual({ accent: "#ff7a6b" });
  });

  it("should replace colors rather than merge them", async () => {
    const user = await buildUser();
    const theme = await buildTheme({
      teamId: user.teamId,
      createdById: user.id,
      light: { accent: "#d23f31", text: "#222222" },
    });
    const res = await server.post("/api/themes.update", user, {
      body: { id: theme.id, light: { link: "#0366d6" } },
    });

    expect(res.status).toEqual(200);

    await theme.reload();
    expect(theme.light).toEqual({ link: "#0366d6" });
  });

  it("should not allow another member to update", async () => {
    const user = await buildUser();
    const theme = await buildTheme({ teamId: user.teamId });
    const res = await server.post("/api/themes.update", user, {
      body: { id: theme.id, name: "Dusk" },
    });
    expect(res.status).toEqual(403);

    await theme.reload();
    expect(theme.name).not.toEqual("Dusk");
  });

  it("should allow an admin to update another member's theme", async () => {
    const admin = await buildAdmin();
    const theme = await buildTheme({ teamId: admin.teamId });
    const res = await server.post("/api/themes.update", admin, {
      body: { id: theme.id, name: "Dusk" },
    });
    expect(res.status).toEqual(200);
  });

  it("should not allow an admin of another workspace to update", async () => {
    const admin = await buildAdmin();
    const theme = await buildTheme();
    const res = await server.post("/api/themes.update", admin, {
      body: { id: theme.id, name: "Dusk" },
    });
    expect(res.status).toEqual(403);
  });

  it("should reject invalid colors", async () => {
    const user = await buildUser();
    const theme = await buildTheme({
      teamId: user.teamId,
      createdById: user.id,
    });
    const res = await server.post("/api/themes.update", user, {
      body: { id: theme.id, dark: { background: "red" } },
    });
    expect(res.status).toEqual(400);
  });

  it("should reject renaming to a name that is taken", async () => {
    const user = await buildUser();
    await buildTheme({ teamId: user.teamId, name: "Sunset" });
    const theme = await buildTheme({
      teamId: user.teamId,
      createdById: user.id,
      name: "Dusk",
    });
    const res = await server.post("/api/themes.update", user, {
      body: { id: theme.id, name: "Sunset" },
    });
    expect(res.status).toEqual(400);
  });
});

describe("#themes.delete", () => {
  it("should require authentication", async () => {
    const res = await server.post("/api/themes.delete", {
      body: { id: randomUUID() },
    });
    expect(res.status).toEqual(401);
  });

  it("should allow the creator to delete", async () => {
    const user = await buildUser();
    const theme = await buildTheme({
      teamId: user.teamId,
      createdById: user.id,
    });
    const res = await server.post("/api/themes.delete", user, {
      body: { id: theme.id },
    });

    expect(res.status).toEqual(200);
    expect(await Theme.findByPk(theme.id)).toBeNull();
  });

  it("should allow an admin to delete another member's theme", async () => {
    const admin = await buildAdmin();
    const theme = await buildTheme({ teamId: admin.teamId });
    const res = await server.post("/api/themes.delete", admin, {
      body: { id: theme.id },
    });

    expect(res.status).toEqual(200);
    expect(await Theme.findByPk(theme.id)).toBeNull();
  });

  it("should not allow another member to delete", async () => {
    const user = await buildUser();
    const theme = await buildTheme({ teamId: user.teamId });
    const res = await server.post("/api/themes.delete", user, {
      body: { id: theme.id },
    });

    expect(res.status).toEqual(403);
    expect(await Theme.findByPk(theme.id)).not.toBeNull();
  });

  it("should reset a workspace default that points at the theme", async () => {
    const admin = await buildAdmin();
    const theme = await buildTheme({ teamId: admin.teamId });
    const other = await buildTheme({ teamId: admin.teamId });
    const team = await Team.findByPk(admin.teamId, { rejectOnEmpty: true });
    team.setPreference(TeamPreference.DefaultDarkTheme, theme.id);
    team.setPreference(TeamPreference.DefaultLightTheme, other.id);
    await team.save();

    const res = await server.post("/api/themes.delete", admin, {
      body: { id: theme.id },
    });

    expect(res.status).toEqual(200);
    expect(await Theme.findByPk(theme.id)).toBeNull();
    await team.reload();
    expect(team.getPreference(TeamPreference.DefaultDarkTheme)).toEqual(
      ThemeChoice.Builtin
    );
    expect(team.getPreference(TeamPreference.DefaultLightTheme)).toEqual(
      other.id
    );
  });
});

describe("#users.update theme preferences", () => {
  it("should accept a theme from the same workspace", async () => {
    const user = await buildUser();
    const theme = await buildTheme({ teamId: user.teamId });
    const res = await server.post("/api/users.update", user, {
      body: { preferences: { [UserPreference.DarkTheme]: theme.id } },
    });
    expect(res.status).toEqual(200);

    const updated = await User.findByPk(user.id, { rejectOnEmpty: true });
    expect(updated.getPreference(UserPreference.DarkTheme)).toEqual(theme.id);
    expect(updated.getPreference(UserPreference.LightTheme)).toEqual(
      ThemeChoice.WorkspaceDefault
    );
  });

  it("should reject a theme from another workspace", async () => {
    const user = await buildUser();
    const other = await buildTheme();
    const res = await server.post("/api/users.update", user, {
      body: { preferences: { [UserPreference.DarkTheme]: other.id } },
    });
    const body = await res.json();

    expect(res.status).toEqual(400);
    expect(body.error).toEqual("validation_error");

    const updated = await User.findByPk(user.id, { rejectOnEmpty: true });
    expect(updated.getPreference(UserPreference.DarkTheme)).toEqual(
      ThemeChoice.WorkspaceDefault
    );
  });

  it("should accept the built-in and workspace default choices", async () => {
    const user = await buildUser();
    const res = await server.post("/api/users.update", user, {
      body: {
        preferences: {
          [UserPreference.LightTheme]: ThemeChoice.Builtin,
          [UserPreference.DarkTheme]: ThemeChoice.WorkspaceDefault,
        },
      },
    });
    expect(res.status).toEqual(200);

    const updated = await User.findByPk(user.id, { rejectOnEmpty: true });
    expect(updated.getPreference(UserPreference.LightTheme)).toEqual(
      ThemeChoice.Builtin
    );
  });

  it("should reject values that are not a theme or a choice", async () => {
    const user = await buildUser();
    const res = await server.post("/api/users.update", user, {
      body: { preferences: { [UserPreference.LightTheme]: "red" } },
    });
    expect(res.status).toEqual(400);
  });

  it("should keep other preferences when setting a theme", async () => {
    const user = await buildUser();
    const theme = await buildTheme({ teamId: user.teamId });
    await server.post("/api/users.update", user, {
      body: { preferences: { [UserPreference.UseCursorPointer]: false } },
    });
    await server.post("/api/users.update", user, {
      body: { preferences: { [UserPreference.LightTheme]: theme.id } },
    });

    const updated = await User.findByPk(user.id, { rejectOnEmpty: true });
    expect(updated.getPreference(UserPreference.UseCursorPointer)).toBe(false);
    expect(updated.getPreference(UserPreference.LightTheme)).toEqual(theme.id);
  });
});

describe("#teams.update default themes", () => {
  it("should accept a default theme from the same workspace", async () => {
    const admin = await buildAdmin();
    const theme = await buildTheme({ teamId: admin.teamId });
    const res = await server.post("/api/teams.update", admin, {
      body: { preferences: { [TeamPreference.DefaultLightTheme]: theme.id } },
    });
    expect(res.status).toEqual(200);

    const team = await Team.findByPk(admin.teamId, { rejectOnEmpty: true });
    expect(team.getPreference(TeamPreference.DefaultLightTheme)).toEqual(
      theme.id
    );
    expect(team.getPreference(TeamPreference.DefaultDarkTheme)).toEqual(
      ThemeChoice.Builtin
    );
  });

  it("should reject a default theme from another workspace", async () => {
    const admin = await buildAdmin();
    const other = await buildTheme();
    const res = await server.post("/api/teams.update", admin, {
      body: { preferences: { [TeamPreference.DefaultDarkTheme]: other.id } },
    });
    const body = await res.json();

    expect(res.status).toEqual(400);
    expect(body.error).toEqual("validation_error");

    const team = await Team.findByPk(admin.teamId, { rejectOnEmpty: true });
    expect(team.getPreference(TeamPreference.DefaultDarkTheme)).toEqual(
      ThemeChoice.Builtin
    );
  });

  it("should accept the built-in colors as the default", async () => {
    const admin = await buildAdmin();
    const res = await server.post("/api/teams.update", admin, {
      body: {
        preferences: { [TeamPreference.DefaultDarkTheme]: ThemeChoice.Builtin },
      },
    });
    expect(res.status).toEqual(200);
  });

  it("should reject the workspace default as the default", async () => {
    const admin = await buildAdmin();
    const res = await server.post("/api/teams.update", admin, {
      body: {
        preferences: {
          [TeamPreference.DefaultDarkTheme]: ThemeChoice.WorkspaceDefault,
        },
      },
    });
    expect(res.status).toEqual(400);
  });

  it("should not allow a member to change the default", async () => {
    const user = await buildUser();
    const theme = await buildTheme({ teamId: user.teamId });
    const res = await server.post("/api/teams.update", user, {
      body: { preferences: { [TeamPreference.DefaultLightTheme]: theme.id } },
    });
    expect(res.status).toEqual(403);
  });
});
