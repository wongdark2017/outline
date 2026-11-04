"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const id = () => ({
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
      });
      const foreign = (model, allowNull = false, onDelete = "CASCADE") => ({
        type: Sequelize.UUID,
        allowNull,
        references: { model, key: "id" },
        onDelete,
      });
      const text = () => ({
        type: Sequelize.TEXT,
        allowNull: false,
        defaultValue: "",
      });
      const version = () => ({
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      });
      const timestamps = () => ({
        createdAt: { type: Sequelize.DATE, allowNull: false },
        updatedAt: { type: Sequelize.DATE, allowNull: false },
      });
      await queryInterface.createTable(
        "customizationAssets",
        {
          id: id(),
          teamId: foreign("teams", true, "SET NULL"),
          userId: foreign("users", true, "SET NULL"),
          ready: {
            type: Sequelize.BOOLEAN,
            allowNull: false,
            defaultValue: false,
          },
          scope: { type: Sequelize.STRING, allowNull: false },
          key: { type: Sequelize.STRING, allowNull: false, unique: true },
          name: { type: Sequelize.STRING, allowNull: false },
          contentType: { type: Sequelize.STRING, allowNull: false },
          size: { type: Sequelize.INTEGER, allowNull: false },
          ...timestamps(),
        },
        { transaction }
      );
      await queryInterface.addIndex(
        "customizationAssets",
        ["teamId", "userId"],
        { transaction }
      );
      await queryInterface.addIndex("customizationAssets", ["createdAt"], {
        transaction,
      });
      await queryInterface.createTable(
        "customizationScriptRevisions",
        {
          id: id(),
          teamId: foreign("teams"),
          publisherId: foreign("users", true, "SET NULL"),
          revision: { type: Sequelize.INTEGER, allowNull: false },
          source: text(),
          modules: {
            type: Sequelize.JSONB,
            allowNull: false,
            defaultValue: {},
          },
          digest: { type: Sequelize.STRING, allowNull: false },
          ...timestamps(),
        },
        { transaction }
      );
      await queryInterface.addIndex(
        "customizationScriptRevisions",
        ["teamId", "revision"],
        { unique: true, transaction }
      );
      await queryInterface.createTable(
        "workspaceCustomizations",
        {
          id: id(),
          teamId: { ...foreign("teams"), unique: true },
          backgroundAssetId: foreign("customizationAssets", true, "SET NULL"),
          backgroundFit: {
            type: Sequelize.STRING,
            allowNull: false,
            defaultValue: "cover",
          },
          backgroundVersion: version(),
          css: text(),
          cssVersion: version(),
          scriptDraft: text(),
          scriptDraftModules: {
            type: Sequelize.JSONB,
            allowNull: false,
            defaultValue: {},
          },
          scriptDraftVersion: version(),
          publishedScriptId: foreign(
            "customizationScriptRevisions",
            true,
            "SET NULL"
          ),
          ...timestamps(),
        },
        { transaction }
      );
      await queryInterface.addIndex(
        "workspaceCustomizations",
        ["backgroundAssetId"],
        { transaction }
      );
      await queryInterface.createTable(
        "userCustomizations",
        {
          id: id(),
          teamId: foreign("teams"),
          userId: { ...foreign("users"), unique: true },
          backgroundSource: {
            type: Sequelize.STRING,
            allowNull: false,
            defaultValue: "inherit",
          },
          backgroundAssetId: foreign("customizationAssets", true, "SET NULL"),
          backgroundFit: {
            type: Sequelize.STRING,
            allowNull: false,
            defaultValue: "cover",
          },
          backgroundVersion: version(),
          css: text(),
          cssVersion: version(),
          enabledScriptId: foreign(
            "customizationScriptRevisions",
            true,
            "SET NULL"
          ),
          enabledScriptDigest: { type: Sequelize.STRING, allowNull: true },
          ...timestamps(),
        },
        { transaction }
      );
      await queryInterface.addIndex("userCustomizations", ["teamId"], {
        transaction,
      });
      await queryInterface.addIndex(
        "userCustomizations",
        ["backgroundAssetId"],
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      for (const table of [
        "userCustomizations",
        "workspaceCustomizations",
        "customizationScriptRevisions",
        "customizationAssets",
      ]) {
        await queryInterface.dropTable(table, { transaction });
      }
    });
  },
};
