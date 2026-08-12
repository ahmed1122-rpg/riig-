ALTER TABLE worker_heartbeats
  DROP CONSTRAINT worker_heartbeats_worker_type_check;
ALTER TABLE worker_heartbeats
  ADD CONSTRAINT worker_heartbeats_worker_type_check
  CHECK (worker_type IN ('media', 'document', 'export', 'character'));

ALTER TABLE worker_events
  DROP CONSTRAINT worker_events_worker_type_check;
ALTER TABLE worker_events
  ADD CONSTRAINT worker_events_worker_type_check
  CHECK (worker_type IN ('media', 'document', 'export', 'character'));

ALTER TABLE worker_duration_metrics
  DROP CONSTRAINT worker_duration_metrics_worker_type_check;
ALTER TABLE worker_duration_metrics
  ADD CONSTRAINT worker_duration_metrics_worker_type_check
  CHECK (worker_type IN ('media', 'document', 'export', 'character'));
