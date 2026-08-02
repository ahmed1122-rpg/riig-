import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";

const requiredAlerts = [
  "MotionPrepDependencyUnavailable",
  "MotionPrepObjectStorageUnavailable",
  "MotionPrepSmtpUnavailable",
  "MotionPrepOperationalMetricsUnavailable",
  "MotionPrepWorkerMissing",
  "MotionPrepQueueTooOld",
  "MotionPrepLeaseLoss",
  "MotionPrepRetryStorm",
  "MotionPrepTerminalJobFailuresHigh",
  "MotionPrepEmailOutboxBacklog",
  "MotionPrepEmailOutboxFailures",
  "MotionPrepRetentionMaintenanceOverdue",
  "MotionPrepContainerMemoryPressure",
  "MotionPrepContainerCpuSaturation",
  "MotionPrepHttpErrorRateHigh",
  "MotionPrepAuthenticationRejectionsHigh",
  "MotionPrepApiLatencyHigh",
];

const requiredDashboardMetrics = [
  "motionprep_http_request_duration_seconds_bucket",
  "motionprep_queue_jobs",
  "motionprep_worker_up",
  "motionprep_worker_resident_memory_bytes",
  "motionprep_worker_cpu_seconds_total",
  "motionprep_dependencies_ready",
  "motionprep_dependency_ready",
  "motionprep_worker_events_last_hour",
  "motionprep_email_outbox_messages",
  "motionprep_email_outbox_events_last_hour",
  "motionprep_build_info",
  "motionprep_process_resident_memory_bytes",
];

export async function verifyObservabilityArtifacts(root) {
  const violations = [];
  try {
    const source = await readFile(
      join(root, "deploy/prometheus-alerts.yml"),
      "utf8",
    );
    const document = parse(source);
    const names = new Set(
      (document?.groups ?? []).flatMap((group) =>
        (group.rules ?? []).map((rule) => rule.alert),
      ),
    );
    for (const alert of requiredAlerts) {
      if (!names.has(alert)) {
        violations.push(`Prometheus alert contract is missing ${alert}.`);
      }
    }
  } catch (error) {
    violations.push(
      `Prometheus alert rules are invalid YAML: ${message(error)}`,
    );
  }
  try {
    const dashboard = JSON.parse(
      await readFile(
        join(root, "deploy/grafana/dashboards/motionprep-overview.json"),
        "utf8",
      ),
    );
    const expressions = JSON.stringify(dashboard.panels ?? []);
    for (const metric of requiredDashboardMetrics) {
      if (!expressions.includes(metric)) {
        violations.push(`Grafana dashboard is missing metric ${metric}.`);
      }
    }
  } catch (error) {
    violations.push(`Grafana dashboard is not valid JSON: ${message(error)}`);
  }
  return violations;
}

function message(error) {
  return error instanceof Error ? error.message : "unknown error";
}
