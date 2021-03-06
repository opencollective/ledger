import AbstractCrudService from './abstractCrudService';
import LedgerTransaction from '../models/LedgerTransaction';
import TransactionRegularStrategy from '../strategies/transactionRegularStrategy';
import TransactionForexStrategy from '../strategies/transactionForexStrategy';
import TransactionRefundStrategy from '../strategies/transactionRefundStrategy';
import TransactionForexRefundStrategy from '../strategies/transactionForexRefundStrategy';
import Wallet from '../models/Wallet';
import Database from '../models';
import transactionCategoryEnum from '../globals/enums/transactionCategoryEnum';

export default class TransactionService extends AbstractCrudService {

  constructor() {
    super(LedgerTransaction);
    this.database = new Database();
  }

  get(query = {}) {
    const { includeHostedCollectivesTransactions, ...idsQuery } = query;
    idsQuery.include = [{ model: Wallet, as: 'fromWallet' }, { model: Wallet, as: 'toWallet' }];
    return this.getLegacyCreditTransactionsIdsOrderByCreatedAt(idsQuery, includeHostedCollectivesTransactions)
    .then(groupLegacyIdAndDateArr => {
      if (!groupLegacyIdAndDateArr || !groupLegacyIdAndDateArr[0]) {
        throw new Error('no results were found');
      }
      const groupLegacyCreditIds = groupLegacyIdAndDateArr[0].map(t => t.LegacyCreditTransactionId);
      const legacyIdQuery = {
        where: {
          LegacyCreditTransactionId: groupLegacyCreditIds,
        },
        include: [{ model: Wallet, as: 'fromWallet' }, { model: Wallet, as: 'toWallet' }],
      };
      return super.get(legacyIdQuery);
    });
  }

  async getLegacyCreditTransactionsIdsOrderByCreatedAt(query = {}, includeHostedCollectivesTransactions) {
    const where = JSON.parse(query.where);
    includeHostedCollectivesTransactions = includeHostedCollectivesTransactions && JSON.parse(includeHostedCollectivesTransactions);
    let groupByQuery = ' GROUP BY "LegacyCreditTransactionId", "ToAccountId" ';
    let havingQuery = ` HAVING "ToAccountId"='${where.ToAccountId}' `;
    if (!includeHostedCollectivesTransactions) {
      groupByQuery += ' , category ';
      havingQuery += ` AND category='${transactionCategoryEnum.ACCOUNT}' `;
    }
    const ledgerQuery = `
    WITH groupIds AS (SELECT max("createdAt") as "createdAt",
      "LegacyCreditTransactionId"
      FROM "LedgerTransactions"
      ${groupByQuery}
      ${havingQuery})
    SELECT * FROM groupIds ORDER BY "createdAt" DESC limit ${query.limit || 20};`;
    return this.database.sequelize.query(ledgerQuery);
  }

  /** Given a transaction, identify which kind of transaction it will be and
  **  persists the group of transactions it will generate
  * @param {Object} incomingTransaction - transaction
  * @return {Array} containing the original incoming transaction + its double entry equivalent.
  */
  async insert(data) {
    const parsedTransaction = this.parseTransaction(data);
    return this.insertParsedTransaction(parsedTransaction);

  }
  /** inserts a transaction that is already in the "ledger" format
   ** which in practice will mean this already Parsed transaction will be independent
   ** from the opencollective-api(it won't happen at the moment)
   * @param {Object} parsedTransaction - transaction parsed in ledger format
   * @return {Array} list of inserted transactions
  */
  async insertParsedTransaction(parsedTransaction) {
    const sequencedTransaction = await this.getSequencedTransactions(parsedTransaction);
    return this.insertMultipleParsedTransactions(sequencedTransaction);
  }

  /** Defines Strategy, get transactions from strategy and sequence them
  * @param {Object} data - transaction object
  * @return {Array} of transactions
  */
  async getSequencedTransactions(data) {
    // the strategy will return an array of transactions already formatted for the db
    const strategy = await this._defineTransactionStrategy(data);
    const transactions = await strategy.getTransactions();
    // adding transactionGroupSequence to the batch of transactions
    for (const index in transactions) {
    transactions[index].transactionGroupSequence = parseInt(index);
    }
    return transactions;
  }


