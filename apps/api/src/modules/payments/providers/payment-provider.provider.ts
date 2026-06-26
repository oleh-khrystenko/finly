import { Provider } from '@nestjs/common';
import { PAYMENT_PROVIDER } from '../interfaces/payment-provider.interface';
import { MonobankService } from './monobank/monobank.service';

export const paymentProviderProvider: Provider = {
    provide: PAYMENT_PROVIDER,
    useClass: MonobankService,
};
