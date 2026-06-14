export interface Session {
  readonly id: string;
  readonly userId: number;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export const SESSION_ID_BYTES = 32;
export const SESSION_COOKIE_NAME = 'chess_sid';