  /** Given an array of Ledger formatted transactions, bulk insert them
  * @param {Array} transactions - array of transactions
  * @return {Array} of transactions
  */
  async insertMultipleParsedTransactions(transactions) {
    // Creating a Sequelize "Managed transaction" which automatically commits
    // if all transactions are done or rollback if any of them fail.
    return this.database.sequelize.transaction( t => {
      return this.model.bulkCreate(transactions, { transaction: t });
    }).then( result => {
      this.logger.info('Transactions created successfully');
      return result;
    }).catch( error => {
      this.logger.error('Rolling Back Transactions', error);
      throw error;
    });
  }

  /** Given a transaction, return the related "strategy" Object
  * @param {Object} incomingTransaction - transaction
  * @return {Object} strategy - Return defined Strategy Class Object
  */
  async _defineTransactionStrategy(transaction) {
    // boolean to check whether it's has fields and conditions to be a Legacy Refund transaction
    const legacyDbRefund = transaction.RefundTransactionId && transaction.LegacyCreditTransactionId > transaction.RefundTransactionId;
    // Check if it is NOT a foreign exchange Transaction
    if (!transaction.destinationCurrency || transaction.destinationCurrency === transaction.currency) {
      // Check whether it's a REFUND either through current case or through a legacy transaction
      if (transaction.refundTransactionGroupId || legacyDbRefund) {
        return new TransactionRefundStrategy(transaction);
      }
      return new TransactionRegularStrategy(transaction);
    }
    // Check whether the forex Transaction is also a REFUND transaction
    if (transaction.refundTransactionGroupId || legacyDbRefund) {
      return new TransactionForexRefundStrategy(transaction);
    }
    return new TransactionForexStrategy(transaction);
  }

  /**
   * Parse incoming transaction to be formatted as a Ledger transaction
   * and then insert transaction into ledger database
   * @param {Object} transaction - Object base on the current Transaction model(https://github.com/opencollective/opencollective-api/blob/master/server/models/Transaction.js)
   */
  parseAndInsertTransaction(transaction) {
    const parsedTransaction = this.parseTransaction(transaction);
    return this.insert(parsedTransaction);
  }

