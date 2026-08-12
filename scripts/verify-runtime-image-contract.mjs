const runtimeStageMarker = /^FROM\s+\S+\s+AS\s+runtime\s*$/imu;

export function verifyRuntimeImageContract({ dockerfile, composeDocument }) {
  const violations = [];
  const marker = runtimeStageMarker.exec(dockerfile);
  if (!marker) return ["Dockerfile must define a final runtime stage."];

  const buildStage = dockerfile.slice(0, marker.index);
  const runtimeStage = dockerfile.slice(marker.index + marker[0].length);
  const copiedRuntimePaths = collectCopyDestinations(runtimeStage);
  const runtimeImage = composeDocument?.["x-runtime"]?.image;

  if (!runtimeImage) {
    return ["Production Compose must define the shared x-runtime image contract."];
  }

  for (const [serviceName, service] of Object.entries(
    composeDocument?.services ?? {},
  )) {
    const serviceImage = service?.image ?? service?.["<<"]?.image;
    if (serviceImage !== runtimeImage) continue;
    for (const executablePath of collectExecutablePaths(service)) {
      if (!isProvidedByRuntime(executablePath, copiedRuntimePaths)) {
        violations.push(
          `Runtime service ${serviceName} executes ${executablePath}, but the final image does not copy that path.`,
        );
      }

      const workspace = /^(apps\/[^/]+)\/dist\//u.exec(executablePath)?.[1];
      if (
        workspace &&
        !buildStage.includes(`COPY ${workspace}/package.json ./${workspace}/package.json`)
      ) {
        violations.push(
          `Runtime service ${serviceName} uses ${workspace}, but its package manifest is not copied before npm ci.`,
        );
      }
    }
  }

  return violations;
}

function collectCopyDestinations(stage) {
  const destinations = new Set();
  for (const line of stage.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("COPY ")) continue;
    const destination = trimmed.split(/\s+/u).at(-1);
    if (!destination) continue;
    destinations.add(normalizeContainerPath(destination));
  }
  return destinations;
}

function collectExecutablePaths(service) {
  const values = [
    ...(Array.isArray(service.command) ? service.command : []),
    ...(Array.isArray(service.healthcheck?.test) ? service.healthcheck.test : []),
  ];
  return new Set(
    values.filter(
      (value) =>
        typeof value === "string" &&
        /^(?:apps|packages|scripts)\/[^\s]+\.(?:js|mjs)$/u.test(value),
    ),
  );
}

function isProvidedByRuntime(executablePath, copiedRuntimePaths) {
  const normalized = normalizeContainerPath(executablePath);
  return [...copiedRuntimePaths].some(
    (copiedPath) =>
      normalized === copiedPath || normalized.startsWith(`${copiedPath}/`),
  );
}

function normalizeContainerPath(value) {
  return value.replace(/^\.\//u, "").replace(/^\/app\//u, "").replace(/\/$/u, "");
}
