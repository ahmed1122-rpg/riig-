const lcpBuckets = [1, 2.5, 4, 8, 16];

export class ClientTelemetryMetrics {
  private readonly errors = new Map<string, number>();
  private readonly lcpBucketCounts = lcpBuckets.map(() => 0);
  private lcpCount = 0;
  private lcpSumSeconds = 0;

  observeError(kind: string): void {
    this.errors.set(kind, (this.errors.get(kind) ?? 0) + 1);
  }

  observeLcp(milliseconds: number): void {
    const seconds = milliseconds / 1_000;
    this.lcpCount += 1;
    this.lcpSumSeconds += seconds;
    lcpBuckets.forEach((bucket, index) => {
      if (seconds <= bucket) this.lcpBucketCounts[index]! += 1;
    });
  }

  render(): string[] {
    const lines = [
      "# HELP motionprep_client_errors_total Sanitized browser errors reported by kind.",
      "# TYPE motionprep_client_errors_total counter",
    ];
    for (const [kind, count] of [...this.errors].sort()) {
      lines.push(`motionprep_client_errors_total{kind="${kind}"} ${count}`);
    }
    lines.push(
      "# HELP motionprep_client_lcp_seconds Largest Contentful Paint reported by browsers.",
      "# TYPE motionprep_client_lcp_seconds histogram",
      ...lcpBuckets.map(
        (bucket, index) =>
          `motionprep_client_lcp_seconds_bucket{le="${bucket}"} ${this.lcpBucketCounts[index]}`,
      ),
      `motionprep_client_lcp_seconds_bucket{le="+Inf"} ${this.lcpCount}`,
      `motionprep_client_lcp_seconds_sum ${this.lcpSumSeconds}`,
      `motionprep_client_lcp_seconds_count ${this.lcpCount}`,
    );
    return lines;
  }
}
