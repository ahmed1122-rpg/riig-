export interface LeaseHeartbeat {
  leaseLost(): boolean;
  stop(): void;
}

/**
 * Renews a claimed job lease without allowing overlapping renewal calls.
 * A false result or thrown error permanently marks the lease as lost.
 */
export function startLeaseHeartbeat(
  renew: () => Promise<boolean>,
  leaseMilliseconds: number,
): LeaseHeartbeat {
  let lost = false;
  let renewalInFlight = false;
  let stopped = false;
  const intervalMilliseconds = Math.max(
    10_000,
    Math.floor(leaseMilliseconds / 3),
  );

  const heartbeat = setInterval(() => {
    if (stopped || lost || renewalInFlight) return;
    renewalInFlight = true;
    void renew()
      .then((renewed) => {
        if (!renewed) lost = true;
      })
      .catch(() => {
        lost = true;
      })
      .finally(() => {
        renewalInFlight = false;
        if (lost) clearInterval(heartbeat);
      });
  }, intervalMilliseconds);
  heartbeat.unref();

  return {
    leaseLost: () => lost,
    stop: () => {
      stopped = true;
      clearInterval(heartbeat);
    },
  };
}
