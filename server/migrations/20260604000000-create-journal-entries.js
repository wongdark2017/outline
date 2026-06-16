"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    return queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        "journal_entries",
        {
          id: {
            type: Sequelize.UUID,
            allowNull: false,
            defaultValue: Sequelize.UUIDV4,
            primaryKey: true,
          },
          userId: {
            type: Sequelize.UUID,
            allowNull: false,
            references: {
              model: "users",
              key: "id",
            },
            onDelete: "CASCADE",
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
          documentId: {
            type: Sequelize.UUID,
            allowNull: false,
            references: {
              model: "documents",
              key: "id",
            },
            onDelete: "CASCADE",
          },
          date: {
            type: Sequelize.DATEONLY,
            allowNull: false,
          },
          mood: {
            type: Sequelize.ENUM(
              "productive",
              "neutral",
              "tired",
              "inspired",
              "frustrated"
            ),
            allowNull: true,
          },
          tags: {
            type: Sequelize.JSONB,
            allowNull: false,
            defaultValue: [],
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

      await queryInterface.addIndex(
        "journal_entries",
        ["teamId", "userId", "date"],
        {
          unique: true,
          name: "journal_entries_team_user_date",
          transaction,
        }
      );

      await queryInterface.addIndex("journal_entries", ["userId", "date"], {
        transaction,
      });

      await queryInterface.addIndex("journal_entries", ["teamId", "date"], {
        transaction,
      });

      await queryInterface.addIndex("journal_entries", ["documentId"], {
        name: "journal_entries_document_id",
        transaction,
      });
    });
  },

  async down(queryInterface) {
    return queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.dropTable("journal_entries", { transaction });
      await queryInterface.sequelize.query(
        'DROP TYPE IF EXISTS "enum_journal_entries_mood";',
        { transaction }
      );
    });
  },
};
