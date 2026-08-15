const lcpBuckets = [1, 2.5, 4, 8, 16];
const cspDirectives = new Set([
  "base-uri",
  "connect-src",
  "default-src",
  "font-src",
  "form-action",
  "frame-ancestors",
  "frame-src",
  "img-src",
  "manifest-src",
  "media-src",
  "object-src",
  "script-src",
  "script-src-attr",
  "script-src-elem",
  "style-src",
  "style-src-attr",
  "style-src-elem",
  "worker-src",
]);

export class ClientTelemetryMetrics {
  private readonly errors = new Map<string, number>();
  private readonly lcpBucketCounts = lcpBuckets.map(() => 0);
  private lcpCount = 0;
  private lcpSumSeconds = 0;
  private readonly cspViolations = new Map<string, number>();

  constructor(private readonly release = "development") {}

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

  observeCspViolation(
    directive: string,
    disposition: string,
    browserFamily = "unknown",
  ): void {
    const boundedDirective = cspDirectives.has(directive)
      ? directive
      : "unknown";
    const boundedDisposition =
      disposition === "enforce" || disposition === "report"
        ? disposition
        : "unknown";
    const boundedBrowser = ["chromium", "firefox", "webkit"].includes(
      browserFamily,
    )
      ? browserFamily
      : "unknown";
    const key = `${boundedDirective}:${boundedDisposition}:${boundedBrowser}`;
    this.cspViolations.set(key, (this.cspViolations.get(key) ?? 0) + 1);
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
      "# HELP motionprep_csp_violations_total Sanitized CSP violation reports by directive and disposition.",
      "# TYPE motionprep_csp_violations_total counter",
    );
    for (const [key, count] of [...this.cspViolations].sort()) {
      const [directive, disposition, browser] = key.split(":");
      lines.push(
        `motionprep_csp_violations_total{directive="${directive}",disposition="${disposition}",browser="${browser}",release="${metricLabel(this.release)}"} ${count}`,
      );
    }
    return lines;
  }
}

function metricLabel(value: string): string {
  return /^[A-Za-z0-9_.-]{1,64}$/u.test(value) ? value : "unknown";
}
