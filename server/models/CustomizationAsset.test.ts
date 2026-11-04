import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { DataTypes, QueryTypes } from "sequelize";
import type { Transaction } from "sequelize";
import { CustomizationAsset } from "@server/models";
import { sequelize } from "@server/storage/database";

interface MigrationDatabase {
  sequelize: {
    transaction(
      callback: (transaction: Transaction) => Promise<void>
    ): Promise<void>;
    query(sql: string, options: { transaction: Transaction }): Promise<void>;
  };
}

interface ReadinessMigration {
  up(database: MigrationDatabase): Promise<void>;
  down(): Promise<void>;
}

interface BackgroundReference {
  backgroundAssetId: string;
}

const require = createRequire(import.meta.url);
const candidate: unknown = require("../migrations/20261104064021-repair-customization-asset-readiness.js");
if (!isReadinessMigration(candidate)) {
  throw new Error("The customization readiness migration is invalid");
}
const migration = candidate;
const database = sequelize.getQueryInterface();

describe("customization image readiness migration", () => {
  let schema: string;

  beforeEach(async () => {
    schema = `customization_readiness_${randomUUID().replace(/-/g, "")}`;
    await database.createSchema(schema);
    await sequelize.query(
      `CREATE TABLE "${schema}"."customizationAssets" (LIKE "customizationAssets" INCLUDING ALL)`
    );
    await database.createTable(
      { tableName: "workspaceCustomizations", schema },
      {
        id: { type: DataTypes.UUID, primaryKey: true },
        backgroundAssetId: {
          type: DataTypes.UUID,
          references: {
            model: { tableName: "customizationAssets", schema },
            key: "id",
          },
          onDelete: "SET NULL",
        },
      }
    );
  });

  afterEach(async () => {
    await database.dropSchema(schema);
  });

  it("leaves a complete schema, saved readiness, and background references unchanged", async () => {
    const image = await createImage(true);
    await referenceImage(image.id);
    const before = await database.describeTable({
      tableName: "customizationAssets",
      schema,
    });

    await migration.up(scopedDatabase());

    expect(
      await database.describeTable({ tableName: "customizationAssets", schema })
    ).toEqual(before);
    await image.reload();
    expect(image.ready).toBe(true);
    expect(await references()).toEqual([{ backgroundAssetId: image.id }]);
  });

  it("adds the missing column without changing legacy rows, references, or upload readiness", async () => {
    const table = { tableName: "customizationAssets", schema };
    await database.removeColumn(table, "ready");
    const id = randomUUID();
    const key = `customizations/legacy/${id}.png`;
    await database.bulkInsert(table, [
      {
        id,
        scope: "personal",
        key,
        name: "legacy.png",
        contentType: "image/png",
        size: 100,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    await referenceImage(id);

    await migration.up(scopedDatabase());

    const columns = await database.describeTable(table);
    expect(columns.ready.type).toEqual("BOOLEAN");
    expect(columns.ready.allowNull).toBe(false);
    expect(columns.ready.defaultValue).toBe(false);
    const restored = await CustomizationAsset.schema(schema).findByPk(id, {
      rejectOnEmpty: true,
    });
    expect(restored.key).toEqual(key);
    expect(restored.ready).toBe(false);
    expect(await references()).toEqual([{ backgroundAssetId: id }]);

    const uploaded = await createImage();
    await uploaded.reload();
    expect(uploaded.ready).toBe(false);
    await uploaded.update({ ready: true });
    await uploaded.reload();
    expect(uploaded.ready).toBe(true);
    await expect(
      database.bulkUpdate(table, { ready: null }, { id: uploaded.id })
    ).rejects.toMatchObject({ name: "SequelizeDatabaseError" });
  });

  it("preserves readiness and references across repeated application and compensation rollback", async () => {
    const table = { tableName: "customizationAssets", schema };
    await database.removeColumn(table, "ready");
    await migration.up(scopedDatabase());
    const image = await createImage(true);
    await referenceImage(image.id);

    await migration.up(scopedDatabase());
    await migration.down();
    await migration.down();

    await image.reload();
    expect(image.ready).toBe(true);
    expect(await references()).toEqual([{ backgroundAssetId: image.id }]);
    expect((await database.describeTable(table)).ready.allowNull).toBe(false);
  });

  it("keeps the original migration's existing column when compensation is rolled back", async () => {
    const image = await createImage(false);
    await migration.up(scopedDatabase());
    await migration.down();

    await image.reload();
    expect(image.ready).toBe(false);
    expect(await CustomizationAsset.schema(schema).count()).toEqual(1);
  });

  function scopedDatabase(): MigrationDatabase {
    return {
      sequelize: {
        transaction(callback) {
          return sequelize.transaction(callback);
        },
        async query(sql, options) {
          // Execute the actual migration against a private test schema only.
          await sequelize.query(
            sql.replace(
              '"customizationAssets"',
              `"${schema}"."customizationAssets"`
            ),
            options
          );
        },
      },
    };
  }

  function createImage(ready = false) {
    return CustomizationAsset.schema(schema).create({
      scope: "personal",
      key: `customizations/test/${randomUUID()}.png`,
      name: "background.png",
      contentType: "image/png",
      size: 100,
      ready,
    });
  }

  async function referenceImage(assetId: string) {
    await database.bulkInsert(
      { tableName: "workspaceCustomizations", schema },
      [{ id: randomUUID(), backgroundAssetId: assetId }]
    );
  }

  function references() {
    return sequelize.query<BackgroundReference>(
      `SELECT "backgroundAssetId" FROM "${schema}"."workspaceCustomizations"`,
      { type: QueryTypes.SELECT }
    );
  }
});

function isReadinessMigration(value: unknown): value is ReadinessMigration {
  return (
    !!value &&
    typeof value === "object" &&
    "up" in value &&
    typeof value.up === "function" &&
    "down" in value &&
    typeof value.down === "function"
  );
}
