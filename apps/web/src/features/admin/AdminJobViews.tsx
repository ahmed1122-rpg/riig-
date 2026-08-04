import type {
  AdminExportJob,
  AdminProcessingJob,
} from "../../lib/api";
import type { ReactNode } from "react";
import { useDebounce } from "../../shared/hooks/useDebounce";
import { formatDateTime } from "../../shared/formatters";
import { DataFeedback, Search, Status } from "./AdminPrimitives";

interface JobViewProps<TJob> {
  jobs: TJob[];
  query: string;
  onQuery: (value: string) => void;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

export function Processing({
  jobs,
  query,
  onQuery,
  loading,
  error,
  onRetry,
  canRetry,
  onRetryJob,
}: JobViewProps<AdminProcessingJob> & {
  canRetry: boolean;
  onRetryJob: (job: AdminProcessingJob) => void;
}) {
  const visible = useVisibleJobs(jobs, query);
  return (
    <section className="admin-view page-enter">
      <header className="admin-page-heading"><div><span className="eyebrow">طابور المعالجة</span><h1>المعالجة</h1><p>قراءة مباشرة للحالة؛ المدير فقط يستطيع إعادة مهمة فاشلة ذات مصدر حالي جاهز مع سبب مدقق.</p></div></header>
      <Search value={query} onChange={onQuery} placeholder="رقم المهمة أو المشروع أو رمز الخطأ…" />
      <DataFeedback loading={loading} error={error} empty={!loading && !error && visible.length === 0} onRetry={onRetry} />
      {!loading && !error && visible.length > 0 && (
        <JobTable
          jobs={visible}
          kindLabel={(job) => job.projectKind === "image" ? "صورة" : "PDF"}
          action={(job) =>
            canRetry && job.status === "failed"
              ? <button type="button" className="admin-row-action" onClick={() => onRetryJob(job)}>إعادة</button>
              : job.error
                ? <abbr title={job.error.code}>!</abbr>
                : null
          }
          ariaLabel="مهام المعالجة"
        />
      )}
    </section>
  );
}

export function Exports({
  jobs,
  query,
  onQuery,
  loading,
  error,
  onRetry,
  canRetry,
  onRetryJob,
}: JobViewProps<AdminExportJob> & {
  canRetry: boolean;
  onRetryJob: (job: AdminExportJob) => void;
}) {
  const visible = useVisibleJobs(jobs, query);
  return (
    <section className="admin-view page-enter">
      <header className="admin-page-heading"><div><span className="eyebrow">طابور التصدير</span><h1>التصديرات</h1><p>تشخيص حالة التصدير ومحاولاته ومعرّفات الربط والتتبع دون كشف سياق التتبع الخام.</p></div></header>
      <Search value={query} onChange={onQuery} placeholder="رقم المهمة أو المشروع أو معرّف التتبع…" />
      <DataFeedback loading={loading} error={error} empty={!loading && !error && visible.length === 0} onRetry={onRetry} />
      {!loading && !error && visible.length > 0 && (
        <JobTable
          jobs={visible}
          kindLabel={(job) => job.format.toUpperCase()}
          action={(job) =>
            canRetry && job.status === "failed"
              ? <button type="button" className="admin-row-action" onClick={() => onRetryJob(job)}>إعادة</button>
              : job.error
                ? <abbr title={job.error.code}>{job.error.code}</abbr>
                : null
          }
          ariaLabel="مهام التصدير"
        />
      )}
    </section>
  );
}

interface OperationalJob {
  id: string;
  projectId: string;
  status: string;
  progress: number;
  correlationId: string | null;
  traceId: string | null;
  attempt: { current: number; maximum: number };
  error: { code: string } | null;
  updatedAt: string;
}

function useVisibleJobs<TJob extends OperationalJob>(
  jobs: TJob[],
  query: string,
): TJob[] {
  const debouncedQuery = useDebounce(query, 250).toLowerCase();
  return jobs.filter((job) =>
    `${job.id} ${job.projectId} ${job.status} ${job.error?.code ?? ""} ${job.correlationId ?? ""} ${job.traceId ?? ""}`
      .toLowerCase()
      .includes(debouncedQuery),
  );
}

function JobTable<TJob extends OperationalJob>({
  jobs,
  kindLabel,
  action,
  ariaLabel,
}: {
  jobs: TJob[];
  kindLabel: (job: TJob) => string;
  action: (job: TJob) => ReactNode;
  ariaLabel: string;
}) {
  return (
    <div className="admin-data-table processing-table" role="table" aria-label={ariaLabel}>
      <div className="admin-data-head" role="row">
        <span role="columnheader">المهمة</span><span role="columnheader">النوع</span><span role="columnheader">الحالة</span><span role="columnheader">التقدم</span><span role="columnheader">آخر تحديث</span><span role="columnheader">الخطأ/الإجراء</span>
      </div>
      {jobs.map((job) => (
        <div className="admin-data-row" role="row" key={job.id}>
          <span role="cell"><strong><bdi>{job.id.slice(0, 12)}</bdi></strong><small><bdi>{job.projectId.slice(0, 12)}</bdi></small>{job.correlationId && <small title={job.correlationId}>REQ <bdi>{job.correlationId.slice(0, 12)}</bdi></small>}{job.traceId && <small title={job.traceId}>TRACE <bdi>{job.traceId.slice(0, 12)}</bdi></small>}</span>
          <span role="cell">{kindLabel(job)}</span>
          <span role="cell"><Status tone={job.status === "ready" ? "ready" : job.status === "failed" ? "danger" : "processing"}>{job.status}</Status></span>
          <span role="cell"><bdi>{job.progress}%</bdi><small>محاولة {job.attempt.current}/{job.attempt.maximum}</small></span>
          <span role="cell">{formatDateTime(job.updatedAt)}</span>
          <span role="cell">{action(job)}</span>
        </div>
      ))}
    </div>
  );
}
