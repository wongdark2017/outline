import type {
  InferAttributes,
  InferCreationAttributes,
  Transaction,
} from "sequelize";
import { Column, DataType, Table, Unique } from "sequelize-typescript";
import IdModel from "./base/IdModel";
import Fix from "./decorators/Fix";

interface SystemSettingEntry {
  key: string;
  value: string;
}

interface SystemSettingOptions {
  transaction?: Transaction;
}

@Table({ tableName: "system_settings", modelName: "system_setting" })
@Fix
class SystemSetting extends IdModel<
  InferAttributes<SystemSetting>,
  Partial<InferCreationAttributes<SystemSetting>>
> {
  @Unique
  @Column(DataType.STRING(255))
  key: string;

  @Column(DataType.TEXT)
  value: string;

  /**
   * Creates or updates system settings.
   *
   * @param entries the settings to create or update.
   * @param options optional transaction options.
   * @returns the persisted setting rows.
   */
  public static bulkSet(
    entries: SystemSettingEntry[],
    options: SystemSettingOptions = {}
  ) {
    return this.bulkCreate(entries, {
      transaction: options.transaction,
      updateOnDuplicate: ["value", "updatedAt"],
    });
  }

  /**
   * Returns all system settings as a key/value record.
   *
   * @param options optional transaction options.
   * @returns the settings keyed by environment variable name.
   */
  public static async getAll(options: SystemSettingOptions = {}) {
    const settings = await this.findAll({
      transaction: options.transaction,
    });

    return settings.reduce<Record<string, string>>((acc, setting) => {
      acc[setting.key] = setting.value;
      return acc;
    }, {});
  }

  /**
   * Returns a single system setting.
   *
   * @param key the setting key to retrieve.
   * @param options optional transaction options.
   * @returns the setting value, if present.
   */
  public static async get(key: string, options: SystemSettingOptions = {}) {
    const setting = await this.findOne({
      where: {
        key,
      },
      transaction: options.transaction,
    });

    return setting?.value;
  }
}

export default SystemSetting;
