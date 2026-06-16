"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn("users", "passwordHash", {
      type: Sequelize.TEXT,
      allowNull: true,
    });

    await queryInterface.addColumn("users", "failedSignInAttempts", {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
    });

    await queryInterface.addColumn("users", "lockedUntil", {
      type: Sequelize.DATE,
      allowNull: true,
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn("users", "lockedUntil");
    await queryInterface.removeColumn("users", "failedSignInAttempts");
    await queryInterface.removeColumn("users", "passwordHash");
  },
};
