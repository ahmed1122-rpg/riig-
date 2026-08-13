import { spawn, spawnSync } from "node:child_process";

const durableDefaults = {
  PERSISTENCE_MODE: "postgres",
  DATABASE_URL:
    "postgresql://motionprep:motionprep@localhost:5432/motionprep",
  REDIS_URL: "redis://localhost:6379",
  OBJECT_STORAGE_MODE: "s3",
  OBJECT_STORAGE_ENDPOINT: "http://localhost:9000",
  OBJECT_STORAGE_REGION: "us-east-1",
  OBJECT_STORAGE_BUCKET: "motionprep-local",
  OBJECT_STORAGE_ACCESS_KEY: "motionprep",
  OBJECT_STORAGE_SECRET_KEY: "motionprep-local-only",
  OBJECT_STORAGE_FORCE_PATH_STYLE: "true",
  OBJECT_STORAGE_ENCRYPTION_MODE: "none",
  OBJECT_STORAGE_REQUIRE_VERSIONING: "true",
  PROCESSING_EXECUTION_MODE: "worker",
  EXPORT_EXECUTION_MODE: "worker",
};

const environment = { ...durableDefaults, ...process.env };
const compose = spawnSync(
  "docker",
  [
    "compose",
    "up",
    "-d",
    "--wait",
    "postgres",
    "redis",
    "minio",
    "minio-init",
    "mailpit",
  ],
  { stdio: "inherit", env: environment, shell: process.platform === "win32" },
);
if (compose.status !== 0) {
  process.stderr.write(
    "Durable development requires Docker Compose and healthy local services.\n",
  );
  process.exit(compose.status ?? 1);
}

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  process.stderr.write("npm_execpath is missing; run this script through npm.\n");
  process.exit(1);
}

const migration = spawnSync(
  process.execPath,
  [npmCli, "run", "db:migrate", "--workspace", "@motionprep/api"],
  { stdio: "inherit", env: environment },
);
if (migration.status !== 0) process.exit(migration.status ?? 1);

process.stdout.write(
  "Durable development is ready: PostgreSQL, Redis, MinIO, and workers are enabled.\n",
);
const application = spawn(
  process.execPath,
  [npmCli, "run", "dev:stack"],
  { stdio: "inherit", env: environment },
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => application.kill(signal));
}
application.on("exit", (code) => process.exit(code ?? 0));
