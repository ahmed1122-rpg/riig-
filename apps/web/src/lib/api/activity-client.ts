import type {
  WorkflowActivityFeed,
  WorkflowActivityItem,
} from "@motionprep/contracts";
import { request } from "./transport";

export type { WorkflowActivityFeed, WorkflowActivityItem };

interface ListWorkflowActivityOptions {
  limit?: number;
  cursor?: string;
  signal?: AbortSignal;
}

export function listWorkflowActivity(
  options: ListWorkflowActivityOptions = {},
): Promise<WorkflowActivityFeed> {
  const query = new URLSearchParams();
  query.set("limit", String(options.limit ?? 12));
  if (options.cursor) query.set("cursor", options.cursor);
  return request<WorkflowActivityFeed>(`/v1/activity?${query.toString()}`, {
    ...(options.signal ? { signal: options.signal } : {}),
  });
}
