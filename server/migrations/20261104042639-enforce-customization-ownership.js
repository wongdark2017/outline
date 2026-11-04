"use strict";

const uniqueKeys = [
  {
    table: "users",
    name: "users_customization_id_team_unique",
    fields: ["id", "teamId"],
  },
  {
    table: "customizationAssets",
    name: "customization_assets_id_team_scope_unique",
    fields: ["id", "teamId", "scope"],
  },
  {
    table: "customizationAssets",
    name: "customization_assets_id_team_user_scope_unique",
    fields: ["id", "teamId", "userId", "scope"],
  },
  {
    table: "customizationScriptRevisions",
    name: "customization_revisions_id_team_unique",
    fields: ["id", "teamId"],
  },
];

const foreignKeys = [
  {
    table: "customizationAssets",
    name: "customization_assets_owner_team_fk",
    fields: ["userId", "teamId"],
    references: { table: "users", fields: ["id", "teamId"] },
  },
  {
    table: "customizationScriptRevisions",
    name: "customization_revisions_publisher_team_fk",
    fields: ["publisherId", "teamId"],
    references: { table: "users", fields: ["id", "teamId"] },
  },
  {
    table: "userCustomizations",
    name: "user_customizations_owner_team_fk",
    fields: ["userId", "teamId"],
    references: { table: "users", fields: ["id", "teamId"] },
  },
  {
    table: "workspaceCustomizations",
    name: "workspace_customizations_background_team_scope_fk",
    fields: ["backgroundAssetId", "teamId", "backgroundAssetScope"],
    references: {
      table: "customizationAssets",
      fields: ["id", "teamId", "scope"],
    },
  },
  {
    table: "userCustomizations",
    name: "user_customizations_background_owner_scope_fk",
    fields: ["backgroundAssetId", "teamId", "userId", "backgroundAssetScope"],
    references: {
      table: "customizationAssets",
      fields: ["id", "teamId", "userId", "scope"],
    },
  },
  {
    table: "workspaceCustomizations",
    name: "workspace_customizations_script_team_fk",
    fields: ["publishedScriptId", "teamId"],
    references: {
      table: "customizationScriptRevisions",
      fields: ["id", "teamId"],
    },
  },
  {
    table: "userCustomizations",
    name: "user_customizations_script_team_fk",
    fields: ["enabledScriptId", "teamId"],
    references: {
      table: "customizationScriptRevisions",
      fields: ["id", "teamId"],
    },
  },
];

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      for (const { table, ...key } of uniqueKeys) {
        await queryInterface.addConstraint(table, {
          ...key,
          type: "unique",
          transaction,
        });
      }

      // Fixed database-generated discriminators also enforce image scope for raw writes.
      await queryInterface.sequelize.query(
        `ALTER TABLE "workspaceCustomizations" ADD COLUMN "backgroundAssetScope" VARCHAR(255) GENERATED ALWAYS AS ('workspace'::VARCHAR(255)) STORED`,
        { transaction }
      );
      await queryInterface.sequelize.query(
        `ALTER TABLE "userCustomizations" ADD COLUMN "backgroundAssetScope" VARCHAR(255) GENERATED ALWAYS AS ('personal'::VARCHAR(255)) STORED`,
        { transaction }
      );

      // The original single-column FKs retain SET NULL/CASCADE deletion behavior.
      // Defer ownership checks until those cascades have finished, without nulling teamId.
      for (const { table, ...key } of foreignKeys) {
        await queryInterface.addConstraint(table, {
          ...key,
          type: "foreign key",
          onDelete: "NO ACTION",
          onUpdate: "NO ACTION",
          deferrable: Sequelize.Deferrable.INITIALLY_DEFERRED,
          transaction,
        });
      }
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      for (const { table, name } of [...foreignKeys].reverse()) {
        await queryInterface.removeConstraint(table, name, { transaction });
      }
      await queryInterface.removeColumn(
        "userCustomizations",
        "backgroundAssetScope",
        { transaction }
      );
      await queryInterface.removeColumn(
        "workspaceCustomizations",
        "backgroundAssetScope",
        { transaction }
      );
      for (const { table, name } of [...uniqueKeys].reverse()) {
        await queryInterface.removeConstraint(table, name, { transaction });
      }
    });
  },
};
