"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("attachments", "memoId", {
      type: Sequelize.UUID,
      allowNull: true,
      references: {
        model: "memos",
        key: "id",
      },
      onDelete: "set null",
    });

    await queryInterface.addIndex("attachments", ["memoId"]);
  },

  async down(queryInterface) {
    await queryInterface.removeIndex("attachments", ["memoId"]);
    await queryInterface.removeColumn("attachments", "memoId");
  },
};
