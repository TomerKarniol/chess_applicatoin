export interface ResetCodeRecord {
  readonly id: number;
  readonly userId: number;
  readonly codeHash: string;
  readonly expiresAt: string;
  readonly verifiedAt: string | null;
  readonly usedAt: string | null;
  readonly attempts: number;
  readonly createdAt: string;
}

export interface ResetSession {
  readonly id: string;
  readonly userId: number;
  readonly codeId: number;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export const RESET_CODE_DIGITS = 6;
export const RESET_SESSION_ID_BYTES = 32;
export const RESET_SESSION_COOKIE_NAME = 'chess_reset_sid';
