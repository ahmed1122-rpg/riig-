import {
  BILLING_PLAN_CATALOG,
  type SubscriptionView,
} from "@motionprep/contracts";

export function usageForPlan(
  current: SubscriptionView["usage"],
  planId: SubscriptionView["planId"],
): SubscriptionView["usage"] {
  const plan = planFor(planId);
  return {
    jobs: current.jobs,
    jobLimit: plan.jobLimit,
    processingMinutes: current.processingMinutes,
    processingMinuteLimit: plan.processingMinuteLimit,
  };
}

export function planFor(planId: SubscriptionView["planId"]) {
  const plan = BILLING_PLAN_CATALOG.find((candidate) => candidate.id === planId);
  if (!plan) throw new Error(`Unknown billing plan: ${planId}`);
  return plan;
}
