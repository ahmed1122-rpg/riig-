import type { UserRole, UserStatus } from "@motionprep/contracts";
import type {
  MfaChallengeRecord,
  MfaEnrollmentRecord,
  PasswordResetRecord,
  SessionRecord,
  UserRecord,
} from "../../auth/auth-repository.js";
import { toIso } from "./database.js";

export interface UserRow {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  password_hash: string;
  mfa_enabled: boolean;
  mfa_secret_ciphertext: string | null;
  recovery_code_hashes: string[];
  created_at: Date | string;
  last_login_at: Date | string | null;
  terms_version: string | null;
  privacy_version: string | null;
  legal_accepted_at: Date | string | null;
  deletion_requested_at: Date | string | null;
  deleted_at: Date | string | null;
}

export interface SessionRow {
  token_hash: string;
  user_id: string;
  created_at: Date | string;
  expires_at: Date | string;
}

export interface MfaEnrollmentRow {
  token_hash: string;
  user_id: string;
  secret_ciphertext: string;
  expires_at: Date | string;
}

export interface TokenRow {
  token_hash: string;
  user_id: string;
  expires_at: Date | string;
}

export const userSelect = `
  SELECT
    id, name, email, role, status, password_hash, mfa_enabled,
    mfa_secret_ciphertext, recovery_code_hashes, created_at, last_login_at,
    terms_version, privacy_version, legal_accepted_at,
    deletion_requested_at, deleted_at
  FROM users
`;

export function mapUser(row: UserRow): UserRecord {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    status: row.status,
    passwordHash: row.password_hash,
    mfaEnabled: row.mfa_enabled,
    mfaSecretCiphertext: row.mfa_secret_ciphertext,
    recoveryCodeHashes: row.recovery_code_hashes,
    createdAt: toIso(row.created_at),
    lastLoginAt: row.last_login_at ? toIso(row.last_login_at) : null,
    termsVersion: row.terms_version,
    privacyVersion: row.privacy_version,
    legalAcceptedAt: row.legal_accepted_at ? toIso(row.legal_accepted_at) : null,
    deletionRequestedAt: row.deletion_requested_at
      ? toIso(row.deletion_requested_at)
      : null,
    deletedAt: row.deleted_at ? toIso(row.deleted_at) : null,
  };
}

export function mapMfaEnrollment(row: MfaEnrollmentRow): MfaEnrollmentRecord {
  return {
    tokenHash: row.token_hash,
    userId: row.user_id,
    secretCiphertext: row.secret_ciphertext,
    expiresAt: toIso(row.expires_at),
  };
}

export function mapToken(row: TokenRow): MfaChallengeRecord & PasswordResetRecord {
  return {
    tokenHash: row.token_hash,
    userId: row.user_id,
    expiresAt: toIso(row.expires_at),
  };
}

export function mapSession(row: SessionRow): SessionRecord {
  return {
    tokenHash: row.token_hash,
    userId: row.user_id,
    createdAt: toIso(row.created_at),
    expiresAt: toIso(row.expires_at),
  };
}
