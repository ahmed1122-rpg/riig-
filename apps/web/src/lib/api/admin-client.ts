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

export function getAdminOverview(signal?: AbortSignal): Promise<AdminOverview> {
  return request("/v1/admin/overview", { signal });
}

export function getAdminUsers(signal?: AbortSignal): Promise<AdminUser[]> {
  return request("/v1/admin/users", { signal });
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

export function getAdminAudit(signal?: AbortSignal): Promise<AdminAuditEvent[]> {
  return request("/v1/admin/audit", { signal });
}

export function getAdminProcessing(
  signal?: AbortSignal,
): Promise<AdminProcessingJob[]> {
  return request("/v1/admin/processing", { signal });
}

export function getAdminExports(signal?: AbortSignal): Promise<AdminExportJob[]> {
  return request("/v1/admin/exports", { signal });
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

export function getAdminBilling(signal?: AbortSignal): Promise<AdminBillingData> {
  return request("/v1/admin/billing", { signal });
}

export function getAdminSystem(signal?: AbortSignal): Promise<AdminSystemStatus> {
  return request("/v1/admin/system", { signal });
}
