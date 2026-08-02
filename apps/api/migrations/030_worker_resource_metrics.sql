ALTER TABLE worker_heartbeats
  ADD COLUMN IF NOT EXISTS resident_memory_bytes bigint NOT NULL DEFAULT 0
    CHECK (resident_memory_bytes >= 0),
  ADD COLUMN IF NOT EXISTS heap_used_bytes bigint NOT NULL DEFAULT 0
    CHECK (heap_used_bytes >= 0),
  ADD COLUMN IF NOT EXISTS cpu_user_microseconds bigint NOT NULL DEFAULT 0
    CHECK (cpu_user_microseconds >= 0),
  ADD COLUMN IF NOT EXISTS cpu_system_microseconds bigint NOT NULL DEFAULT 0
    CHECK (cpu_system_microseconds >= 0);
