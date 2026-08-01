import { Component, type ReactNode } from "react";

interface AppErrorBoundaryProps {
  children: ReactNode;
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

  componentDidCatch(error: Error): void {
    globalThis.reportError(error);
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="app-fatal-error" role="alert" aria-live="assertive">
        <section>
          <span aria-hidden="true">!</span>
          <p>تعذّر عرض مساحة العمل</p>
          <h1>حدث خطأ غير متوقع في الواجهة</h1>
          <small>
            لم تُرسل أي عملية جديدة بعد الخطأ. أعد تحميل التطبيق لاستعادة آخر
            نسخة محفوظة من المشروع.
          </small>
          <div>
            <button type="button" onClick={() => window.location.reload()}>
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
