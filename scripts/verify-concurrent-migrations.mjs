import { spawn } from "node:child_process";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for concurrent migration verification.");
}
const migrationProcess =
  process.platform === "win32"
    ? {
        command: process.env.ComSpec ?? "cmd.exe",
        arguments: [
          "/d",
          "/s",
          "/c",
          "npm run db:migrate --workspace @motionprep/api",
        ],
      }
    : {
        command: "npm",
        arguments: [
          "run",
          "db:migrate",
          "--workspace",
          "@motionprep/api",
        ],
      };

await Promise.all([
  runMigration("concurrent migration A"),
  runMigration("concurrent migration B"),
]);
await runMigration("idempotent migration replay");

process.stdout.write(
  "Concurrent migration safety and idempotent replay verified.\n",
);

function runMigration(label) {
  return new Promise((resolve, reject) => {
    const child = spawn(migrationProcess.command, migrationProcess.arguments, {
      cwd: process.cwd(),
      env: process.env,
      shell: false,
      stdio: "inherit",
    });

    child.once("error", (error) => {
      reject(new Error(`${label} could not start.`, { cause: error }));
    });
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${label} failed with ${signal ? `signal ${signal}` : `exit code ${code}`}.`,
        ),
      );
    });
  });
}
