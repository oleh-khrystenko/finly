import { Provider } from '@nestjs/common';
import { PAYMENT_PROVIDER } from '../interfaces/payment-provider.interface';
import { WayForPayService } from './wayforpay/wayforpay.service';

export const paymentProviderProvider: Provider = {
    provide: PAYMENT_PROVIDER,
    useClass: WayForPayService,
};
