import { parse } from "yaml";

function parseCompose(source, label, violations) {
  try {
    return parse(source);
  } catch (error) {
    violations.push(
      `${label} Compose is invalid YAML: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    return undefined;
  }
}

function hasBoundedLogging(logging) {
  return (
    logging?.driver === "local" &&
    typeof logging?.options?.["max-size"] === "string" &&
    typeof logging?.options?.["max-file"] === "string"
  );
}

function verifyPublishedPorts(document, label, violations) {
  for (const [serviceName, service] of Object.entries(document?.services ?? {})) {
    for (const port of service?.ports ?? []) {
      const isLoopback =
        typeof port === "string"
          ? port.startsWith("127.0.0.1:")
          : port?.host_ip === "127.0.0.1";
      if (!isLoopback) {
        violations.push(
          `${label} service ${serviceName} must bind every published port to 127.0.0.1.`,
        );
      }
    }
  }
}

function verifyServiceLogging(document, serviceNames, label, violations) {
  for (const serviceName of serviceNames) {
    const service = document?.services?.[serviceName];
    if (service && !hasBoundedLogging(service.logging)) {
      violations.push(
        `${label} service ${serviceName} must use bounded local logging.`,
      );
    }
  }
}

export function verifyDockerHardening({
  runtimeDockerfile,
  webDockerfile,
  qaDockerfile,
  dockerignore,
  localCompose,
  integrationCompose,
}) {
  const violations = [];

  if (/\b(?:apt-get|apk)\s+upgrade\b/u.test(runtimeDockerfile)) {
    violations.push(
      "Runtime Dockerfile must not run package-manager upgrades; base-image updates must remain digest-controlled.",
    );
  }

  if (!runtimeDockerfile.includes("RUN apk add --no-cache fontconfig")) {
    violations.push(
      "Runtime Dockerfile must install fontconfig without retaining an Alpine package index.",
    );
  }

  const qaStage = qaDockerfile.split(/^FROM\s+.+\s+AS\s+qa\s*$/imu).at(-1) ?? "";
  if (!/^USER\s+node\s*$/imu.test(qaStage)) {
    violations.push("QA image must run as the non-root node user.");
  }
  const qaInstallIndex = qaDockerfile.search(/^RUN\s+.*\bnpm ci\b/mu);
  const qaLayerDomainIndex = qaDockerfile.indexOf(
    "packages/layer-domain/package.json",
  );
  if (
    qaInstallIndex < 0 ||
    qaLayerDomainIndex < 0 ||
    qaLayerDomainIndex > qaInstallIndex
  ) {
    violations.push(
      "QA Dockerfile must copy the layer-domain workspace manifest before installing dependencies.",
    );
  }

  const installIndex = webDockerfile.search(/^RUN\s+.*\bnpm ci\b/mu);
  const broadCopyIndexes = [
    webDockerfile.indexOf("COPY apps ./apps"),
    webDockerfile.indexOf("COPY packages ./packages"),
  ];
  if (
    installIndex < 0 ||
    broadCopyIndexes.some((index) => index < 0 || index < installIndex)
  ) {
    violations.push(
      "Web dependency installation must happen after workspace manifests and before broad source copies.",
    );
  }
  for (const manifest of [
    "apps/web/package.json",
    "packages/contracts/package.json",
    "packages/layer-domain/package.json",
  ]) {
    const manifestIndex = webDockerfile.indexOf(manifest);
    if (manifestIndex < 0 || manifestIndex > installIndex) {
      violations.push(
        `Web Dockerfile must copy ${manifest} before installing dependencies.`,
      );
    }
  }

  const ignoredPaths = new Set(
    dockerignore
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#")),
  );
  for (const ignoredPath of [
    "**/*.tsbuildinfo",
    ".tmp",
    "test-results",
    "playwright-report",
    "dogfood-output",
  ]) {
    if (!ignoredPaths.has(ignoredPath)) {
      violations.push(`Docker build context must ignore ${ignoredPath}.`);
    }
  }

  const localDocument = parseCompose(localCompose, "Local", violations);
  const integrationDocument = parseCompose(
    integrationCompose,
    "Integration",
    violations,
  );
  verifyPublishedPorts(localDocument, "Local Compose", violations);
  verifyPublishedPorts(integrationDocument, "Integration Compose", violations);

  verifyServiceLogging(
    localDocument,
    Object.keys(localDocument?.services ?? {}),
    "Local Compose",
    violations,
  );
  verifyServiceLogging(
    integrationDocument,
    [
      "postgres",
      "redis",
      "minio",
      "minio-init",
      "clamav-db-init",
      "clamav",
      "mailpit",
      "release-web",
    ],
    "Integration Compose",
    violations,
  );

  const clamav = integrationDocument?.services?.clamav;
  const clamavDatabaseInit = integrationDocument?.services?.["clamav-db-init"];
  if (clamav?.init === true) {
    violations.push(
      "Integration ClamAV must not place a second Compose init in front of direct clamd.",
    );
  }
  if (
    clamav?.entrypoint?.[0] !== "clamd" ||
    !clamav.entrypoint.includes("--foreground")
  ) {
    violations.push(
      "Integration ClamAV must start clamd directly without downloading public databases.",
    );
  }
  if (
    clamav?.user !== "clamav" ||
    clamav?.read_only !== true ||
    !(clamav?.cap_drop ?? []).includes("ALL") ||
    !(clamav?.security_opt ?? []).includes("no-new-privileges:true")
  ) {
    violations.push(
      "Integration ClamAV must run as its non-root user with a read-only, capability-free container.",
    );
  }
  if (
    !String(clamavDatabaseInit?.command ?? "").includes("sigtool --build=daily") ||
    clamavDatabaseInit?.user !== "clamav" ||
    clamavDatabaseInit?.read_only !== true ||
    !(clamavDatabaseInit?.cap_drop ?? []).includes("ALL") ||
    clamav?.depends_on?.["clamav-db-init"]?.condition !==
      "service_completed_successfully"
  ) {
    violations.push(
      "Integration ClamAV must generate a fresh local CUD in an isolated one-shot service before startup.",
    );
  }

  const runtime = integrationDocument?.["x-runtime"];
  if (runtime?.init !== true) {
    violations.push("Integration runtime containers must enable init.");
  }
  if (runtime?.read_only !== true) {
    violations.push("Integration runtime containers must use a read-only root filesystem.");
  }
  if (!Number.isInteger(runtime?.pids_limit) || runtime.pids_limit <= 0) {
    violations.push("Integration runtime containers must enforce a positive PID limit.");
  }
  if (!(runtime?.tmpfs ?? []).some((entry) => String(entry).startsWith("/tmp"))) {
    violations.push("Integration runtime containers must provide a bounded /tmp tmpfs.");
  }
  if (!(runtime?.security_opt ?? []).includes("no-new-privileges:true")) {
    violations.push("Integration runtime containers must disable privilege escalation.");
  }
  if (!(runtime?.cap_drop ?? []).includes("ALL")) {
    violations.push("Integration runtime containers must drop all Linux capabilities.");
  }
  if (!hasBoundedLogging(runtime?.logging)) {
    violations.push("Integration runtime containers must use bounded local logging.");
  }

  const releaseWeb = integrationDocument?.services?.["release-web"];
  if (
    !(releaseWeb?.tmpfs ?? []).some((entry) =>
      String(entry).startsWith("/etc/nginx/conf.d"),
    )
  ) {
    violations.push(
      "Integration release web must provide a bounded tmpfs for rendered Nginx configuration.",
    );
  }
  if (!Number.isInteger(releaseWeb?.pids_limit) || releaseWeb.pids_limit <= 0) {
    violations.push("Integration release web must enforce a positive PID limit.");
  }

  return violations;
}
