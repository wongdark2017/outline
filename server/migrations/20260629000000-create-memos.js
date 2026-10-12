"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("memos", {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
      },
      content: {
        type: Sequelize.JSONB,
        allowNull: false,
      },
      tags: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      visibility: {
        type: Sequelize.ENUM("private", "workspace", "public"),
        allowNull: false,
        defaultValue: "private",
      },
      userId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: "users",
          key: "id",
        },
        onDelete: "cascade",
      },
      teamId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: "teams",
          key: "id",
        },
        onDelete: "cascade",
      },
      archivedAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      deletedAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });

    await queryInterface.addIndex("memos", ["teamId", "userId", "createdAt"]);
    await queryInterface.addIndex("memos", ["teamId", "visibility", "createdAt"]);
    await queryInterface.addIndex("memos", ["tags"], {
      using: "gin",
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex("memos", ["teamId", "userId", "createdAt"]);
    await queryInterface.removeIndex("memos", ["teamId", "visibility", "createdAt"]);
    await queryInterface.removeIndex("memos", ["tags"]);
    await queryInterface.dropTable("memos");
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_memos_visibility";');
  },
};
