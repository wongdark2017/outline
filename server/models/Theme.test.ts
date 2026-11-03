import { ThemeValidation } from "@shared/validations";
import { Theme } from "@server/models";
import { buildTheme, buildUser } from "@server/test/factories";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Theme", () => {
  describe("sanitizeColors", () => {
    it("should drop unknown keys and invalid colors when saving", async () => {
      const light: Record<string, string> = {
        accent: "#d23f31",
        text: "url(https://example.com/x)",
        fontFamily: "#000000",
      };
      const theme = await buildTheme({ light, dark: { link: "red" } });

      await theme.reload();

      expect(theme.light).toEqual({ accent: "#d23f31" });
      expect(theme.dark).toEqual({});
    });

    it("should sanitize colors on update", async () => {
      const theme = await buildTheme();
      const dark: Record<string, string> = {
        background: "#101010",
        divider: "javascript:alert(1)",
      };

      theme.dark = dark;
      await theme.save();
      await theme.reload();

      expect(theme.dark).toEqual({ background: "#101010" });
    });
  });

  describe("name", () => {
    it("should reject a name longer than the limit", async () => {
      await expect(
        buildTheme({ name: "x".repeat(ThemeValidation.maxNameLength + 1) })
      ).rejects.toThrow();
    });

    it("should reject an empty name", async () => {
      await expect(buildTheme({ name: "" })).rejects.toThrow();
    });

    it("should reject a duplicate name in the same workspace", async () => {
      const user = await buildUser();
      await buildTheme({ teamId: user.teamId, name: "Sunset" });

      await expect(
        buildTheme({ teamId: user.teamId, name: "Sunset" })
      ).rejects.toThrow(/already exists/);
    });

    it("should allow the same name in another workspace", async () => {
      await buildTheme({ name: "Sunset" });
      const other = await buildTheme({ name: "Sunset" });

      expect(other.name).toEqual("Sunset");
    });

    it("should reject renaming to a name that is taken", async () => {
      const user = await buildUser();
      await buildTheme({ teamId: user.teamId, name: "Sunset" });
      const theme = await buildTheme({ teamId: user.teamId, name: "Dusk" });

      theme.name = "Sunset";

      await expect(theme.save()).rejects.toThrow(/already exists/);
    });

    it("should allow saving a theme without changing its name", async () => {
      const theme = await buildTheme({ name: "Sunset" });

      theme.light = { accent: "#000000" };
      await theme.save();
      await theme.reload();

      expect(theme.name).toEqual("Sunset");
      expect(theme.light).toEqual({ accent: "#000000" });
    });
  });

  describe("limit", () => {
    it("should not allow more themes than the workspace limit", async () => {
      const user = await buildUser();
      vi.spyOn(Theme, "count").mockResolvedValue(
        ThemeValidation.maxThemesPerTeam
      );

      await expect(buildTheme({ teamId: user.teamId })).rejects.toThrow(
        /at most/
      );
    });
  });
});
