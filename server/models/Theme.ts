import type {
  InferAttributes,
  InferCreationAttributes,
  SaveOptions,
} from "sequelize";
import { Op } from "sequelize";
import {
  BeforeCreate,
  BeforeSave,
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  Table,
} from "sequelize-typescript";
import type { ThemeTokens } from "@shared/styles/themeTokens";
import { sanitizeThemeTokens } from "@shared/styles/themeTokens";
import { ThemeValidation } from "@shared/validations";
import { ValidationError } from "@server/errors";
import Team from "./Team";
import User from "./User";
import IdModel from "./base/IdModel";
import Length from "./validators/Length";

@Table({ tableName: "themes", modelName: "theme" })
class Theme extends IdModel<
  InferAttributes<Theme>,
  Partial<InferCreationAttributes<Theme>>
> {
  @Length({
    min: 1,
    max: ThemeValidation.maxNameLength,
    msg: `theme name must be between 1 and ${ThemeValidation.maxNameLength} characters`,
  })
  @Column(DataType.STRING)
  name: string;

  /** Color overrides used when the interface is light. */
  @Column(DataType.JSONB)
  light: ThemeTokens;

  /** Color overrides used when the interface is dark. */
  @Column(DataType.JSONB)
  dark: ThemeTokens;

  // associations

  @BelongsTo(() => Team, "teamId")
  team: Team;

  @ForeignKey(() => Team)
  @Column(DataType.UUID)
  teamId: string;

  @BelongsTo(() => User, "createdById")
  createdBy: User;

  @ForeignKey(() => User)
  @Column(DataType.UUID)
  createdById: string;

  // hooks

  @BeforeSave
  static sanitizeColors(model: Theme) {
    model.light = sanitizeThemeTokens(model.light);
    model.dark = sanitizeThemeTokens(model.dark);
  }

  @BeforeSave
  static async checkUniqueName(
    model: Theme,
    options: SaveOptions<Theme>
  ): Promise<void> {
    if (!model.isNewRecord && !model.changed("name")) {
      return;
    }

    const existing = await this.findOne({
      where: {
        name: model.name,
        teamId: model.teamId,
        id: { [Op.ne]: model.id },
      },
      transaction: options.transaction,
    });

    // The name is left out of the message on purpose: the API error handler
    // turns any error that contains the words "not found" into a generic 404,
    // and the name is chosen by the user.
    if (existing) {
      throw ValidationError("A theme with this name already exists.");
    }
  }

  @BeforeCreate
  static async checkThemeLimit(
    model: Theme,
    options: SaveOptions<Theme>
  ): Promise<void> {
    const count = await this.count({
      where: { teamId: model.teamId },
      transaction: options.transaction,
    });

    if (count >= ThemeValidation.maxThemesPerTeam) {
      throw ValidationError(
        `A workspace can have at most ${ThemeValidation.maxThemesPerTeam} themes.`
      );
    }
  }
}

export default Theme;
