module.exports = {
  up: (queryInterface, Sequelize) => {
    return queryInterface.createTable('Transactions', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      type: {
        type: Sequelize.ENUM,
        allowNull: false,
        values: ['CREDIT', 'DEBIT'],
      },
      FromAccountId: {
        type: Sequelize.INTEGER,
      },
      FromWalletId: {
        type: Sequelize.INTEGER,
        references: { key: 'id', model: 'Wallets' },
        allowNull: false,
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
      },
      ToAccountId: {
        type: Sequelize.INTEGER,
      },
      ToWalletId: {
        type: Sequelize.INTEGER,
        references: { key: 'id', model: 'Wallets' },
        allowNull: false,
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
      },
      amount: {
        type: Sequelize.INTEGER,
      },
      transactionGroupId: {
        type: Sequelize.UUID,
        allowNull: false,
      },
      transactionGroupSequence: {
        type: Sequelize.INTEGER,
      },
      doubleEntryGroupId: {
        type: Sequelize.UUID,
        allowNull: false,
      },
      currency: {
        type: Sequelize.STRING,
        defaultValue: 'USD'
      },
      category: {
        type: Sequelize.STRING,
      },
      LegacyTransactionId: {
        type: Sequelize.INTEGER,
      },
      createdAt: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('NOW()')
      },
      updatedAt: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('NOW()')
      },
      deletedAt: {
        type: Sequelize.DATE
      },
    }, { timestamps: true });

  },

  down: (queryInterface) => {
    return queryInterface.dropTable('Transactions');
  }
};
