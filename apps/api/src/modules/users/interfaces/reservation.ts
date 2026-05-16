/**
 * Backend-only reservation types. These are in-memory structures used between
 * feature reserve methods and core commit/refund — never serialized to clients.
 * NOT in packages/types because they depend on Mongoose ClientSession and are
 * not part of the shared API contract.
 */
import type { ClientSession } from 'mongoose';

export interface ReservationTicket {
    reservationId: string;
    userId: string;
    amount: number;
    balanceAfterReserve: number;
    expiresAt: Date;
    feature: string;
}

export interface CommitReservationLedgerEntry {
    type: string;
    action: string;
    amount: number;
}

export interface CommitReservationOptions {
    userId: string;
    reservationId: string;
    ledgerEntry: CommitReservationLedgerEntry;
    sideEffectInTx?: (session: ClientSession) => Promise<void>;
}

export interface CommitReservationResult {
    balanceAfter: number;
}
