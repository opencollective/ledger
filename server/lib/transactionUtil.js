import uuidv4 from 'uuid/v4';
import { transactionTypeEnum } from '../globals/enums/transactionTypeEnum';

export default class TransactionUtil {

  /** Given a Transaction Returns Its Double Entry Equivalent Array(1 debit and 1 credit Transactions)
  * @param {Object} transaction
  * @return {Array} of transactions
  */
  getDoubleEntryArray (transaction){
    const doubleEntryGroupId = uuidv4();
    const fromAccountId = (transaction.amount < 0) ? transaction.FromAccountId : transaction.ToAccountId,
          toAccountId = (transaction.amount < 0) ? transaction.ToAccountId: transaction.FromAccountId,
          fromWalletId = transaction.ToWalletId,
          toWalletId = transaction.FromWalletId,
          amount = (transaction.amount < 0) ? (-1 * transaction.amount) : transaction.amount;

    const debitTransaction = {
      type: transactionTypeEnum.DEBIT,
      FromAccountId: fromAccountId,
      ToAccountId: toAccountId,
      FromWalletId: fromWalletId,
      ToWalletId: toWalletId,
      amount: (-1 * amount),
      currency: transaction.currency,
      transactionGroupId: transaction.TransactionGroup,
      transactionGroupSequence: transaction.transactionGroupSequence,
      doubleEntryGroupId: doubleEntryGroupId,
    };
    const creditTransaction = {
      type: transactionTypeEnum.CREDIT,
      FromAccountId: toAccountId,
      ToAccountId: fromAccountId,
      FromWalletId: toWalletId,
      ToWalletId: fromWalletId,
      amount: amount,
      currency: transaction.currency,
      transactionGroupId: transaction.TransactionGroup,
      transactionGroupSequence: transaction.transactionGroupSequence + 1,
      doubleEntryGroupId: doubleEntryGroupId,
    };
    return [debitTransaction, creditTransaction];
  }

}