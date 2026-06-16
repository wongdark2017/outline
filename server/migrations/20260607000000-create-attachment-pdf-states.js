"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    return queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        "attachment_pdf_states",
        {
          id: {
            type: Sequelize.UUID,
            allowNull: false,
            defaultValue: Sequelize.UUIDV4,
            primaryKey: true,
          },
          data: {
            type: Sequelize.JSONB,
            allowNull: false,
            defaultValue: {
              version: 2,
              annotations: [],
            },
          },
          revision: {
            type: Sequelize.INTEGER,
            allowNull: false,
            defaultValue: 0,
          },
          teamId: {
            type: Sequelize.UUID,
            allowNull: false,
            references: {
              model: "teams",
              key: "id",
            },
            onDelete: "CASCADE",
            onUpdate: "CASCADE",
          },
          documentId: {
            type: Sequelize.UUID,
            allowNull: false,
            references: {
              model: "documents",
              key: "id",
            },
            onDelete: "CASCADE",
            onUpdate: "CASCADE",
          },
          attachmentId: {
            type: Sequelize.UUID,
            allowNull: false,
            references: {
              model: "attachments",
              key: "id",
            },
            onDelete: "CASCADE",
            onUpdate: "CASCADE",
          },
          createdById: {
            type: Sequelize.UUID,
            allowNull: true,
            references: {
              model: "users",
              key: "id",
            },
            onDelete: "SET NULL",
            onUpdate: "CASCADE",
          },
          updatedById: {
            type: Sequelize.UUID,
            allowNull: true,
            references: {
              model: "users",
              key: "id",
            },
            onDelete: "SET NULL",
            onUpdate: "CASCADE",
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
        "attachment_pdf_states",
        ["documentId", "attachmentId"],
        {
          unique: true,
          name: "attachment_pdf_states_document_attachment",
          transaction,
        }
      );

      await queryInterface.addIndex("attachment_pdf_states", ["attachmentId"], {
        name: "attachment_pdf_states_attachment_id",
        transaction,
      });

      await queryInterface.addIndex(
        "attachment_pdf_states",
        ["teamId", "documentId"],
        {
          name: "attachment_pdf_states_team_document",
          transaction,
        }
      );
    });
  },

  async down(queryInterface) {
    return queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.dropTable("attachment_pdf_states", { transaction });
    });
  },
};
