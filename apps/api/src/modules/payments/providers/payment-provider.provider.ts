import { Provider } from '@nestjs/common';
import { PAYMENT_PROVIDER } from '../interfaces/payment-provider.interface';
import { StripeService } from './stripe.service';

export const paymentProviderProvider: Provider = {
    provide: PAYMENT_PROVIDER,
    useClass: StripeService,
};
