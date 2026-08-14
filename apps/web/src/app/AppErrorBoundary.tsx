import { Component, type ErrorInfo, type ReactNode } from "react";

interface AppErrorReport {
  error: Error;
  componentStack: string;
}

interface AppErrorBoundaryProps {
  children: ReactNode;
  onError?: (report: AppErrorReport) => void;
}

interface AppErrorBoundaryState {
  failed: boolean;
}

export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    let adapterReported = false;
    try {
      if (this.props.onError) {
        this.props.onError({
          error,
          componentStack: info.componentStack ?? "",
        });
        adapterReported = true;
      }
    } catch {
      // A reporting adapter cannot be allowed to replace the fallback.
    }
    if (adapterReported) return;
    const reportError = globalThis.reportError;
    if (typeof reportError !== "function") return;
    try {
      reportError(error);
    } catch {
      // A platform reporting failure must not replace the recovery surface.
    }
  }

  private readonly recover = (): void => {
    this.setState({ failed: false });
  };

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="app-fatal-error" role="alert" aria-live="assertive">
        <section>
          <span aria-hidden="true">!</span>
          <p>تعذّر عرض مساحة العمل</p>
          <h1>حدث خطأ غير متوقع في الواجهة</h1>
          <small>
            لن يرسل هذا التنبيه عمليات جديدة تلقائيًا. جرّب الاستعادة لإعادة
            بناء الواجهة من الجلسة المحفوظة، أو أعد تحميل التطبيق عند استمرار
            المشكلة.
          </small>
          <div>
            <button type="button" onClick={this.recover}>
              محاولة الاستعادة
            </button>
            <button
              type="button"
              className="is-secondary"
              onClick={() => window.location.reload()}
            >
              إعادة تحميل التطبيق
            </button>
            <button
              type="button"
              className="is-secondary"
              onClick={() => window.location.assign("/")}
            >
              العودة إلى البداية
            </button>
          </div>
        </section>
      </main>
    );
  }
}
