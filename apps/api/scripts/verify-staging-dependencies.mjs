import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const acceptedPostgresTlsModes = new Set([
  "require",
  "verify-ca",
  "verify-full",
]);

function requireValue(environment, key) {
  const value = environment[key]?.trim();
  if (!value) throw new Error(`${key} is required.`);
  return value;
}

function parseUrl(environment, key) {
  const value = requireValue(environment, key);
  try {
    return new URL(value);
  } catch {
    throw new Error(`${key} must be a valid URL.`);
  }
}

function parseBoolean(environment, key) {
  const value = requireValue(environment, key);
  if (value !== "true" && value !== "false") {
    throw new Error(`${key} must be true or false.`);
  }
  return value === "true";
}

function parsePort(environment, key) {
  const value = Number(requireValue(environment, key));
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`${key} must be an integer between 1 and 65535.`);
  }
  return value;
}

export function loadStagingDependencyConfig(environment = process.env) {
  const databaseUrl = parseUrl(environment, "DATABASE_URL");
  const databaseTlsMode = databaseUrl.searchParams.get("sslmode")?.toLowerCase();
  if (
    databaseUrl.protocol !== "postgresql:" ||
    !acceptedPostgresTlsModes.has(databaseTlsMode ?? "")
  ) {
    throw new Error(
      "DATABASE_URL must use postgresql:// and sslmode=require, verify-ca, or verify-full.",
    );
  }

  const redisUrl = parseUrl(environment, "REDIS_URL");
  if (redisUrl.protocol !== "rediss:") {
    throw new Error("REDIS_URL must use rediss://.");
  }

  const smtpSecure = parseBoolean(environment, "SMTP_SECURE");
  const smtpRequireTls = parseBoolean(environment, "SMTP_REQUIRE_TLS");
  if (!smtpSecure && !smtpRequireTls) {
    throw new Error("SMTP must use implicit TLS or require STARTTLS.");
  }

  const smtpFrom = requireValue(environment, "SMTP_FROM");
  if (!smtpFrom.includes("@")) {
    throw new Error("SMTP_FROM must be an email address.");
  }

  return {
    databaseUrl: databaseUrl.toString(),
    redisUrl: redisUrl.toString(),
    smtp: {
      host: requireValue(environment, "SMTP_HOST"),
      port: parsePort(environment, "SMTP_PORT"),
      secure: smtpSecure,
      requireTls: smtpRequireTls,
      user: requireValue(environment, "SMTP_USER"),
      password: requireValue(environment, "SMTP_PASSWORD"),
      from: smtpFrom,
    },
  };
}

const defaultProbes = {
  async postgres(config) {
    const { Pool } = await import("pg");
    const pool = new Pool({
      connectionString: config.databaseUrl,
      connectionTimeoutMillis: 10_000,
      max: 1,
    });
    try {
      const client = await pool.connect();
      try {
        const result = await client.query(
          "SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()",
        );
        if (result.rows[0]?.ssl !== true) {
          throw new Error("PostgreSQL did not negotiate TLS.");
        }
      } finally {
        client.release();
      }
    } finally {
      await pool.end();
    }
  },

  async redis(config) {
    const { createClient } = await import("redis");
    const client = createClient({
      url: config.redisUrl,
      socket: { connectTimeout: 10_000 },
    });
    try {
      await client.connect();
      if ((await client.ping()) !== "PONG") {
        throw new Error("Redis did not return PONG.");
      }
      await client.quit();
    } finally {
      if (client.isOpen) client.destroy();
    }
  },

  async smtp(config) {
    const { default: nodemailer } = await import("nodemailer");
    const transport = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      requireTLS: config.smtp.requireTls,
      auth: { user: config.smtp.user, pass: config.smtp.password },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 10_000,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    try {
      await transport.verify();
    } finally {
      transport.close();
    }
  },
};

async function runProbe(name, probe, config) {
  try {
    await probe(config);
  } catch {
    throw new Error(`${name} readiness probe failed.`);
  }
}

export async function verifyStagingDependencies(
  environment = process.env,
  probes = defaultProbes,
) {
  const config = loadStagingDependencyConfig(environment);
  await runProbe("PostgreSQL", probes.postgres, config);
  await runProbe("Redis", probes.redis, config);
  await runProbe("SMTP", probes.smtp, config);
  return ["PostgreSQL", "Redis", "SMTP"];
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  try {
    const verified = await verifyStagingDependencies();
    const evidencePath = process.env.STAGING_DEPENDENCY_EVIDENCE_PATH?.trim();
    if (evidencePath) {
      const filename = resolve(evidencePath);
      await mkdir(dirname(filename), { recursive: true });
      await writeFile(
        filename,
        `${JSON.stringify(
          {
            schemaVersion: 1,
            verified: true,
            completedAt: new Date().toISOString(),
            releaseGitSha: process.env.RELEASE_GIT_SHA?.trim() || null,
            dependencies: verified.map((name) => ({ name, tls: "verified" })),
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
    }
    process.stdout.write(
      `Staging dependencies verified: ${verified.join(", ")}.\n`,
    );
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Staging dependency verification failed."}\n`,
    );
    process.exitCode = 1;
  }
}
