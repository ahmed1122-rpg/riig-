import { API_ORIGIN } from "../lib/api/transport";

interface ReactErrorReport {
  error: Error;
  componentStack: string;
}

type ClientReport =
  | {
      kind: "react" | "error" | "unhandledrejection";
      errorName: string;
      message: string;
      stack: string;
      componentStack: string;
    }
  | {
      kind: "performance";
      lcpMilliseconds: number;
    };

const recent = new Map<string, number>();
const maximumReportsPerPage = 10;
let sentReports = 0;

export function reportReactError(report: ReactErrorReport): void {
  submit({
    kind: "react",
    errorName: report.error.name,
    message: report.error.message,
    stack: report.error.stack ?? "",
    componentStack: report.componentStack,
  });
}

export function installClientTelemetry(): () => void {
  const onError = (event: ErrorEvent) => {
    const error = event.error instanceof Error ? event.error : undefined;
    submit({
      kind: "error",
      errorName: error?.name ?? "Error",
      message: error?.message ?? event.message,
      stack: error?.stack ?? "",
      componentStack: "",
    });
  };
  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    const error = event.reason instanceof Error ? event.reason : undefined;
    submit({
      kind: "unhandledrejection",
      errorName: error?.name ?? "UnhandledRejection",
      message: error?.message ?? String(event.reason ?? "unknown"),
      stack: error?.stack ?? "",
      componentStack: "",
    });
  };
  let lastLcp: number | undefined;
  let lcpSent = false;
  const observer = createLcpObserver((value) => {
    lastLcp = value;
  });
  const flushLcp = () => {
    if (lcpSent || lastLcp === undefined) return;
    lcpSent = true;
    submit({ kind: "performance", lcpMilliseconds: lastLcp });
    observer?.disconnect();
  };
  const onVisibility = () => {
    if (document.visibilityState === "hidden") flushLcp();
  };

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);
  window.addEventListener("pagehide", flushLcp);
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onUnhandledRejection);
    window.removeEventListener("pagehide", flushLcp);
    document.removeEventListener("visibilitychange", onVisibility);
    observer?.disconnect();
  };
}

function createLcpObserver(onValue: (value: number) => void) {
  if (typeof PerformanceObserver === "undefined") return undefined;
  try {
    const observer = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const latest = entries[entries.length - 1];
      if (latest) onValue(latest.startTime);
    });
    observer.observe({ type: "largest-contentful-paint", buffered: true });
    return observer;
  } catch {
    return undefined;
  }
}

function submit(report: ClientReport): void {
  if (sentReports >= maximumReportsPerPage) return;
  const payload = {
    ...boundedReport(report),
    route: window.location.pathname,
    release: import.meta.env.VITE_RELEASE_VERSION ?? "unknown",
  };
  const fingerprint = stableFingerprint(JSON.stringify(payload));
  const now = Date.now();
  if (now - (recent.get(fingerprint) ?? 0) < 60_000) return;
  recent.set(fingerprint, now);
  sentReports += 1;
  void fetch(`${API_ORIGIN}/v1/security/client-report`, {
    method: "POST",
    credentials: "omit",
    keepalive: true,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => undefined);
}

function boundedReport(report: ClientReport): ClientReport {
  if (report.kind === "performance") return report;
  return {
    kind: report.kind,
    errorName: report.errorName.slice(0, 128),
    message: report.message.slice(0, 500),
    stack: report.stack.slice(0, 4_000),
    componentStack: report.componentStack.slice(0, 2_000),
  };
}

function stableFingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}