  /**
   * Parse incoming transaction to be formatted as a Ledger transaction considering the
   * current Transaction model of the opencollective-api project
   * @param {Object} transaction - Object base on the current Transaction model(https://github.com/opencollective/opencollective-api/blob/master/server/models/Transaction.js)
   */
  parseTransaction(transaction) {
    // We define all properties of the new ledger here, except for all wallets(from, to, and fees)
      // and the WalletProvider and PaymentProvider Account ids
      const hostCurrency = transaction.hostCurrency || transaction.currency;
      const amountInHostCurrency = transaction.amountInHostCurrency || transaction.amount;
      // make fees positive as fees are negative in CREDIT transactions(We expect only incoming legacy CREDIT transaction)...
      const hostFeeInHostCurrency = -1 * transaction.hostFeeInHostCurrency;
      const platformFeeInHostCurrency = -1 * transaction.platformFeeInHostCurrency;
      const paymentProcessorFeeInHostCurrency = -1 * transaction.paymentProcessorFeeInHostCurrency;
      const ledgerTransaction = {
        FromAccountId: transaction.FromCollectiveId,
        ToAccountId:  transaction.CollectiveId,
        amount: transaction.amount,
        currency: transaction.currency,
        destinationAmount: amountInHostCurrency, // ONLY for FOREX transactions(currency != hostCurrency)
        destinationCurrency: hostCurrency, // ONLY for FOREX transactions(currency != hostCurrency)
        walletProviderFee: hostFeeInHostCurrency,
        platformFee: platformFeeInHostCurrency,
        paymentProviderFee: paymentProcessorFeeInHostCurrency,
        LegacyCreditTransactionId: transaction.id,
        LegacyDebitTransactionId: transaction.debitId,
        forexRate: transaction.hostCurrencyFxRate,
        forexRateSourceCoin: transaction.currency,
        forexRateDestinationCoin: transaction.hostCurrency,
        description: transaction.description,
        RefundTransactionId: transaction.RefundTransactionId,
        SourcePaymentMethodId: transaction.SourcePaymentMethodId,
        createdAt: transaction.createdAt,
        updatedAt: transaction.updatedAt,
        toWallet: {
          name: `owner: ${transaction.collectiveHostSlug}, account: ${transaction.collectiveSlug}, ${hostCurrency}`,
          currency: hostCurrency,
          AccountId: transaction.CollectiveId,
          OwnerAccountId: transaction.CollectiveHostId,
        },
        fromWallet: {
          name: '',
          currency: transaction.currency,
          AccountId: transaction.FromCollectiveId,
          PaymentMethodId: transaction.PaymentMethodId || null,
          SourcePaymentMethodId: transaction.SourcePaymentMethodId || null,
          ExpenseId: transaction.ExpenseId || null,
          OrderId: transaction.OrderId || null,
        },
      };
      if (transaction.HostCollectiveId) {
        // replace toWallet.OwnerAccountId by Host present in transaction
        ledgerTransaction.toWallet.name = `owner: ${transaction.hostCollectiveSlug},`+
          ` account: ${transaction.collectiveSlug}, ${hostCurrency}`;
        ledgerTransaction.toWallet.OwnerAccountId = transaction.HostCollectiveId;
        // if there is HostCollectiveId and hostFeeInHostCurrency, so we add the Wallet Provider
        // according to the Host Collective properties
        if (hostFeeInHostCurrency) {
          ledgerTransaction.walletProviderWallet = {
            name: `owner and account: ${transaction.hostCollectiveSlug}, multi-currency`,
            currency: null,
            AccountId: transaction.HostCollectiveId,
            OwnerAccountId: transaction.HostCollectiveId,
          };
        }
      } else {
        // setting toWallet properties in case there's no host fees
        ledgerTransaction.toWallet.name = ledgerTransaction.toWallet.OwnerAccountId
          ? ledgerTransaction.toWallet.name
          : `owner: ${transaction.collectiveSlug}, account: ${transaction.collectiveSlug}, ${hostCurrency}`;
        ledgerTransaction.toWallet.OwnerAccountId = ledgerTransaction.toWallet.OwnerAccountId || transaction.CollectiveId;
        // if there is No HostCollectiveId but there ishostFeeInHostCurrency,
        // We add the wallet provider through either the ExpenseId or OrderId
        if (hostFeeInHostCurrency) {
          if (transaction.ExpenseId) {
            // setting toWallet properties in case there's host fees through an Expense
            ledgerTransaction.toWallet.name = ledgerTransaction.toWallet.OwnerAccountId
              ? ledgerTransaction.toWallet.name
              :`owner: ${transaction.expensePayoutMethod}(through ${transaction.expenseUserPaypalEmail})`+
              `, account: ${transaction.collectiveSlug}, ${hostCurrency}`;
            ledgerTransaction.toWallet.OwnerAccountId = ledgerTransaction.toWallet.OwnerAccountId ||
              `payment method: ${transaction.expensePayoutMethod}, `+
              `paypal email: ${transaction.expenseUserPaypalEmail}`;
            // setting wallet provider wallet
            ledgerTransaction.walletProviderWallet = {
              name: `owner and account: ${transaction.expensePayoutMethod}, multi-currency`,
              currency: transaction.expenseCurrency,
              AccountId: transaction.expensePayoutMethod,
              OwnerAccountId: transaction.expensePayoutMethod,
            };
          } else { // Order
            // setting toWallet properties in case there's host fees through an Expense
            ledgerTransaction.toWallet.name = ledgerTransaction.toWallet.OwnerAccountId
              ? ledgerTransaction.toWallet.name
              : `owner: ${transaction.orderPaymentMethodCollectiveSlug}, ` +
                `account: ${transaction.collectiveSlug}, ${hostCurrency}`;
            ledgerTransaction.toWallet.OwnerAccountId = ledgerTransaction.toWallet.OwnerAccountId
              || transaction.orderPaymentMethodCollectiveId;
            // setting wallet provider wallet
            ledgerTransaction.walletProviderWallet = {
              name: `owner and account: ${transaction.orderPaymentMethodCollectiveSlug}, multi-currency`,
              currency: null,
              AccountId: transaction.orderPaymentMethodCollectiveId,
              OwnerAccountId: transaction.orderPaymentMethodCollectiveId,
            };
          }
        }
      }
      // setting wallet provider account id
      ledgerTransaction.WalletProviderAccountId =
        ledgerTransaction.walletProviderWallet && ledgerTransaction.walletProviderWallet.AccountId;
      // setting from and payment provider wallets fields through one of the following:
      // PaymentMethodId or ExpenseId or OrderId, respectively
      if (transaction.PaymentMethodId) {
        ledgerTransaction.fromWallet.name = `owner: ${transaction.paymentMethodCollectiveSlug}, account: ${transaction.fromCollectiveSlug}, ${transaction.currency}`;
        ledgerTransaction.fromWallet.OwnerAccountId = transaction.paymentMethodCollectiveId;
        // creating Payment Provider wallet
        ledgerTransaction.paymentProviderWallet = {
          name: transaction.paymentMethodType,
          currency: null,
          AccountId: transaction.paymentMethodService,
          OwnerAccountId: transaction.paymentMethodService,
        };
      } else if (transaction.ExpenseId) {
        ledgerTransaction.fromWallet.name = `owner: ${transaction.expenseCollectiveSlug}, account: ${transaction.fromCollectiveSlug}, ${transaction.currency}`;
        ledgerTransaction.fromWallet.OwnerAccountId = transaction.expenseCollectiveId;
        ledgerTransaction.paymentProviderWallet = {
          name: `owner and account: ${transaction.expensePayoutMethod}, multi-currency`,
          currency: null,
          AccountId: transaction.expensePayoutMethod,
          OwnerAccountId: transaction.expensePayoutMethod,
        };
      } else {
        // Order has PaymentMethod, then the slug will come from the transaction.order.paymentmethod
        // otherwise we will consider transaction.order.fromCollective as the owner
        if (transaction.orderPaymentMethodCollectiveSlug) {
          ledgerTransaction.fromWallet.name = `owner: ${transaction.orderPaymentMethodCollectiveSlug}, account: ${transaction.fromCollectiveSlug}, ${transaction.currency}`;
          ledgerTransaction.fromWallet.OwnerAccountId = transaction.orderPaymentMethodCollectiveId;
          ledgerTransaction.paymentProviderWallet = {
            name: `account and owner:${transaction.orderPaymentMethodService}, service: ${transaction.orderPaymentMethodService}, type: ${transaction.orderPaymentMethodType}`,
            currency: null,
            AccountId: transaction.orderPaymentMethodService,
            OwnerAccountId: transaction.orderPaymentMethodService,
          };
        } else {
          ledgerTransaction.fromWallet.name = `owner: ${transaction.orderFromCollectiveSlug}, account: ${transaction.fromCollectiveSlug}, ${hostCurrency}`;
          ledgerTransaction.fromWallet.OwnerAccountId = transaction.orderFromCollectiveId;
          ledgerTransaction.paymentProviderWallet = {
            name: `Payment Provider, account and owner:${transaction.orderFromCollectiveSlug}(FromCollective slug, Order id ${transaction.OrderId})`,
            currency: null,
            AccountId: `${transaction.orderFromCollectiveId}_${transaction.OrderId}`,
            OwnerAccountId: `${transaction.orderFromCollectiveId}_${transaction.OrderId}`,
          };
        }
      }
      // setting payment provider provider account id
      ledgerTransaction.PaymentProviderAccountId = ledgerTransaction.paymentProviderWallet && ledgerTransaction.paymentProviderWallet.AccountId;
      return ledgerTransaction;
  }

}
