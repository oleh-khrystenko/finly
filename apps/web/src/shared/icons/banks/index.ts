import type { ComponentType } from 'react';
import type { BankCode } from '@finly/types';

import type { IconProps } from '../types';

import AbankIcon from './AbankIcon';
import CreditDniproIcon from './CreditDniproIcon';
import IzibankIcon from './IzibankIcon';
import MonobankIcon from './MonobankIcon';
import OschadbankIcon from './OschadbankIcon';
import PrivatbankIcon from './PrivatbankIcon';
import PumbIcon from './PumbIcon';
import RaiffeisenIcon from './RaiffeisenIcon';
import SenseIcon from './SenseIcon';
import UkrgazbankIcon from './UkrgazbankIcon';

export {
    AbankIcon,
    CreditDniproIcon,
    IzibankIcon,
    MonobankIcon,
    OschadbankIcon,
    PrivatbankIcon,
    PumbIcon,
    RaiffeisenIcon,
    SenseIcon,
    UkrgazbankIcon,
};

/**
 * UI-only mapping `BankCode → іконка банку`. Single source of truth для
 * public-сторінки бізнесу і потенційно cabinet/wizard UI у Sprint 5+
 * (per-bank deep-links). `Record<BankCode, ...>` — TS exhaustivness гарантує,
 * що при додаванні нового банку у `MVP_BANKS` компіляція впаде, поки сюди
 * не додадуть запис.
 */
export const BANK_DISPLAY: Record<BankCode, ComponentType<IconProps>> = {
    privatbank: PrivatbankIcon,
    monobank: MonobankIcon,
    pumb: PumbIcon,
    oschadbank: OschadbankIcon,
    sense: SenseIcon,
    ukrgazbank: UkrgazbankIcon,
    izibank: IzibankIcon,
    raiffeisen: RaiffeisenIcon,
    abank: AbankIcon,
    credit_dnipro: CreditDniproIcon,
};
