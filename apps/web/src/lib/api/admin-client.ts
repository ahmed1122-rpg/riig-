import { request } from "./transport";
import type {
  AdminAuditEvent,
  AdminBillingData,
  AdminExportJob,
  AdminOverview,
  AdminProcessingJob,
  AdminSystemStatus,
  AdminUser,
} from "./models";

export function getAdminOverview(): Promise<AdminOverview> {
  return request("/v1/admin/overview");
}

export function getAdminUsers(): Promise<AdminUser[]> {
  return request("/v1/admin/users");
}

export function updateAdminUserAccess(
  userId: string,
  input: {
    role?: AdminUser["role"];
    status?: AdminUser["status"];
    reason: string;
  },
): Promise<AdminUser> {
  return request(`/v1/admin/users/${encodeURIComponent(userId)}/access`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function getAdminAudit(): Promise<AdminAuditEvent[]> {
  return request("/v1/admin/audit");
}

export function getAdminProcessing(): Promise<AdminProcessingJob[]> {
  return request("/v1/admin/processing");
}

export function getAdminExports(): Promise<AdminExportJob[]> {
  return request("/v1/admin/exports");
}

export function retryAdminProcessing(
  jobId: string,
  reason: string,
): Promise<AdminProcessingJob> {
  return request(
    `/v1/admin/processing/${encodeURIComponent(jobId)}/retry`,
    {
      method: "POST",
      body: JSON.stringify({ reason }),
    },
  );
}

export function retryAdminExport(
  jobId: string,
  reason: string,
): Promise<AdminExportJob> {
  return request(`/v1/admin/exports/${encodeURIComponent(jobId)}/retry`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export function getAdminBilling(): Promise<AdminBillingData> {
  return request("/v1/admin/billing");
}

export function getAdminSystem(): Promise<AdminSystemStatus> {
  return request("/v1/admin/system");
}
