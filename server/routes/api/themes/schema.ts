import { z } from "zod";
import { ThemeTokenKeys } from "@shared/styles/themeTokens";
import { validateColorHex } from "@shared/utils/color";
import { ThemeValidation } from "@shared/validations";
import { BaseSchema } from "../schema";

const zodThemeName = () =>
  z.string().trim().min(1).max(ThemeValidation.maxNameLength);

const zodThemeTokens = () =>
  z.partialRecord(
    z.enum(ThemeTokenKeys),
    z.string().refine(validateColorHex, {
      error: "Colors must be hex values, for example #0366d6",
    })
  );

export const ThemesInfoSchema = BaseSchema.extend({
  body: z.object({
    /** ID of the theme to fetch */
    id: z.uuid(),
  }),
});

export const ThemesListSchema = BaseSchema.extend({
  body: z.object({
    /** Optional filter on the theme name */
    query: z.string().optional(),
  }),
});

export const ThemesCreateSchema = BaseSchema.extend({
  body: z.object({
    /** Display name of the theme */
    name: zodThemeName(),
    /** Color overrides for light mode */
    light: zodThemeTokens().default({}),
    /** Color overrides for dark mode */
    dark: zodThemeTokens().default({}),
  }),
});

export const ThemesUpdateSchema = BaseSchema.extend({
  body: z.object({
    /** ID of the theme to update */
    id: z.uuid(),
    /** New display name */
    name: zodThemeName().optional(),
    /** Replacement color overrides for light mode */
    light: zodThemeTokens().optional(),
    /** Replacement color overrides for dark mode */
    dark: zodThemeTokens().optional(),
  }),
});

export const ThemesDeleteSchema = BaseSchema.extend({
  body: z.object({
    /** ID of the theme to delete */
    id: z.uuid(),
  }),
});

export type ThemesInfoReq = z.infer<typeof ThemesInfoSchema>;

export type ThemesListReq = z.infer<typeof ThemesListSchema>;

export type ThemesCreateReq = z.infer<typeof ThemesCreateSchema>;

export type ThemesUpdateReq = z.infer<typeof ThemesUpdateSchema>;

export type ThemesDeleteReq = z.infer<typeof ThemesDeleteSchema>;
