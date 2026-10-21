'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    /**
     * Add altering commands here.
     *
     * Example:
     * await queryInterface.createTable('users', { id: Sequelize.INTEGER });
     */
    await queryInterface.sequelize.transaction(async (transaction) =>{
      await queryInterface.createTable(
        "reminders",
        {
          id:{
            type: Sequelize.UUID,
            allowNull: false,
            primaryKey: true,
          },
          remindAt:{
            type: Sequelize.DATE,
            allowNull:false
          },
          note:{
            type: Sequelize.STRING,
            allowNull: true
          },
          sentAt:{
            type: Sequelize.DATE,
            allowNull:true
          },
          userId:{
            type: Sequelize.UUID,
            allowNull: false,
            onDelete: "cascade",
            references: {model: "users"},
          },
          documentId:{
            type: Sequelize.UUID,
            allowNull: false,
            onDelete: "cascade",
            references: {model: "documents"},
          },
          teamId:{
            type: Sequelize.UUID,
            allowNull:false,
            onDelete:"cascade",
            references:{model: "teams"},
          },
          createdAt:{
            type:Sequelize.DATE,
            allowNull:false
          },
          updatedAt:{
            type:Sequelize.DATE,
            allowNull:false
          },
      },{transaction});

      await queryInterface.addIndex("reminders",["userId","remindAt"],{transaction});

      await queryInterface.addIndex("reminders",["remindAt"],{
       name: "reminders_unsent_remind_at",
       where: {sentAt:null},
       transaction, 
      });
    });
  },

  async down(queryInterface, Sequelize) {
    /**
     * Add reverting commands here.
     *
     * Example:
     * await queryInterface.dropTable('users');
     */
    await queryInterface.dropTable("reminders");
  }
};
