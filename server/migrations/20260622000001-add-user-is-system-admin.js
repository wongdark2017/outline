"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    return queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.addColumn(
        "users",
        "isSystemAdmin",
        {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        },
        { transaction }
      );

      await queryInterface.sequelize.query(
        'CREATE UNIQUE INDEX "users_is_system_admin" ON "users" ("isSystemAdmin") WHERE "isSystemAdmin" = true',
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    return queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        'DROP INDEX IF EXISTS "users_is_system_admin"',
        { transaction }
      );
      await queryInterface.removeColumn("users", "isSystemAdmin", {
        transaction,
      });
    });
  },
};
