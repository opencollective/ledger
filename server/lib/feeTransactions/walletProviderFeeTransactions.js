import AbstractFeeTransactions from './abstractFeeTransactions';
import transactionCategoryEnum from '../../globals/enums/transactionCategoryEnum';

export default class WalletProviderFeeTransactions extends AbstractFeeTransactions {

  constructor(transaction) {
    super(transaction);
  }

  setTransactionInfo() {
    this.feeAccountId = this.transaction.WalletProviderAccountId;
    this.feeWalletId = this.transaction.WalletProviderWalletId;
    this.fee = this.transaction.platformFee;
    this.category = transactionCategoryEnum.WALLET_PROVIDER;
  }

}
