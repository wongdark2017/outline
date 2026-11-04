"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    // Early development databases may have recorded the initial migration before
    // readiness was added. Existing uploads remain unready until storage succeeds.
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        'ALTER TABLE "customizationAssets" ADD COLUMN IF NOT EXISTS "ready" BOOLEAN NOT NULL DEFAULT false;',
        { transaction }
      );
    });
  },

  down() {
    // The initial migration owns readiness on complete databases. Removing it here
    // would damage that schema; rolling back the initial migration drops the table.
    return Promise.resolve();
  },
};
