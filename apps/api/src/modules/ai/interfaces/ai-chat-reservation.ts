import type { ReservationTicket } from '../../users/interfaces/reservation';

export interface AiChatReservationTicket extends ReservationTicket {
    aiRequestsUsedAfterReserve: number;
    bonusGranted: boolean;
}
