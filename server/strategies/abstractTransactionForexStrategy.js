import AbstractTransactionStrategy from './abstractTransactionStrategy';
import { operationNotAllowed } from '../globals/errors';

export default class AbstractTransactionForexStrategy extends AbstractTransactionStrategy {

  constructor(incomingTransaction) {
    super(incomingTransaction);
    this._validateForexTransaction();
  }

  async findOrCreateAccountWallets() {
    // finding or creating from and to Wallets
    this.incomingTransaction.fromWallet = await this.walletLib.findOrCreateCurrencyWallet(
      this.incomingTransaction.FromWalletName,
      this.incomingTransaction.currency,
      this.incomingTransaction.FromAccountId
    );
    this.incomingTransaction.toWallet = await this.walletLib.findOrCreateCurrencyWallet(
      this.incomingTransaction.ToWalletName,
      this.incomingTransaction.destinationCurrency,
      this.incomingTransaction.ToAccountId
    );
    this.incomingTransaction.FromWalletId = this.incomingTransaction.fromWallet.id;
    this.incomingTransaction.ToWalletId = this.incomingTransaction.toWallet.id;
    this.incomingTransaction.fromWalletDestinationCurrency = await this.walletLib.findOrCreateTemporaryCurrencyWallet(
      this.incomingTransaction.destinationCurrency,
      this.incomingTransaction.fromWallet.OwnerAccountId
    );
  }

  getTransactionNetAmount(paymentProviderFeeTransactions, platformFeeTransaction, providerFeeTransaction) {
    let netTransactionAmount = this.incomingTransaction.destinationAmount;
    if (paymentProviderFeeTransactions) {
      netTransactionAmount -= paymentProviderFeeTransactions.getTotalFee();
    }
    if (platformFeeTransaction) {
      netTransactionAmount -= platformFeeTransaction.getTotalFee();
    }
    if (providerFeeTransaction) {
      netTransactionAmount -= providerFeeTransaction.getTotalFee();
    }
    return netTransactionAmount;
  }

  _validateForexTransaction() {
    if (!this.incomingTransaction.destinationAmount) {
      throw Error(operationNotAllowed('field destinationAmount missing'));
    }
    if (!this.incomingTransaction.destinationCurrency) {
      throw Error(operationNotAllowed('field destinationCurrency missing'));
    }
    if (!this.incomingTransaction.PaymentProviderWalletName) {
      throw Error(operationNotAllowed('PaymentProviderWalletName field missing'));
    }
    if (!this.incomingTransaction.PaymentProviderAccountId) {
      throw Error(operationNotAllowed('PaymentProviderAccountId field missing'));
    }
  }

}
