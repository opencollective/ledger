import AbstractPaymentMethod from '../abstractPaymentMethodType';

export default class PayPalPaymentMethod extends AbstractPaymentMethod {

  constructor(type) {
    super(type, __dirname);
  }

  processOrder(order) {
    super.processOrder(order);
  }

}
