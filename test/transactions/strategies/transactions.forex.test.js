/**
 * Test around the @{TransactionForexStrategy}
 *
 * @module test/transactions/strategies
 */
import { expect } from 'chai';
import AccountService from '../../../server/services/accountService';
import WalletService from '../../../server/services/walletService';
import TransactionService from '../../../server/services/transactionService';
import ResetDb from '../../resetDb';
import { paymentMethodServices } from '../../../server/globals/enums/paymentMethodServices';
import ProviderService from '../../../server/services/providerService';
import WalletLib from '../../../server/lib/walletLib';
import ProviderLib from '../../../server/lib/providerLib';
import PlatformInfo from '../../../server/globals/platformInfo';


describe('Forex Transactions', () => {
  const accountService = new AccountService();
  const walletService = new WalletService();
  const transactionService = new TransactionService();
  const providerService = new ProviderService();
  const walletLib = new WalletLib();
  const providerLib = new ProviderLib();
  let account1, account1WalletEUR, account2, account2WalletUSD, accountProvider, provider, paymentProviderAccount, paymentProviderWallet;

  beforeEach(async () => {
    await ResetDb.run();
    // EUR Provider: The account, the provider and the wallet
    accountProvider = await accountService.insert({ slug: 'provider' });
    provider = await providerService.insert({
      name: 'provider',
      fixedFee: 0,
      percentFee: 0.05,
      service: paymentMethodServices.opencollective.name,
      type: paymentMethodServices.opencollective.types.COLLECTIVE,
      OwnerAccountId: accountProvider.id,
    });
    await walletService.insert({
      OwnerAccountId: accountProvider.id,
      currency: 'MULTI',
      name: 'provider_USD',
      ProviderId: null,
    });
    // Creates Account1 Account and its EUR wallet
    account1 = await accountService.insert({ slug: 'account1' });
    account1WalletEUR = await walletService.insert({
      OwnerAccountId: account1.id,
      currency: 'EUR',
      name: 'account1-EUR',
      ProviderId: provider.id,
    });
    // Creates Account2 Account and its USD wallet
    account2 = await accountService.insert({ slug: 'account2' });
    account2WalletUSD = await walletService.insert({
      OwnerAccountId: account2.id,
      currency: 'USD',
      name: 'account2-USD',
      ProviderId: provider.id,
    });

    paymentProviderAccount = await accountService.insert({ slug: 'payment-provider' });
    paymentProviderWallet = await walletService.insert({
      OwnerAccountId: paymentProviderAccount.id,
      currency: 'MULTI',
      name: 'paymentProvider-MULTI',
      ProviderId: null,
    });
  });

  // assure test db will be reset in case of more tests
  after(async () => {
    await ResetDb.run();
  });

  describe('Sender Paying Fees', () => {

    it('cannot create forex transactions without a paymentProvider wallet)', async () => {
      try {
        await transactionService.insert({
          FromWalletId: account1WalletEUR.id, // The original WalletId where the money is going to be sent
          ToWalletId: account2WalletUSD.id, // The Destination WalletId
          amount: 3000, // The amount(same currency as defined in the "currency" field) to be sent
          currency: 'EUR', // The currency to be sent
          destinationAmount: 4500, // The amount to be received(same currency as defined in the "destinationCurrency" field)
          destinationCurrency: 'USD', // The currency to be received
          platformFee: 100, // if it's a forex Transaction the currency of all fees is by default the "destinationCurrency" field
          senderPayFees: true,
        });
      } catch (error) {
        expect(error).to.exist;
        expect(error.toString()).to.contain('field paymentProviderWalletId missing');
      }
    }); /** End of "Regular Account cashes in from its creditcard wallet to its USD wallet(Without Platform Payment Provider Fees) Should generate 4 transactions(2 Regarding Wallet Provider fees and 2 regarding the transaction itself )" */

    it('account1 sends 30EUR(that will become 45USD) to account2 with wallet provider fees', async () => {
      const result = await transactionService.insert({
        FromWalletId: account1WalletEUR.id, // The original WalletId where the money is going to be sent
        ToWalletId: account2WalletUSD.id, // The Destination WalletId
        amount: 3000, // The amount(same currency as defined in the "currency" field) to be sent
        currency: 'EUR', // The currency to be sent
        destinationAmount: 4500, // The amount to be received(same currency as defined in the "destinationCurrency" field)
        destinationCurrency: 'USD', // The currency to be received
        // platformFee: 100, // if it's a forex Transaction the currency of all fees is by default the "destinationCurrency" field
        // paymentProviderFee: 100, // if it's a forex Transaction the currency of all fees is by default the "destinationCurrency" field
        paymentProviderWalletId: paymentProviderWallet.id,
        senderPayFees: true,
      });
      // check if initial Cashin transaction generates 8 transactions
      // - 4 conversion transactons(2 * Credit and Debit transactions)
      //   - from EUR account1 to Payment provider
      //   - from USD Payment provider to account1
      // - 2 "account to account" transactons( USD account1 to USD account2, DEBIT and CREDIT)
      // - 2 Wallet Providers transactons( USD account1 to USD account2, DEBIT and CREDIT)
      expect(result).to.be.an('array');
      expect(result).to.have.lengthOf(8);
      // find temp USD Wallet that was supposedly generated for the account1
      const account1TempWalletUsd = await walletLib.findOrCreateTemporaryCurrencyWallet('USD', account1.id);
      // find already supposedly created wallet for the provider
      const providerCurrencyWallet = await providerLib.findOrCreateWalletByCurrency(provider, 'USD');
      // fee: total in Destination currency times the provider fee
      const transactionFeeAmount = Math.round(4500 * provider.percentFee);
      // net amount of transaction
      const transactionNetAmount = 4500 - transactionFeeAmount;

      // result[0] and result[1] -> From account1 to payment provider in EUR, Credit and Debit
      expect(result[1].type).to.be.equal('CREDIT');
      expect(result[1].FromAccountId).to.be.equal(account1.id);
      expect(result[1].ToAccountId).to.be.equal(paymentProviderWallet.OwnerAccountId);
      expect(result[1].FromWalletId).to.be.equal(account1WalletEUR.id);
      expect(result[1].ToWalletId).to.be.equal(paymentProviderWallet.id);
      expect(result[1].amount).to.be.equal(3000);
      expect(result[1].currency).to.be.equal('EUR');
      // result[0] must be the "opposite" of result[1]
      expect(result[0].type).to.be.equal('DEBIT');
      expect(result[0].FromAccountId).to.be.equal(result[1].ToAccountId);
      expect(result[0].ToAccountId).to.be.equal(result[1].FromAccountId);
      expect(result[0].FromWalletId).to.be.equal(result[1].ToWalletId);
      expect(result[0].ToWalletId).to.be.equal(result[1].FromWalletId);
      expect(result[0].amount).to.be.equal(-3000);
      expect(result[0].currency).to.be.equal('EUR');

      // result[2] and result[3] -> From payment provider to account1 in USD, Credit and Debit
      expect(result[3].type).to.be.equal('CREDIT');
      expect(result[3].FromAccountId).to.be.equal(paymentProviderWallet.OwnerAccountId);
      expect(result[3].ToAccountId).to.be.equal(account1.id);
      expect(result[3].FromWalletId).to.be.equal(paymentProviderWallet.id);
      expect(result[3].ToWalletId).to.be.equal(account1TempWalletUsd.id);
      expect(result[3].amount).to.be.equal(4500);
      expect(result[3].currency).to.be.equal('USD');
      // result[2] must be the "opposite" of result[3]
      expect(result[2].type).to.be.equal('DEBIT');
      expect(result[2].FromAccountId).to.be.equal(result[3].ToAccountId);
      expect(result[2].ToAccountId).to.be.equal(result[3].FromAccountId);
      expect(result[2].FromWalletId).to.be.equal(result[3].ToWalletId);
      expect(result[2].ToWalletId).to.be.equal(result[3].FromWalletId);
      expect(result[2].amount).to.be.equal(-4500);
      expect(result[2].currency).to.be.equal('USD');

      // result[4] and result[5] -> From account1 to account2 in USD, Credit and Debit
      expect(result[5].type).to.be.equal('CREDIT');
      expect(result[5].FromAccountId).to.be.equal(account1.id);
      expect(result[5].ToAccountId).to.be.equal(account2.id);
      expect(result[5].FromWalletId).to.be.equal(account1TempWalletUsd.id);
      // find temp USD Wallet that was supposedly generated for the account1
      expect(result[5].ToWalletId).to.be.equal(account2WalletUSD.id);
      expect(result[5].amount).to.be.equal(transactionNetAmount);
      expect(result[5].currency).to.be.equal('USD');
      // result[4] must be the "opposite" of result[5]
      expect(result[4].type).to.be.equal('DEBIT');
      expect(result[4].FromAccountId).to.be.equal(result[5].ToAccountId);
      expect(result[4].ToAccountId).to.be.equal(result[5].FromAccountId);
      expect(result[4].FromWalletId).to.be.equal(result[5].ToWalletId);
      expect(result[4].ToWalletId).to.be.equal(result[5].FromWalletId);
      expect(result[4].amount).to.be.equal(-1 * transactionNetAmount);
      expect(result[4].currency).to.be.equal('USD');

      // result[6] and result[7] -> Fee From account1 to wallet provider in USD, Credit and Debit
      expect(result[7].type).to.be.equal('CREDIT');
      expect(result[7].FromAccountId).to.be.equal(account1.id);
      expect(result[7].ToAccountId).to.be.equal(accountProvider.id);
      expect(result[7].FromWalletId).to.be.equal(account1TempWalletUsd.id);
      // find temp USD Wallet that was supposedly generated for the account1
      expect(result[7].ToWalletId).to.be.equal(providerCurrencyWallet.id);
      expect(result[7].amount).to.be.equal(transactionFeeAmount);
      expect(result[7].currency).to.be.equal('USD');
      // result[6] must be the "opposite" of result[7]
      expect(result[6].type).to.be.equal('DEBIT');
      expect(result[6].FromAccountId).to.be.equal(result[7].ToAccountId);
      expect(result[6].ToAccountId).to.be.equal(result[7].FromAccountId);
      expect(result[6].FromWalletId).to.be.equal(result[7].ToWalletId);
      expect(result[6].ToWalletId).to.be.equal(result[7].FromWalletId);
      expect(result[6].amount).to.be.equal(-1 * transactionFeeAmount);
      expect(result[6].currency).to.be.equal('USD');

    }); /** End of "account1 sends 30EUR(that will become 45USD) to account2 with wallet provider fees" */

    it('account1 sends 30EUR(that will become 45USD) to account2 with payment providers and wallet providers fees', async () => {
      const paymentProviderFee = 100;
      const result = await transactionService.insert({
        FromWalletId: account1WalletEUR.id, // The original WalletId where the money is going to be sent
        ToWalletId: account2WalletUSD.id, // The Destination WalletId
        amount: 3000, // The amount(same currency as defined in the "currency" field) to be sent
        currency: 'EUR', // The currency to be sent
        destinationAmount: 4500, // The amount to be received(same currency as defined in the "destinationCurrency" field)
        destinationCurrency: 'USD', // The currency to be received
        paymentProviderFee: paymentProviderFee, // if it's a forex Transaction the currency of all fees is by default the "destinationCurrency" field
        paymentProviderWalletId: paymentProviderWallet.id,
        senderPayFees: true,
      });
      // check if initial Cashin transaction generates 10 transactions
      // - 4 conversion transactons(2 * Credit and Debit transactions)
      //   - from EUR account1 to Payment provider
      //   - from USD Payment provider to account1
      // - 2 "account to account" transactons( USD account1 to USD account2, DEBIT and CREDIT)
      // - 2 Payment providers fee transactons( USD account1 to USD account2, DEBIT and CREDIT)
      // - 2 Wallet Providers transactons( USD account1 to USD account2, DEBIT and CREDIT)
      expect(result).to.be.an('array');
      expect(result).to.have.lengthOf(10);
      // find temp USD Wallet that was supposedly generated for the account1
      const account1TempWalletUsd = await walletLib.findOrCreateTemporaryCurrencyWallet('USD', account1.id);
      // find already supposedly created wallet for the provider
      const providerCurrencyWallet = await providerLib.findOrCreateWalletByCurrency(provider, 'USD');
      // fee: total in Destination currency times the provider fee
      const transactionFeeAmount = Math.round(4500 * provider.percentFee);
      // net amount of transaction
      const transactionNetAmount = 4500 - transactionFeeAmount - paymentProviderFee;

      // result[0] and result[1] -> From account1 to payment provider in EUR, Credit and Debit
      expect(result[1].type).to.be.equal('CREDIT');
      expect(result[1].FromAccountId).to.be.equal(account1.id);
      expect(result[1].ToAccountId).to.be.equal(paymentProviderWallet.OwnerAccountId);
      expect(result[1].FromWalletId).to.be.equal(account1WalletEUR.id);
      expect(result[1].ToWalletId).to.be.equal(paymentProviderWallet.id);
      expect(result[1].amount).to.be.equal(3000);
      expect(result[1].currency).to.be.equal('EUR');
      // result[0] must be the "opposite" of result[1]
      expect(result[0].type).to.be.equal('DEBIT');
      expect(result[0].FromAccountId).to.be.equal(result[1].ToAccountId);
      expect(result[0].ToAccountId).to.be.equal(result[1].FromAccountId);
      expect(result[0].FromWalletId).to.be.equal(result[1].ToWalletId);
      expect(result[0].ToWalletId).to.be.equal(result[1].FromWalletId);
      expect(result[0].amount).to.be.equal(-3000);
      expect(result[0].currency).to.be.equal('EUR');

      // result[2] and result[3] -> From payment provider to account1 in USD, Credit and Debit
      expect(result[3].type).to.be.equal('CREDIT');
      expect(result[3].FromAccountId).to.be.equal(paymentProviderWallet.OwnerAccountId);
      expect(result[3].ToAccountId).to.be.equal(account1.id);
      expect(result[3].FromWalletId).to.be.equal(paymentProviderWallet.id);
      expect(result[3].ToWalletId).to.be.equal(account1TempWalletUsd.id);
      expect(result[3].amount).to.be.equal(4500);
      expect(result[3].currency).to.be.equal('USD');
      // result[2] must be the "opposite" of result[3]
      expect(result[2].type).to.be.equal('DEBIT');
      expect(result[2].FromAccountId).to.be.equal(result[3].ToAccountId);
      expect(result[2].ToAccountId).to.be.equal(result[3].FromAccountId);
      expect(result[2].FromWalletId).to.be.equal(result[3].ToWalletId);
      expect(result[2].ToWalletId).to.be.equal(result[3].FromWalletId);
      expect(result[2].amount).to.be.equal(-4500);
      expect(result[2].currency).to.be.equal('USD');

      // result[4] and result[5] -> From account1 to account2 in USD, Credit and Debit
      expect(result[5].type).to.be.equal('CREDIT');
      expect(result[5].FromAccountId).to.be.equal(account1.id);
      expect(result[5].ToAccountId).to.be.equal(account2.id);
      expect(result[5].FromWalletId).to.be.equal(account1TempWalletUsd.id);
      // find temp USD Wallet that was supposedly generated for the account1
      expect(result[5].ToWalletId).to.be.equal(account2WalletUSD.id);
      expect(result[5].amount).to.be.equal(transactionNetAmount);
      expect(result[5].currency).to.be.equal('USD');
      // result[4] must be the "opposite" of result[5]
      expect(result[4].type).to.be.equal('DEBIT');
      expect(result[4].FromAccountId).to.be.equal(result[5].ToAccountId);
      expect(result[4].ToAccountId).to.be.equal(result[5].FromAccountId);
      expect(result[4].FromWalletId).to.be.equal(result[5].ToWalletId);
      expect(result[4].ToWalletId).to.be.equal(result[5].FromWalletId);
      expect(result[4].amount).to.be.equal(-1 * transactionNetAmount);
      expect(result[4].currency).to.be.equal('USD');

      // result[6] and result[7] -> Fee From account1 to payment provider in USD, Credit and Debit
      expect(result[7].type).to.be.equal('CREDIT');
      expect(result[7].FromAccountId).to.be.equal(account1.id);
      expect(result[7].ToAccountId).to.be.equal(paymentProviderWallet.OwnerAccountId);
      expect(result[7].FromWalletId).to.be.equal(account1TempWalletUsd.id);
      // find temp USD Wallet that was supposedly generated for the account1
      expect(result[7].ToWalletId).to.be.equal(paymentProviderWallet.id);
      expect(result[7].amount).to.be.equal(paymentProviderFee);
      expect(result[7].currency).to.be.equal('USD');
      // result[6] must be the "opposite" of result[7]
      expect(result[6].type).to.be.equal('DEBIT');
      expect(result[6].FromAccountId).to.be.equal(result[7].ToAccountId);
      expect(result[6].ToAccountId).to.be.equal(result[7].FromAccountId);
      expect(result[6].FromWalletId).to.be.equal(result[7].ToWalletId);
      expect(result[6].ToWalletId).to.be.equal(result[7].FromWalletId);
      expect(result[6].amount).to.be.equal(-1 * paymentProviderFee);
      expect(result[6].currency).to.be.equal('USD');

      // result[8] and result[9] -> Fee From account1 to wallet provider in USD, Credit and Debit
      expect(result[9].type).to.be.equal('CREDIT');
      expect(result[9].FromAccountId).to.be.equal(account1.id);
      expect(result[9].ToAccountId).to.be.equal(accountProvider.id);
      expect(result[9].FromWalletId).to.be.equal(account1TempWalletUsd.id);
      // find temp USD Wallet that was supposedly generated for the account1
      expect(result[9].ToWalletId).to.be.equal(providerCurrencyWallet.id);
      expect(result[9].amount).to.be.equal(transactionFeeAmount);
      expect(result[9].currency).to.be.equal('USD');
      // result[8] must be the "opposite" of result[9]
      expect(result[8].type).to.be.equal('DEBIT');
      expect(result[8].FromAccountId).to.be.equal(result[9].ToAccountId);
      expect(result[8].ToAccountId).to.be.equal(result[9].FromAccountId);
      expect(result[8].FromWalletId).to.be.equal(result[9].ToWalletId);
      expect(result[8].ToWalletId).to.be.equal(result[9].FromWalletId);
      expect(result[8].amount).to.be.equal(-1 * transactionFeeAmount);
      expect(result[8].currency).to.be.equal('USD');
    }); /** End of "account1 sends 30EUR(that will become 45USD) to account2 with payment providers and wallet providers fees" */

    it('account1 sends 30EUR(that will become 45USD) to account2 with platform and wallet providers fees', async () => {
      const platformFee = 100;
      const result = await transactionService.insert({
        FromWalletId: account1WalletEUR.id, // The original WalletId where the money is going to be sent
        ToWalletId: account2WalletUSD.id, // The Destination WalletId
        amount: 3000, // The amount(same currency as defined in the "currency" field) to be sent
        currency: 'EUR', // The currency to be sent
        destinationAmount: 4500, // The amount to be received(same currency as defined in the "destinationCurrency" field)
        destinationCurrency: 'USD', // The currency to be received
        platformFee: platformFee, // if it's a forex Transaction the currency of all fees is by default the "destinationCurrency" field
        paymentProviderWalletId: paymentProviderWallet.id,
        senderPayFees: true,
      });
      // check if initial Cashin transaction generates 10 transactions
      // - 4 conversion transactons(2 * Credit and Debit transactions)
      //   - from EUR account1 to Payment provider
      //   - from USD Payment provider to account1
      // - 2 "account to account" transactons( USD account1 to USD account2, DEBIT and CREDIT)
      // - 2 Platform fee transactons( USD account1 to USD account2, DEBIT and CREDIT)
      // - 2 Wallet Providers transactons( USD account1 to USD account2, DEBIT and CREDIT)
      expect(result).to.be.an('array');
      expect(result).to.have.lengthOf(10);
      // find temp USD Wallet that was supposedly generated for the account1
      const account1TempWalletUsd = await walletLib.findOrCreateTemporaryCurrencyWallet('USD', account1.id);
      // find already supposedly created wallet for the provider
      const providerCurrencyWallet = await providerLib.findOrCreateWalletByCurrency(provider, 'USD');
      // fee: total in Destination currency times the provider fee
      const transactionFeeAmount = Math.round(4500 * provider.percentFee);
      // net amount of transaction
      const transactionNetAmount = 4500 - transactionFeeAmount - platformFee;

      // result[0] and result[1] -> From account1 to payment provider in EUR, Credit and Debit
      expect(result[1].type).to.be.equal('CREDIT');
      expect(result[1].FromAccountId).to.be.equal(account1.id);
      expect(result[1].ToAccountId).to.be.equal(paymentProviderWallet.OwnerAccountId);
      expect(result[1].FromWalletId).to.be.equal(account1WalletEUR.id);
      expect(result[1].ToWalletId).to.be.equal(paymentProviderWallet.id);
      expect(result[1].amount).to.be.equal(3000);
      expect(result[1].currency).to.be.equal('EUR');
      // result[0] must be the "opposite" of result[1]
      expect(result[0].type).to.be.equal('DEBIT');
      expect(result[0].FromAccountId).to.be.equal(result[1].ToAccountId);
      expect(result[0].ToAccountId).to.be.equal(result[1].FromAccountId);
      expect(result[0].FromWalletId).to.be.equal(result[1].ToWalletId);
      expect(result[0].ToWalletId).to.be.equal(result[1].FromWalletId);
      expect(result[0].amount).to.be.equal(-3000);
      expect(result[0].currency).to.be.equal('EUR');

      // result[2] and result[3] -> From payment provider to account1 in USD, Credit and Debit
      expect(result[3].type).to.be.equal('CREDIT');
      expect(result[3].FromAccountId).to.be.equal(paymentProviderWallet.OwnerAccountId);
      expect(result[3].ToAccountId).to.be.equal(account1.id);
      expect(result[3].FromWalletId).to.be.equal(paymentProviderWallet.id);
      expect(result[3].ToWalletId).to.be.equal(account1TempWalletUsd.id);
      expect(result[3].amount).to.be.equal(4500);
      expect(result[3].currency).to.be.equal('USD');
      // result[2] must be the "opposite" of result[3]
      expect(result[2].type).to.be.equal('DEBIT');
      expect(result[2].FromAccountId).to.be.equal(result[3].ToAccountId);
      expect(result[2].ToAccountId).to.be.equal(result[3].FromAccountId);
      expect(result[2].FromWalletId).to.be.equal(result[3].ToWalletId);
      expect(result[2].ToWalletId).to.be.equal(result[3].FromWalletId);
      expect(result[2].amount).to.be.equal(-4500);
      expect(result[2].currency).to.be.equal('USD');

      // result[4] and result[5] -> From account1 to account2 in USD, Credit and Debit
      expect(result[5].type).to.be.equal('CREDIT');
      expect(result[5].FromAccountId).to.be.equal(account1.id);
      expect(result[5].ToAccountId).to.be.equal(account2.id);
      expect(result[5].FromWalletId).to.be.equal(account1TempWalletUsd.id);
      // find temp USD Wallet that was supposedly generated for the account1
      expect(result[5].ToWalletId).to.be.equal(account2WalletUSD.id);
      expect(result[5].amount).to.be.equal(transactionNetAmount);
      expect(result[5].currency).to.be.equal('USD');
      // result[4] must be the "opposite" of result[5]
      expect(result[4].type).to.be.equal('DEBIT');
      expect(result[4].FromAccountId).to.be.equal(result[5].ToAccountId);
      expect(result[4].ToAccountId).to.be.equal(result[5].FromAccountId);
      expect(result[4].FromWalletId).to.be.equal(result[5].ToWalletId);
      expect(result[4].ToWalletId).to.be.equal(result[5].FromWalletId);
      expect(result[4].amount).to.be.equal(-1 * transactionNetAmount);
      expect(result[4].currency).to.be.equal('USD');

      // result[6] and result[7] -> Fee From account1 to platform in USD, Credit and Debit
      const platformAccount = await PlatformInfo.getAccount();
      const platformWallet = await PlatformInfo.getWallet();
      expect(result[7].type).to.be.equal('CREDIT');
      expect(result[7].FromAccountId).to.be.equal(account1.id);
      expect(result[7].ToAccountId).to.be.equal(platformAccount.id);
      expect(result[7].FromWalletId).to.be.equal(account1TempWalletUsd.id);
      // find temp USD Wallet that was supposedly generated for the account1
      expect(result[7].ToWalletId).to.be.equal(platformWallet.id);
      expect(result[7].amount).to.be.equal(platformFee);
      expect(result[7].currency).to.be.equal('USD');
      // result[6] must be the "opposite" of result[7]
      expect(result[6].type).to.be.equal('DEBIT');
      expect(result[6].FromAccountId).to.be.equal(result[7].ToAccountId);
      expect(result[6].ToAccountId).to.be.equal(result[7].FromAccountId);
      expect(result[6].FromWalletId).to.be.equal(result[7].ToWalletId);
      expect(result[6].ToWalletId).to.be.equal(result[7].FromWalletId);
      expect(result[6].amount).to.be.equal(-1 * platformFee);
      expect(result[6].currency).to.be.equal('USD');

      // result[8] and result[9] -> Fee From account1 to wallet provider in USD, Credit and Debit
      expect(result[9].type).to.be.equal('CREDIT');
      expect(result[9].FromAccountId).to.be.equal(account1.id);
      expect(result[9].ToAccountId).to.be.equal(accountProvider.id);
      expect(result[9].FromWalletId).to.be.equal(account1TempWalletUsd.id);
      // find temp USD Wallet that was supposedly generated for the account1
      expect(result[9].ToWalletId).to.be.equal(providerCurrencyWallet.id);
      expect(result[9].amount).to.be.equal(transactionFeeAmount);
      expect(result[9].currency).to.be.equal('USD');
      // result[8] must be the "opposite" of result[9]
      expect(result[8].type).to.be.equal('DEBIT');
      expect(result[8].FromAccountId).to.be.equal(result[9].ToAccountId);
      expect(result[8].ToAccountId).to.be.equal(result[9].FromAccountId);
      expect(result[8].FromWalletId).to.be.equal(result[9].ToWalletId);
      expect(result[8].ToWalletId).to.be.equal(result[9].FromWalletId);
      expect(result[8].amount).to.be.equal(-1 * transactionFeeAmount);
      expect(result[8].currency).to.be.equal('USD');
    }); /** End of "account1 sends 30EUR(that will become 45USD) to account2 with platform and wallet providers fees" */

    it('account1 sends 30EUR(that will become 45USD) to account2 with all fees(payment providers, platform and wallet providers)', async () => {
      const platformFee = 100;
      const paymentProviderFee = 100;
      const result = await transactionService.insert({
        FromWalletId: account1WalletEUR.id, // The original WalletId where the money is going to be sent
        ToWalletId: account2WalletUSD.id, // The Destination WalletId
        amount: 3000, // The amount(same currency as defined in the "currency" field) to be sent
        currency: 'EUR', // The currency to be sent
        destinationAmount: 4500, // The amount to be received(same currency as defined in the "destinationCurrency" field)
        destinationCurrency: 'USD', // The currency to be received
        platformFee: platformFee, // if it's a forex Transaction the currency of all fees is by default the "destinationCurrency" field
        paymentProviderFee: paymentProviderFee, // if it's a forex Transaction the currency of all fees is by default the "destinationCurrency" field
        paymentProviderWalletId: paymentProviderWallet.id,
        senderPayFees: true,
      });
      // check if initial Cashin transaction generates 12 transactions
      // - 4 conversion transactons(2 * Credit and Debit transactions)
      //   - from EUR account1 to Payment provider
      //   - from USD Payment provider to account1
      // - 2 "account to account" transactons( USD account1 to USD account2, DEBIT and CREDIT)
      // - 2 Payment providers fee transactons( USD account1 to USD account2, DEBIT and CREDIT)
      // - 2 Platform fee transactons( USD account1 to USD account2, DEBIT and CREDIT)
      // - 2 Wallet Providers transactons( USD account1 to USD account2, DEBIT and CREDIT)
      expect(result).to.be.an('array');
      expect(result).to.have.lengthOf(12);
      // find temp USD Wallet that was supposedly generated for the account1
      const account1TempWalletUsd = await walletLib.findOrCreateTemporaryCurrencyWallet('USD', account1.id);
      // find already supposedly created wallet for the provider
      const providerCurrencyWallet = await providerLib.findOrCreateWalletByCurrency(provider, 'USD');
      // fee: total in Destination currency times the provider fee
      const transactionFeeAmount = Math.round(4500 * provider.percentFee);
      // net amount of transaction
      const transactionNetAmount = 4500 - transactionFeeAmount - platformFee - paymentProviderFee;

      // result[0] and result[1] -> From account1 to payment provider in EUR, Credit and Debit
      expect(result[1].type).to.be.equal('CREDIT');
      expect(result[1].FromAccountId).to.be.equal(account1.id);
      expect(result[1].ToAccountId).to.be.equal(paymentProviderWallet.OwnerAccountId);
      expect(result[1].FromWalletId).to.be.equal(account1WalletEUR.id);
      expect(result[1].ToWalletId).to.be.equal(paymentProviderWallet.id);
      expect(result[1].amount).to.be.equal(3000);
      expect(result[1].currency).to.be.equal('EUR');
      // result[0] must be the "opposite" of result[1]
      expect(result[0].type).to.be.equal('DEBIT');
      expect(result[0].FromAccountId).to.be.equal(result[1].ToAccountId);
      expect(result[0].ToAccountId).to.be.equal(result[1].FromAccountId);
      expect(result[0].FromWalletId).to.be.equal(result[1].ToWalletId);
      expect(result[0].ToWalletId).to.be.equal(result[1].FromWalletId);
      expect(result[0].amount).to.be.equal(-3000);
      expect(result[0].currency).to.be.equal('EUR');

      // result[2] and result[3] -> From payment provider to account1 in USD, Credit and Debit
      expect(result[3].type).to.be.equal('CREDIT');
      expect(result[3].FromAccountId).to.be.equal(paymentProviderWallet.OwnerAccountId);
      expect(result[3].ToAccountId).to.be.equal(account1.id);
      expect(result[3].FromWalletId).to.be.equal(paymentProviderWallet.id);
      expect(result[3].ToWalletId).to.be.equal(account1TempWalletUsd.id);
      expect(result[3].amount).to.be.equal(4500);
      expect(result[3].currency).to.be.equal('USD');
      // result[2] must be the "opposite" of result[3]
      expect(result[2].type).to.be.equal('DEBIT');
      expect(result[2].FromAccountId).to.be.equal(result[3].ToAccountId);
      expect(result[2].ToAccountId).to.be.equal(result[3].FromAccountId);
      expect(result[2].FromWalletId).to.be.equal(result[3].ToWalletId);
      expect(result[2].ToWalletId).to.be.equal(result[3].FromWalletId);
      expect(result[2].amount).to.be.equal(-4500);
      expect(result[2].currency).to.be.equal('USD');

      // result[4] and result[5] -> From account1 to account2 in USD, Credit and Debit
      expect(result[5].type).to.be.equal('CREDIT');
      expect(result[5].FromAccountId).to.be.equal(account1.id);
      expect(result[5].ToAccountId).to.be.equal(account2.id);
      expect(result[5].FromWalletId).to.be.equal(account1TempWalletUsd.id);
      // find temp USD Wallet that was supposedly generated for the account1
      expect(result[5].ToWalletId).to.be.equal(account2WalletUSD.id);
      expect(result[5].amount).to.be.equal(transactionNetAmount);
      expect(result[5].currency).to.be.equal('USD');
      // result[4] must be the "opposite" of result[5]
      expect(result[4].type).to.be.equal('DEBIT');
      expect(result[4].FromAccountId).to.be.equal(result[5].ToAccountId);
      expect(result[4].ToAccountId).to.be.equal(result[5].FromAccountId);
      expect(result[4].FromWalletId).to.be.equal(result[5].ToWalletId);
      expect(result[4].ToWalletId).to.be.equal(result[5].FromWalletId);
      expect(result[4].amount).to.be.equal(-1 * transactionNetAmount);
      expect(result[4].currency).to.be.equal('USD');

      // result[6] and result[7] -> Fee From account1 to payment provider in USD, Credit and Debit
      expect(result[7].type).to.be.equal('CREDIT');
      expect(result[7].FromAccountId).to.be.equal(account1.id);
      expect(result[7].ToAccountId).to.be.equal(paymentProviderWallet.OwnerAccountId);
      expect(result[7].FromWalletId).to.be.equal(account1TempWalletUsd.id);
      // find temp USD Wallet that was supposedly generated for the account1
      expect(result[7].ToWalletId).to.be.equal(paymentProviderWallet.id);
      expect(result[7].amount).to.be.equal(paymentProviderFee);
      expect(result[7].currency).to.be.equal('USD');
      // result[6] must be the "opposite" of result[7]
      expect(result[6].type).to.be.equal('DEBIT');
      expect(result[6].FromAccountId).to.be.equal(result[7].ToAccountId);
      expect(result[6].ToAccountId).to.be.equal(result[7].FromAccountId);
      expect(result[6].FromWalletId).to.be.equal(result[7].ToWalletId);
      expect(result[6].ToWalletId).to.be.equal(result[7].FromWalletId);
      expect(result[6].amount).to.be.equal(-1 * paymentProviderFee);
      expect(result[6].currency).to.be.equal('USD');

      // result[8] and result[9] -> Fee From account1 to platform in USD, Credit and Debit
      const platformAccount = await PlatformInfo.getAccount();
      const platformWallet = await PlatformInfo.getWallet();
      expect(result[9].type).to.be.equal('CREDIT');
      expect(result[9].FromAccountId).to.be.equal(account1.id);
      expect(result[9].ToAccountId).to.be.equal(platformAccount.id);
      expect(result[9].FromWalletId).to.be.equal(account1TempWalletUsd.id);
      // find temp USD Wallet that was supposedly generated for the account1
      expect(result[9].ToWalletId).to.be.equal(platformWallet.id);
      expect(result[9].amount).to.be.equal(platformFee);
      expect(result[9].currency).to.be.equal('USD');
      // result[8] must be the "opposite" of result[9]
      expect(result[8].type).to.be.equal('DEBIT');
      expect(result[8].FromAccountId).to.be.equal(result[9].ToAccountId);
      expect(result[8].ToAccountId).to.be.equal(result[9].FromAccountId);
      expect(result[8].FromWalletId).to.be.equal(result[9].ToWalletId);
      expect(result[8].ToWalletId).to.be.equal(result[9].FromWalletId);
      expect(result[8].amount).to.be.equal(-1 * platformFee);
      expect(result[8].currency).to.be.equal('USD');

      // result[10] and result[11] -> Fee From account1 to wallet provider in USD, Credit and Debit
      expect(result[11].type).to.be.equal('CREDIT');
      expect(result[11].FromAccountId).to.be.equal(account1.id);
      expect(result[11].ToAccountId).to.be.equal(accountProvider.id);
      expect(result[11].FromWalletId).to.be.equal(account1TempWalletUsd.id);
      // find temp USD Wallet that was supposedly generated for the account1
      expect(result[11].ToWalletId).to.be.equal(providerCurrencyWallet.id);
      expect(result[11].amount).to.be.equal(transactionFeeAmount);
      expect(result[11].currency).to.be.equal('USD');
      // result[10] must be the "opposite" of result[11]
      expect(result[10].type).to.be.equal('DEBIT');
      expect(result[10].FromAccountId).to.be.equal(result[11].ToAccountId);
      expect(result[10].ToAccountId).to.be.equal(result[11].FromAccountId);
      expect(result[10].FromWalletId).to.be.equal(result[11].ToWalletId);
      expect(result[10].ToWalletId).to.be.equal(result[11].FromWalletId);
      expect(result[10].amount).to.be.equal(-1 * transactionFeeAmount);
      expect(result[10].currency).to.be.equal('USD');
    }); /** End of "account1 sends 30EUR(that will become 45USD) to account2 with all fees(payment providers, platform and wallet providers)" */

  });

  describe('Receiver Paying Fees', () => {

    it('cannot create forex transactions without a paymentProvider wallet)', async () => {
      try {
        await transactionService.insert({
          FromWalletId: account1WalletEUR.id, // The original WalletId where the money is going to be sent
          ToWalletId: account2WalletUSD.id, // The Destination WalletId
          amount: 3000, // The amount(same currency as defined in the "currency" field) to be sent
          currency: 'EUR', // The currency to be sent
          destinationAmount: 4500, // The amount to be received(same currency as defined in the "destinationCurrency" field)
          destinationCurrency: 'USD', // The currency to be received
          platformFee: 100, // if it's a forex Transaction the currency of all fees is by default the "destinationCurrency" field
        });
      } catch (error) {
        expect(error).to.exist;
        expect(error.toString()).to.contain('field paymentProviderWalletId missing');
      }
    }); /** End of "Regular Account cashes in from its creditcard wallet to its USD wallet(Without Platform Payment Provider Fees) Should generate 4 transactions(2 Regarding Wallet Provider fees and 2 regarding the transaction itself )" */

    it('account1 sends 30EUR(that will become 45USD) to account2 with wallet provider fees', async () => {
      const amount = 3000;
      const destinationAmount = 4500;
      const result = await transactionService.insert({
        FromWalletId: account1WalletEUR.id, // The original WalletId where the money is going to be sent
        ToWalletId: account2WalletUSD.id, // The Destination WalletId
        amount: amount, // The amount(same currency as defined in the "currency" field) to be sent
        currency: 'EUR', // The currency to be sent
        destinationAmount: destinationAmount, // The amount to be received(same currency as defined in the "destinationCurrency" field)
        destinationCurrency: 'USD', // The currency to be received
        // platformFee: 100, // if it's a forex Transaction the currency of all fees is by default the "destinationCurrency" field
        // paymentProviderFee: 100, // if it's a forex Transaction the currency of all fees is by default the "destinationCurrency" field
        paymentProviderWalletId: paymentProviderWallet.id,
      });
      // check if initial Cashin transaction generates 8 transactions
      // - 4 conversion transactons(2 * Credit and Debit transactions)
      //   - 30EUR from account1 to Payment provider
      //   - 45USD from Payment provider to account1
      // - 2 "account to account" transactons( From account1 to account2 in USD, DEBIT and CREDIT)
      // - 2 Wallet Providers transactons( from account2 to wallet provider in USD, DEBIT and CREDIT)
      expect(result).to.be.an('array');
      expect(result).to.have.lengthOf(8);

      // find temp USD Wallet that was supposedly generated for the account1
      const account1TempWalletUsd = await walletLib.findOrCreateTemporaryCurrencyWallet('USD', account1.id);
      // find already supposedly created wallet for the provider
      const providerCurrencyWallet = await providerLib.findOrCreateWalletByCurrency(provider, 'USD');
      // fee: total in Destination currency times the provider fee
      const transactionFeeAmount = Math.round(destinationAmount * provider.percentFee);

      // result[0] and result[1] -> 30EUR From account1 to payment provider, Credit and Debit
      expect(result[1].type).to.be.equal('CREDIT');
      expect(result[1].FromAccountId).to.be.equal(account1.id);
      expect(result[1].ToAccountId).to.be.equal(paymentProviderWallet.OwnerAccountId);
      expect(result[1].FromWalletId).to.be.equal(account1WalletEUR.id);
      expect(result[1].ToWalletId).to.be.equal(paymentProviderWallet.id);
      expect(result[1].amount).to.be.equal(amount);
      expect(result[1].currency).to.be.equal('EUR');
      // result[0] must be the "opposite" of result[1]
      expect(result[0].type).to.be.equal('DEBIT');
      expect(result[0].FromAccountId).to.be.equal(result[1].ToAccountId);
      expect(result[0].ToAccountId).to.be.equal(result[1].FromAccountId);
      expect(result[0].FromWalletId).to.be.equal(result[1].ToWalletId);
      expect(result[0].ToWalletId).to.be.equal(result[1].FromWalletId);
      expect(result[0].amount).to.be.equal(-1 * amount);
      expect(result[0].currency).to.be.equal('EUR');

      // result[2] and result[3] -> 45USD From payment provider to account1, Credit and Debit
      expect(result[3].type).to.be.equal('CREDIT');
      expect(result[3].FromAccountId).to.be.equal(paymentProviderWallet.OwnerAccountId);
      expect(result[3].ToAccountId).to.be.equal(account1.id);
      expect(result[3].FromWalletId).to.be.equal(paymentProviderWallet.id);
      expect(result[3].ToWalletId).to.be.equal(account1TempWalletUsd.id);
      expect(result[3].amount).to.be.equal(destinationAmount);
      expect(result[3].currency).to.be.equal('USD');
      // result[2] must be the "opposite" of result[3]
      expect(result[2].type).to.be.equal('DEBIT');
      expect(result[2].FromAccountId).to.be.equal(result[3].ToAccountId);
      expect(result[2].ToAccountId).to.be.equal(result[3].FromAccountId);
      expect(result[2].FromWalletId).to.be.equal(result[3].ToWalletId);
      expect(result[2].ToWalletId).to.be.equal(result[3].FromWalletId);
      expect(result[2].amount).to.be.equal(-1 * destinationAmount);
      expect(result[2].currency).to.be.equal('USD');

      // result[4] and result[5] -> 45USD From account1 to account2 in USD, Credit and Debit
      expect(result[5].type).to.be.equal('CREDIT');
      expect(result[5].FromAccountId).to.be.equal(account1.id);
      expect(result[5].ToAccountId).to.be.equal(account2.id);
      expect(result[5].FromWalletId).to.be.equal(account1TempWalletUsd.id);
      expect(result[5].ToWalletId).to.be.equal(account2WalletUSD.id);
      expect(result[5].amount).to.be.equal(destinationAmount);
      expect(result[5].currency).to.be.equal('USD');
      // result[4] must be the "opposite" of result[5]
      expect(result[4].type).to.be.equal('DEBIT');
      expect(result[4].FromAccountId).to.be.equal(result[5].ToAccountId);
      expect(result[4].ToAccountId).to.be.equal(result[5].FromAccountId);
      expect(result[4].FromWalletId).to.be.equal(result[5].ToWalletId);
      expect(result[4].ToWalletId).to.be.equal(result[5].FromWalletId);
      expect(result[4].amount).to.be.equal(-1 * destinationAmount);
      expect(result[4].currency).to.be.equal('USD');

      // result[6] and result[7] -> Fee From account2 to wallet provider in USD, Credit and Debit
      expect(result[7].type).to.be.equal('CREDIT');
      expect(result[7].FromAccountId).to.be.equal(account2.id);
      expect(result[7].ToAccountId).to.be.equal(accountProvider.id);
      expect(result[7].FromWalletId).to.be.equal(account2WalletUSD.id);
      expect(result[7].ToWalletId).to.be.equal(providerCurrencyWallet.id);
      expect(result[7].amount).to.be.equal(transactionFeeAmount);
      expect(result[7].currency).to.be.equal('USD');
      // result[6] must be the "opposite" of result[7]
      expect(result[6].type).to.be.equal('DEBIT');
      expect(result[6].FromAccountId).to.be.equal(result[7].ToAccountId);
      expect(result[6].ToAccountId).to.be.equal(result[7].FromAccountId);
      expect(result[6].FromWalletId).to.be.equal(result[7].ToWalletId);
      expect(result[6].ToWalletId).to.be.equal(result[7].FromWalletId);
      expect(result[6].amount).to.be.equal(-1 * transactionFeeAmount);
      expect(result[6].currency).to.be.equal('USD');
      // the transactionGroupTotalAmount must be equals the amount in each item of the transaction batch
      expect(result.map(t => t.transactionGroupTotalAmount)).to.eql(result.map(() => amount));
      // the transactionGroupTotalAmountInDestinationCurrency must be equals the destinationAmount in each item of the transaction batch
      expect(result.map(t => t.transactionGroupTotalAmountInDestinationCurrency)).to.eql(result.map(() => destinationAmount));
    }); /** End of "account1 sends 30EUR(that will become 45USD) to account2 with wallet provider fees" */

    it('account1 sends 30EUR(that will become 45USD) to account2 with payment providers and wallet providers fees', async () => {
      const amount = 3000;
      const destinationAmount = 4500;
      const paymentProviderFee = 100;
      const result = await transactionService.insert({
        FromWalletId: account1WalletEUR.id, // The original WalletId where the money is going to be sent
        ToWalletId: account2WalletUSD.id, // The Destination WalletId
        amount: amount, // The amount(same currency as defined in the "currency" field) to be sent
        currency: 'EUR', // The currency to be sent
        destinationAmount: destinationAmount, // The amount to be received(same currency as defined in the "destinationCurrency" field)
        destinationCurrency: 'USD', // The currency to be received
        paymentProviderFee: paymentProviderFee, // if it's a forex Transaction the currency of all fees is by default the "destinationCurrency" field
        paymentProviderWalletId: paymentProviderWallet.id,
      });
      // check if initial Cashin transaction generates 10 transactions
      // - 4 conversion transactons(2 * Credit and Debit transactions)
      //   - 30EUR from account1 to Payment Provider
      //   - 45USD from Payment provider to account1
      // - 2 "account to account" transactons( From account1 to account2 in USD, DEBIT and CREDIT)
      // - 2 Payment providers fee transactons( From account2 to payment provider in USD, DEBIT and CREDIT)
      // - 2 Wallet Providers transactons( From account2 to wallet provider in USD, DEBIT and CREDIT)
      expect(result).to.be.an('array');
      expect(result).to.have.lengthOf(10);
      // find temp USD Wallet that was supposedly generated for the account1
      const account1TempWalletUsd = await walletLib.findOrCreateTemporaryCurrencyWallet('USD', account1.id);
      // find already supposedly created wallet for the provider
      const providerCurrencyWallet = await providerLib.findOrCreateWalletByCurrency(provider, 'USD');
      // fee: total in Destination currency times the provider fee
      const transactionFeeAmount = Math.round(destinationAmount * provider.percentFee);

      // result[0] and result[1] -> 30EUR From account1 to payment provider, Credit and Debit
      expect(result[1].type).to.be.equal('CREDIT');
      expect(result[1].FromAccountId).to.be.equal(account1.id);
      expect(result[1].ToAccountId).to.be.equal(paymentProviderWallet.OwnerAccountId);
      expect(result[1].FromWalletId).to.be.equal(account1WalletEUR.id);
      expect(result[1].ToWalletId).to.be.equal(paymentProviderWallet.id);
      expect(result[1].amount).to.be.equal(amount);
      expect(result[1].currency).to.be.equal('EUR');
      // result[0] must be the "opposite" of result[1]
      expect(result[0].type).to.be.equal('DEBIT');
      expect(result[0].FromAccountId).to.be.equal(result[1].ToAccountId);
      expect(result[0].ToAccountId).to.be.equal(result[1].FromAccountId);
      expect(result[0].FromWalletId).to.be.equal(result[1].ToWalletId);
      expect(result[0].ToWalletId).to.be.equal(result[1].FromWalletId);
      expect(result[0].amount).to.be.equal(-1 * amount);
      expect(result[0].currency).to.be.equal('EUR');

      // result[2] and result[3] -> 45USD From payment provider to account1, Credit and Debit
      expect(result[3].type).to.be.equal('CREDIT');
      expect(result[3].FromAccountId).to.be.equal(paymentProviderWallet.OwnerAccountId);
      expect(result[3].ToAccountId).to.be.equal(account1.id);
      expect(result[3].FromWalletId).to.be.equal(paymentProviderWallet.id);
      expect(result[3].ToWalletId).to.be.equal(account1TempWalletUsd.id);
      expect(result[3].amount).to.be.equal(destinationAmount);
      expect(result[3].currency).to.be.equal('USD');
      // result[2] must be the "opposite" of result[3]
      expect(result[2].type).to.be.equal('DEBIT');
      expect(result[2].FromAccountId).to.be.equal(result[3].ToAccountId);
      expect(result[2].ToAccountId).to.be.equal(result[3].FromAccountId);
      expect(result[2].FromWalletId).to.be.equal(result[3].ToWalletId);
      expect(result[2].ToWalletId).to.be.equal(result[3].FromWalletId);
      expect(result[2].amount).to.be.equal(-1 * destinationAmount);
      expect(result[2].currency).to.be.equal('USD');

      // result[4] and result[5] -> 45USD From account1 to account2, Credit and Debit
      expect(result[5].type).to.be.equal('CREDIT');
      expect(result[5].FromAccountId).to.be.equal(account1.id);
      expect(result[5].ToAccountId).to.be.equal(account2.id);
      expect(result[5].FromWalletId).to.be.equal(account1TempWalletUsd.id);
      expect(result[5].ToWalletId).to.be.equal(account2WalletUSD.id);
      expect(result[5].amount).to.be.equal(destinationAmount);
      expect(result[5].currency).to.be.equal('USD');
      // result[4] must be the "opposite" of result[5]
      expect(result[4].type).to.be.equal('DEBIT');
      expect(result[4].FromAccountId).to.be.equal(result[5].ToAccountId);
      expect(result[4].ToAccountId).to.be.equal(result[5].FromAccountId);
      expect(result[4].FromWalletId).to.be.equal(result[5].ToWalletId);
      expect(result[4].ToWalletId).to.be.equal(result[5].FromWalletId);
      expect(result[4].amount).to.be.equal(-1 * destinationAmount);
      expect(result[4].currency).to.be.equal('USD');

      // result[6] and result[7] -> Fee From account2 to payment provider in USD, Credit and Debit
      expect(result[7].type).to.be.equal('CREDIT');
      expect(result[7].FromAccountId).to.be.equal(account2.id);
      expect(result[7].ToAccountId).to.be.equal(paymentProviderWallet.OwnerAccountId);
      expect(result[7].FromWalletId).to.be.equal(account2WalletUSD.id);
      expect(result[7].ToWalletId).to.be.equal(paymentProviderWallet.id);
      expect(result[7].amount).to.be.equal(paymentProviderFee);
      expect(result[7].currency).to.be.equal('USD');
      // result[6] must be the "opposite" of result[7]
      expect(result[6].type).to.be.equal('DEBIT');
      expect(result[6].FromAccountId).to.be.equal(result[7].ToAccountId);
      expect(result[6].ToAccountId).to.be.equal(result[7].FromAccountId);
      expect(result[6].FromWalletId).to.be.equal(result[7].ToWalletId);
      expect(result[6].ToWalletId).to.be.equal(result[7].FromWalletId);
      expect(result[6].amount).to.be.equal(-1 * paymentProviderFee);
      expect(result[6].currency).to.be.equal('USD');

      // result[8] and result[9] -> Fee From account2 to wallet provider in USD, Credit and Debit
      expect(result[9].type).to.be.equal('CREDIT');
      expect(result[9].FromAccountId).to.be.equal(account2.id);
      expect(result[9].ToAccountId).to.be.equal(accountProvider.id);
      expect(result[9].FromWalletId).to.be.equal(account2WalletUSD.id);
      expect(result[9].ToWalletId).to.be.equal(providerCurrencyWallet.id);
      expect(result[9].amount).to.be.equal(transactionFeeAmount);
      expect(result[9].currency).to.be.equal('USD');
      // result[8] must be the "opposite" of result[9]
      expect(result[8].type).to.be.equal('DEBIT');
      expect(result[8].FromAccountId).to.be.equal(result[9].ToAccountId);
      expect(result[8].ToAccountId).to.be.equal(result[9].FromAccountId);
      expect(result[8].FromWalletId).to.be.equal(result[9].ToWalletId);
      expect(result[8].ToWalletId).to.be.equal(result[9].FromWalletId);
      expect(result[8].amount).to.be.equal(-1 * transactionFeeAmount);
      expect(result[8].currency).to.be.equal('USD');

      // the transactionGroupTotalAmount must be equals the amount in each item of the transaction batch
      expect(result.map(t => t.transactionGroupTotalAmount)).to.eql(result.map(() => amount));
      // the transactionGroupTotalAmountInDestinationCurrency must be equals the destinationAmount in each item of the transaction batch
      expect(result.map(t => t.transactionGroupTotalAmountInDestinationCurrency)).to.eql(result.map(() => destinationAmount));
    }); /** End of "account1 sends 30EUR(that will become 45USD) to account2 with payment providers and wallet providers fees" */

    it('account1 sends 30EUR(that will become 45USD) to account2 with platform and wallet providers fees', async () => {
      const amount = 3000;
      const destinationAmount = 4500;
      const platformFee = 100;
      const result = await transactionService.insert({
        FromWalletId: account1WalletEUR.id, // The original WalletId where the money is going to be sent
        ToWalletId: account2WalletUSD.id, // The Destination WalletId
        amount: amount, // The amount(same currency as defined in the "currency" field) to be sent
        currency: 'EUR', // The currency to be sent
        destinationAmount: destinationAmount, // The amount to be received(same currency as defined in the "destinationCurrency" field)
        destinationCurrency: 'USD', // The currency to be received
        platformFee: platformFee, // if it's a forex Transaction the currency of all fees is by default the "destinationCurrency" field
        paymentProviderWalletId: paymentProviderWallet.id,
      });
      // check if initial Cashin transaction generates 10 transactions
      // - 4 conversion transactons(2 * Credit and Debit transactions)
      //   - 30EUR from account1 to Payment provider
      //   - 45USD from Payment provider to account1
      // - 2 "account to account" transactons( 45USD From account1 to account2, DEBIT and CREDIT)
      // - 2 Platform fee transactons( 1USD from account2 to platform, DEBIT and CREDIT)
      // - 2 Wallet Providers transactons( from account2 to wallet provider in USD, DEBIT and CREDIT)
      expect(result).to.be.an('array');
      expect(result).to.have.lengthOf(10);
      // find temp USD Wallet that was supposedly generated for the account1
      const account1TempWalletUsd = await walletLib.findOrCreateTemporaryCurrencyWallet('USD', account1.id);
      // find already supposedly created wallet for the provider
      const providerCurrencyWallet = await providerLib.findOrCreateWalletByCurrency(provider, 'USD');
      // fee: total in Destination currency times the provider fee
      const transactionFeeAmount = Math.round(4500 * provider.percentFee);

      // result[0] and result[1] -> 30EUR From account1 to payment provider, Credit and Debit
      expect(result[1].type).to.be.equal('CREDIT');
      expect(result[1].FromAccountId).to.be.equal(account1.id);
      expect(result[1].ToAccountId).to.be.equal(paymentProviderWallet.OwnerAccountId);
      expect(result[1].FromWalletId).to.be.equal(account1WalletEUR.id);
      expect(result[1].ToWalletId).to.be.equal(paymentProviderWallet.id);
      expect(result[1].amount).to.be.equal(amount);
      expect(result[1].currency).to.be.equal('EUR');
      // result[0] must be the "opposite" of result[1]
      expect(result[0].type).to.be.equal('DEBIT');
      expect(result[0].FromAccountId).to.be.equal(result[1].ToAccountId);
      expect(result[0].ToAccountId).to.be.equal(result[1].FromAccountId);
      expect(result[0].FromWalletId).to.be.equal(result[1].ToWalletId);
      expect(result[0].ToWalletId).to.be.equal(result[1].FromWalletId);
      expect(result[0].amount).to.be.equal(-1 * amount);
      expect(result[0].currency).to.be.equal('EUR');

      // result[2] and result[3] -> 45USD From payment provider to account1, Credit and Debit
      expect(result[3].type).to.be.equal('CREDIT');
      expect(result[3].FromAccountId).to.be.equal(paymentProviderWallet.OwnerAccountId);
      expect(result[3].ToAccountId).to.be.equal(account1.id);
      expect(result[3].FromWalletId).to.be.equal(paymentProviderWallet.id);
      expect(result[3].ToWalletId).to.be.equal(account1TempWalletUsd.id);
      expect(result[3].amount).to.be.equal(destinationAmount);
      expect(result[3].currency).to.be.equal('USD');
      // result[2] must be the "opposite" of result[3]
      expect(result[2].type).to.be.equal('DEBIT');
      expect(result[2].FromAccountId).to.be.equal(result[3].ToAccountId);
      expect(result[2].ToAccountId).to.be.equal(result[3].FromAccountId);
      expect(result[2].FromWalletId).to.be.equal(result[3].ToWalletId);
      expect(result[2].ToWalletId).to.be.equal(result[3].FromWalletId);
      expect(result[2].amount).to.be.equal(-1 * destinationAmount);
      expect(result[2].currency).to.be.equal('USD');

      // result[4] and result[5] -> 45USD From account1 to account2, Credit and Debit
      expect(result[5].type).to.be.equal('CREDIT');
      expect(result[5].FromAccountId).to.be.equal(account1.id);
      expect(result[5].ToAccountId).to.be.equal(account2.id);
      expect(result[5].FromWalletId).to.be.equal(account1TempWalletUsd.id);
      // find temp USD Wallet that was supposedly generated for the account1
      expect(result[5].ToWalletId).to.be.equal(account2WalletUSD.id);
      expect(result[5].amount).to.be.equal(destinationAmount);
      expect(result[5].currency).to.be.equal('USD');
      // result[4] must be the "opposite" of result[5]
      expect(result[4].type).to.be.equal('DEBIT');
      expect(result[4].FromAccountId).to.be.equal(result[5].ToAccountId);
      expect(result[4].ToAccountId).to.be.equal(result[5].FromAccountId);
      expect(result[4].FromWalletId).to.be.equal(result[5].ToWalletId);
      expect(result[4].ToWalletId).to.be.equal(result[5].FromWalletId);
      expect(result[4].amount).to.be.equal(-1 * destinationAmount);
      expect(result[4].currency).to.be.equal('USD');

      // result[6] and result[7] -> 1USD Fee From account2 to platform, Credit and Debit
      const platformAccount = await PlatformInfo.getAccount();
      const platformWallet = await PlatformInfo.getWallet();
      expect(result[7].type).to.be.equal('CREDIT');
      expect(result[7].FromAccountId).to.be.equal(account2.id);
      expect(result[7].ToAccountId).to.be.equal(platformAccount.id);
      expect(result[7].FromWalletId).to.be.equal(account2WalletUSD.id);
      // find temp USD Wallet that was supposedly generated for the account1
      expect(result[7].ToWalletId).to.be.equal(platformWallet.id);
      expect(result[7].amount).to.be.equal(platformFee);
      expect(result[7].currency).to.be.equal('USD');
      // result[6] must be the "opposite" of result[7]
      expect(result[6].type).to.be.equal('DEBIT');
      expect(result[6].FromAccountId).to.be.equal(result[7].ToAccountId);
      expect(result[6].ToAccountId).to.be.equal(result[7].FromAccountId);
      expect(result[6].FromWalletId).to.be.equal(result[7].ToWalletId);
      expect(result[6].ToWalletId).to.be.equal(result[7].FromWalletId);
      expect(result[6].amount).to.be.equal(-1 * platformFee);
      expect(result[6].currency).to.be.equal('USD');

      // result[8] and result[9] -> USD Fee From account2 to wallet provider, Credit and Debit
      expect(result[9].type).to.be.equal('CREDIT');
      expect(result[9].FromAccountId).to.be.equal(account2.id);
      expect(result[9].ToAccountId).to.be.equal(accountProvider.id);
      expect(result[9].FromWalletId).to.be.equal(account2WalletUSD.id);
      // find temp USD Wallet that was supposedly generated for the account1
      expect(result[9].ToWalletId).to.be.equal(providerCurrencyWallet.id);
      expect(result[9].amount).to.be.equal(transactionFeeAmount);
      expect(result[9].currency).to.be.equal('USD');
      // result[8] must be the "opposite" of result[9]
      expect(result[8].type).to.be.equal('DEBIT');
      expect(result[8].FromAccountId).to.be.equal(result[9].ToAccountId);
      expect(result[8].ToAccountId).to.be.equal(result[9].FromAccountId);
      expect(result[8].FromWalletId).to.be.equal(result[9].ToWalletId);
      expect(result[8].ToWalletId).to.be.equal(result[9].FromWalletId);
      expect(result[8].amount).to.be.equal(-1 * transactionFeeAmount);
      expect(result[8].currency).to.be.equal('USD');
    }); /** End of "account1 sends 30EUR(that will become 45USD) to account2 with platform and wallet providers fees" */

    it('account1 sends 30EUR(that will become 45USD) to account2 with all fees(payment providers, platform and wallet providers)', async () => {
      const amount = 3000;
      const destinationAmount = 4500;
      const platformFee = 100;
      const paymentProviderFee = 100;
      const result = await transactionService.insert({
        FromWalletId: account1WalletEUR.id, // The original WalletId where the money is going to be sent
        ToWalletId: account2WalletUSD.id, // The Destination WalletId
        amount: amount, // The amount(same currency as defined in the "currency" field) to be sent
        currency: 'EUR', // The currency to be sent
        destinationAmount: destinationAmount, // The amount to be received(same currency as defined in the "destinationCurrency" field)
        destinationCurrency: 'USD', // The currency to be received
        platformFee: platformFee, // if it's a forex Transaction the currency of all fees is by default the "destinationCurrency" field
        paymentProviderFee: paymentProviderFee, // if it's a forex Transaction the currency of all fees is by default the "destinationCurrency" field
        paymentProviderWalletId: paymentProviderWallet.id,
      });
      // check if initial Cashin transaction generates 12 transactions
      // - 4 conversion transactons(2 * Credit and Debit transactions)
      //   - 30EUR from account1 to Payment provider
      //   - 45USD from Payment provider to account1
      // - 2 "account to account" transactons( 45USD from account1 to account2, DEBIT and CREDIT)
      // - 2 Payment providers fee transactons( 1USD from account2 to payment provider, DEBIT and CREDIT)
      // - 2 Platform fee transactons( 1USD from account2 to platform, DEBIT and CREDIT)
      // - 2 Wallet Providers transactons( USD from account2 to wallet provider, DEBIT and CREDIT)
      expect(result).to.be.an('array');
      expect(result).to.have.lengthOf(12);
      // find temp USD Wallet that was supposedly generated for the account1
      const account1TempWalletUsd = await walletLib.findOrCreateTemporaryCurrencyWallet('USD', account1.id);
      // find already supposedly created wallet for the provider
      const providerCurrencyWallet = await providerLib.findOrCreateWalletByCurrency(provider, 'USD');
      // fee: total in Destination currency times the provider fee
      const transactionFeeAmount = Math.round(4500 * provider.percentFee);

      // result[0] and result[1] -> 30EUR From account1 to payment provider, Credit and Debit
      expect(result[1].type).to.be.equal('CREDIT');
      expect(result[1].FromAccountId).to.be.equal(account1.id);
      expect(result[1].ToAccountId).to.be.equal(paymentProviderWallet.OwnerAccountId);
      expect(result[1].FromWalletId).to.be.equal(account1WalletEUR.id);
      expect(result[1].ToWalletId).to.be.equal(paymentProviderWallet.id);
      expect(result[1].amount).to.be.equal(amount);
      expect(result[1].currency).to.be.equal('EUR');
      // result[0] must be the "opposite" of result[1]
      expect(result[0].type).to.be.equal('DEBIT');
      expect(result[0].FromAccountId).to.be.equal(result[1].ToAccountId);
      expect(result[0].ToAccountId).to.be.equal(result[1].FromAccountId);
      expect(result[0].FromWalletId).to.be.equal(result[1].ToWalletId);
      expect(result[0].ToWalletId).to.be.equal(result[1].FromWalletId);
      expect(result[0].amount).to.be.equal(-1 * amount);
      expect(result[0].currency).to.be.equal('EUR');

      // result[2] and result[3] -> 45USD From payment provider to account1, Credit and Debit
      expect(result[3].type).to.be.equal('CREDIT');
      expect(result[3].FromAccountId).to.be.equal(paymentProviderWallet.OwnerAccountId);
      expect(result[3].ToAccountId).to.be.equal(account1.id);
      expect(result[3].FromWalletId).to.be.equal(paymentProviderWallet.id);
      expect(result[3].ToWalletId).to.be.equal(account1TempWalletUsd.id);
      expect(result[3].amount).to.be.equal(destinationAmount);
      expect(result[3].currency).to.be.equal('USD');
      // result[2] must be the "opposite" of result[3]
      expect(result[2].type).to.be.equal('DEBIT');
      expect(result[2].FromAccountId).to.be.equal(result[3].ToAccountId);
      expect(result[2].ToAccountId).to.be.equal(result[3].FromAccountId);
      expect(result[2].FromWalletId).to.be.equal(result[3].ToWalletId);
      expect(result[2].ToWalletId).to.be.equal(result[3].FromWalletId);
      expect(result[2].amount).to.be.equal(-1 * destinationAmount);
      expect(result[2].currency).to.be.equal('USD');

      // result[4] and result[5] -> 45USD From account1 to account2 in USD, Credit and Debit
      expect(result[5].type).to.be.equal('CREDIT');
      expect(result[5].FromAccountId).to.be.equal(account1.id);
      expect(result[5].ToAccountId).to.be.equal(account2.id);
      expect(result[5].FromWalletId).to.be.equal(account1TempWalletUsd.id);
      // find temp USD Wallet that was supposedly generated for the account1
      expect(result[5].ToWalletId).to.be.equal(account2WalletUSD.id);
      expect(result[5].amount).to.be.equal(destinationAmount);
      expect(result[5].currency).to.be.equal('USD');
      // result[4] must be the "opposite" of result[5]
      expect(result[4].type).to.be.equal('DEBIT');
      expect(result[4].FromAccountId).to.be.equal(result[5].ToAccountId);
      expect(result[4].ToAccountId).to.be.equal(result[5].FromAccountId);
      expect(result[4].FromWalletId).to.be.equal(result[5].ToWalletId);
      expect(result[4].ToWalletId).to.be.equal(result[5].FromWalletId);
      expect(result[4].amount).to.be.equal(-1 * destinationAmount);
      expect(result[4].currency).to.be.equal('USD');

      // result[6] and result[7] -> 1USD from account2 to payment provider in USD, Credit and Debit
      expect(result[7].type).to.be.equal('CREDIT');
      expect(result[7].FromAccountId).to.be.equal(account2.id);
      expect(result[7].ToAccountId).to.be.equal(paymentProviderWallet.OwnerAccountId);
      expect(result[7].FromWalletId).to.be.equal(account2WalletUSD.id);
      expect(result[7].ToWalletId).to.be.equal(paymentProviderWallet.id);
      expect(result[7].amount).to.be.equal(paymentProviderFee);
      expect(result[7].currency).to.be.equal('USD');
      // result[6] must be the "opposite" of result[7]
      expect(result[6].type).to.be.equal('DEBIT');
      expect(result[6].FromAccountId).to.be.equal(result[7].ToAccountId);
      expect(result[6].ToAccountId).to.be.equal(result[7].FromAccountId);
      expect(result[6].FromWalletId).to.be.equal(result[7].ToWalletId);
      expect(result[6].ToWalletId).to.be.equal(result[7].FromWalletId);
      expect(result[6].amount).to.be.equal(-1 * paymentProviderFee);
      expect(result[6].currency).to.be.equal('USD');

      // result[8] and result[9] -> 1USD from account2 to platform, Credit and Debit
      const platformAccount = await PlatformInfo.getAccount();
      const platformWallet = await PlatformInfo.getWallet();
      expect(result[9].type).to.be.equal('CREDIT');
      expect(result[9].FromAccountId).to.be.equal(account2.id);
      expect(result[9].ToAccountId).to.be.equal(platformAccount.id);
      expect(result[9].FromWalletId).to.be.equal(account2WalletUSD.id);
      expect(result[9].ToWalletId).to.be.equal(platformWallet.id);
      expect(result[9].amount).to.be.equal(platformFee);
      expect(result[9].currency).to.be.equal('USD');
      // result[8] must be the "opposite" of result[9]
      expect(result[8].type).to.be.equal('DEBIT');
      expect(result[8].FromAccountId).to.be.equal(result[9].ToAccountId);
      expect(result[8].ToAccountId).to.be.equal(result[9].FromAccountId);
      expect(result[8].FromWalletId).to.be.equal(result[9].ToWalletId);
      expect(result[8].ToWalletId).to.be.equal(result[9].FromWalletId);
      expect(result[8].amount).to.be.equal(-1 * platformFee);
      expect(result[8].currency).to.be.equal('USD');

      // result[10] and result[11] -> USD Fee From account2 to wallet provider, Credit and Debit
      expect(result[11].type).to.be.equal('CREDIT');
      expect(result[11].FromAccountId).to.be.equal(account2.id);
      expect(result[11].ToAccountId).to.be.equal(accountProvider.id);
      expect(result[11].FromWalletId).to.be.equal(account2WalletUSD.id);
      expect(result[11].ToWalletId).to.be.equal(providerCurrencyWallet.id);
      expect(result[11].amount).to.be.equal(transactionFeeAmount);
      expect(result[11].currency).to.be.equal('USD');
      // result[10] must be the "opposite" of result[11]
      expect(result[10].type).to.be.equal('DEBIT');
      expect(result[10].FromAccountId).to.be.equal(result[11].ToAccountId);
      expect(result[10].ToAccountId).to.be.equal(result[11].FromAccountId);
      expect(result[10].FromWalletId).to.be.equal(result[11].ToWalletId);
      expect(result[10].ToWalletId).to.be.equal(result[11].FromWalletId);
      expect(result[10].amount).to.be.equal(-1 * transactionFeeAmount);
      expect(result[10].currency).to.be.equal('USD');
    }); /** End of "account1 sends 30EUR(that will become 45USD) to account2 with all fees(payment providers, platform and wallet providers)" */
  });
}); /** End of "Forex Transactions" */
