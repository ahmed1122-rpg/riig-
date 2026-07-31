import type {
  UserRole,
  UserStatus,
  UserSummary,
} from "@motionprep/contracts";

export interface AdminAccessCommand {
  update(input: {
    actor: UserSummary;
    userId: string;
    changes: { role?: UserRole; status?: UserStatus };
    reason: string;
    requestId: string;
  }): Promise<UserSummary>;
}
