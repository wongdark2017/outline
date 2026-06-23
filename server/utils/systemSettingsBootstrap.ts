import path from "node:path";
import type { SequelizeOptions } from "sequelize-typescript";
import { Sequelize } from "sequelize-typescript";
import { QueryTypes } from "sequelize";
import { Umzug, SequelizeStorage } from "umzug";
import { getArg } from "./args";
import {
  getEnvironment,
  resolveFileSecrets,
} from "./environment";
import {
  applySystemSettingsToEnvironment,
  supportedSystemSettingKeys,
  type SystemSettingEntry,
  type SupportedSystemSettingKey,
} from "./systemSettings";

interface TableExistsRow {
  exists: boolean;
}

interface RawSystemSettingRow {
  key: string;
  value: string;
}

export interface SystemSettingsBootstrapDatabase {
  query<T extends object>(
    sql: string,
    options?: { type: QueryTypes.SELECT; replacements?: Record<string, string> }
  ): Promise<T[]>;
  close(): Promise<void>;
}

type SystemSettingsBootstrapDatabaseFactory =
  () =>
    | SystemSettingsBootstrapDatabase
    | undefined
    | Promise<SystemSettingsBootstrapDatabase | undefined>;

const supportedKeys = new Set<string>(supportedSystemSettingKeys);

/**
 * Loads database-backed system settings before the typed environment singleton
 * and storage modules are initialized.
 *
 * @param createDatabase optional database factory for tests.
 */
export async function bootstrapSystemSettings(
  createDatabase: SystemSettingsBootstrapDatabaseFactory =
    createSystemSettingsBootstrapDatabase
): Promise<void> {
  const database = await createDatabase();

  if (!database) {
    return;
  }

  try {
    if (!(await hasSystemSettingsTable(database))) {
      return;
    }

    const rows = await database.query<RawSystemSettingRow>(
      `SELECT key, value FROM ${quoteIdentifier(getSchemaName())}.${quoteIdentifier(
        "system_settings"
      )}`,
      { type: QueryTypes.SELECT }
    );

    applySystemSettingsToEnvironment(
      rows
        .filter((row): row is SystemSettingEntry =>
          isSupportedSystemSettingRow(row)
        )
        .map((row) => ({
          key: row.key,
          value: row.value,
        }))
    );
    resolveFileSecrets(process.env);
  } finally {
    await database.close();
  }
}

/**
 * Creates a narrow temporary database client using raw pre-bootstrap env.
 *
 * @returns a temporary database client, or undefined when DB config is absent.
 */
export function createSystemSettingsBootstrapDatabase():
  | SystemSettingsBootstrapDatabase
  | undefined {
  return createPreBootstrapSequelize();
}

/**
 * Runs pending migrations before normal runtime modules are imported.
 */
export async function runPreBootstrapMigrations(): Promise<void> {
  const database = createPreBootstrapSequelize();

  if (!database) {
    return;
  }

  try {
    await database.authenticate();

    const migrations = new Umzug({
      migrations: {
        glob: ["migrations/*.js", { cwd: path.resolve("server") }],
        resolve: ({ name, path: migrationPath, context }) => {
          // oxlint-disable-next-line @typescript-eslint/no-require-imports
          const migration = require(migrationPath as string);
          return {
            name,
            up: async () => migration.up(context, Sequelize),
            down: async () => migration.down(context, Sequelize),
          };
        },
      },
      context: database.getQueryInterface(),
      storage: new SequelizeStorage({ sequelize: database }),
      logger: undefined,
    });
    const pending = await migrations.pending();

    if (!pending.length) {
      return;
    }

    if (getArg("no-migrate")) {
      throw new Error(
        `Database migrations are pending and were not run because --no-migrate flag was passed. Run "yarn db:migrate" before starting.`
      );
    }

    await migrations.up();
  } finally {
    await database.close();
  }
}

function createPreBootstrapSequelize(): Sequelize | undefined {
  const rawEnvironment = getEnvironment();
  const databaseConfig =
    rawEnvironment.DATABASE_CONNECTION_POOL_URL ?? rawEnvironment.DATABASE_URL;
  const commonOptions = getCommonDatabaseOptions();

  if (databaseConfig) {
    return new Sequelize(databaseConfig, commonOptions);
  }

  if (
    rawEnvironment.DATABASE_HOST &&
    rawEnvironment.DATABASE_NAME &&
    rawEnvironment.DATABASE_USER
  ) {
    return new Sequelize({
      ...commonOptions,
      database: rawEnvironment.DATABASE_NAME,
      username: rawEnvironment.DATABASE_USER,
      password: rawEnvironment.DATABASE_PASSWORD || undefined,
      host: rawEnvironment.DATABASE_HOST,
      port: rawEnvironment.DATABASE_PORT
        ? parseInt(rawEnvironment.DATABASE_PORT, 10)
        : 5432,
      dialect: "postgres",
    });
  }

  return undefined;
}

async function hasSystemSettingsTable(
  database: SystemSettingsBootstrapDatabase
) {
  const rows = await database.query<TableExistsRow>(
    `
SELECT EXISTS (
  SELECT 1
  FROM information_schema.tables
  WHERE table_schema = :schema
    AND table_name = 'system_settings'
) AS "exists"
`,
    {
      type: QueryTypes.SELECT,
      replacements: {
        schema: getSchemaName(),
      },
    }
  );

  return rows[0]?.exists === true;
}

function getCommonDatabaseOptions(): SequelizeOptions {
  const rawEnvironment = getEnvironment();
  const isProduction = (rawEnvironment.NODE_ENV ?? "production") === "production";

  return {
    logging: false,
    dialectOptions: {
      ssl:
        isProduction && rawEnvironment.PGSSLMODE !== "disable"
          ? {
              rejectUnauthorized: false,
            }
          : false,
    },
  };
}

function getSchemaName() {
  return getEnvironment().DATABASE_SCHEMA ?? "public";
}

function quoteIdentifier(identifier: string) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function isSupportedSystemSettingRow(
  row: RawSystemSettingRow
): row is { key: SupportedSystemSettingKey; value: string } {
  return supportedKeys.has(row.key);
}
