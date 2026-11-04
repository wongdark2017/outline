import { TeamPreference, UserPreference } from "@shared/types";
import { Team, Theme } from "@server/models";
import {
  buildAdmin,
  buildApiKey,
  buildTheme,
  buildUser,
} from "@server/test/factories";
import { getTestServer } from "@server/test/support";

const server = getTestServer();
const disabledMethods = [
  "themes.info",
  "themes.list",
  "themes.create",
  "themes.update",
  "themes.delete",
] as const;

describe("disabled legacy theme routes", () => {
  it.each(disabledMethods)(
    "returns the normal unknown-endpoint response for %s, including authorized callers",
    async (method) => {
      const admin = await buildAdmin();
      const member = await buildUser({ teamId: admin.teamId });
      const theme = await buildTheme({
        teamId: admin.teamId,
        createdById: admin.id,
      });
      const unknown = await server.post("/api/unknown.endpoint", admin);
      const expected = await unknown.json();
      expect(unknown.status).toEqual(404);
      expect(expected.error).toEqual("not_found");

      for (const actor of [undefined, member, admin]) {
        const options = {
          body: {
            id: theme.id,
            name: "Unavailable theme",
            light: { accent: "#d23f31" },
            dark: { accent: "#ff7a6b" },
          },
        };
        const response = actor
          ? await server.post(`/api/${method}`, actor, options)
          : await server.post(`/api/${method}`, options);
        expect(response.status).toEqual(404);
        expect(await response.json()).toEqual(expected);
      }
      expect(await Theme.count({ where: { teamId: admin.teamId } })).toEqual(1);
      await theme.reload();
      expect(theme.name).not.toEqual("Unavailable theme");
    }
  );

  it("does not expose the legacy routes to API keys", async () => {
    const admin = await buildAdmin();
    const key = await buildApiKey({ userId: admin.id });
    const theme = await buildTheme({
      teamId: admin.teamId,
      createdById: admin.id,
    });

    for (const method of disabledMethods) {
      const response = await server.post(`/api/${method}`, {
        headers: { Authorization: `Bearer ${key.value}` },
        body: { id: theme.id, name: "Unavailable theme" },
      });
      expect(response.status).toEqual(404);
      const body = await response.json();
      expect(body.error).toEqual("not_found");
      expect(body.data).toBeUndefined();
    }
  });

  it("does not expose theme data through GET requests", async () => {
    const admin = await buildAdmin();
    const theme = await buildTheme({
      teamId: admin.teamId,
      createdById: admin.id,
    });

    for (const method of disabledMethods) {
      const response = await server.get(`/api/${method}?id=${theme.id}`, admin);
      expect(response.status).toEqual(404);
      const body = await response.json();
      expect(body.error).toEqual("not_found");
      expect(body.data).toBeUndefined();
    }
  });

  it("preserves stored themes and existing personal and workspace theme preferences", async () => {
    const admin = await buildAdmin();
    const theme = await buildTheme({
      teamId: admin.teamId,
      createdById: admin.id,
      name: "Existing theme",
      light: { accent: "#d23f31" },
      dark: { accent: "#ff7a6b" },
    });
    const team = await Team.findByPk(admin.teamId, { rejectOnEmpty: true });
    team.setPreference(TeamPreference.DefaultLightTheme, theme.id);
    team.setPreference(TeamPreference.DefaultDarkTheme, theme.id);
    await team.save();
    admin.setPreference(UserPreference.LightTheme, theme.id);
    admin.setPreference(UserPreference.DarkTheme, theme.id);
    admin.setPreference(UserPreference.UseCursorPointer, false);
    await admin.save();
    const teamPreferences = { ...team.preferences };
    const userPreferences = { ...admin.preferences };

    for (const method of disabledMethods) {
      const response = await server.post(`/api/${method}`, admin, {
        body: {
          id: theme.id,
          name: "Changed theme",
          light: { accent: "#111111" },
        },
      });
      expect(response.status).toEqual(404);
    }

    await theme.reload();
    await team.reload();
    await admin.reload();
    expect(theme.name).toEqual("Existing theme");
    expect(theme.light).toEqual({ accent: "#d23f31" });
    expect(theme.dark).toEqual({ accent: "#ff7a6b" });
    expect(team.preferences).toEqual(teamPreferences);
    expect(admin.preferences).toEqual(userPreferences);
    expect(await Theme.count({ where: { teamId: admin.teamId } })).toEqual(1);
  });
});
