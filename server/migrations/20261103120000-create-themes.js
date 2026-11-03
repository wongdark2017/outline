"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        "themes",
        {
          id: {
            type: Sequelize.UUID,
            primaryKey: true,
            allowNull: false,
          },
          name: {
            type: Sequelize.STRING,
            allowNull: false,
          },
          light: {
            type: Sequelize.JSONB,
            allowNull: false,
            defaultValue: {},
          },
          dark: {
            type: Sequelize.JSONB,
            allowNull: false,
            defaultValue: {},
          },
          teamId: {
            type: Sequelize.UUID,
            allowNull: false,
            references: {
              model: "teams",
              key: "id",
            },
            onDelete: "CASCADE",
          },
          createdById: {
            type: Sequelize.UUID,
            allowNull: false,
            references: {
              model: "users",
              key: "id",
            },
            onDelete: "CASCADE",
          },
          createdAt: {
            type: Sequelize.DATE,
            allowNull: false,
          },
          updatedAt: {
            type: Sequelize.DATE,
            allowNull: false,
          },
        },
        { transaction }
      );

      await queryInterface.addIndex("themes", ["teamId"], { transaction });
      await queryInterface.addIndex("themes", ["createdById"], {
        transaction,
      });
      await queryInterface.addIndex("themes", ["teamId", "name"], {
        unique: true,
        transaction,
      });
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("themes");
  },
};
