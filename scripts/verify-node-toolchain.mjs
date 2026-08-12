export function verifyNodeToolchain({
  nodeVersion,
  packageManifest,
  npmConfig,
  dockerfiles,
}) {
  const violations = [];
  if (!/^\d+\.\d+\.\d+$/u.test(nodeVersion)) {
    violations.push(".node-version must contain one exact semantic version.");
    return violations;
  }

  const nodeMajor = Number.parseInt(nodeVersion.split(".")[0] ?? "", 10);
  const expectedNodeEngine = `>=${nodeVersion} <${nodeMajor + 1}`;
  try {
    const packageDocument = JSON.parse(packageManifest);
    if (packageDocument.engines?.node !== expectedNodeEngine) {
      violations.push(
        `package.json engines.node must be ${expectedNodeEngine} to match .node-version.`,
      );
    }
    violations.push(...verifyNpmPolicy(packageDocument, npmConfig, nodeVersion));
  } catch {
    violations.push("package.json must be valid JSON before deployment.");
  }

  const expectedNodeImage = `node:${nodeVersion}-bookworm-slim@sha256:`;
  const nodeImageReferences = new Set();
  for (const dockerfile of dockerfiles) {
    const definedStages = new Set();
    for (const line of dockerfile.split(/\r?\n/u)) {
      const from = /^FROM\s+(\S+)(?:\s+AS\s+(\S+))?$/iu.exec(line.trim());
      if (!from) continue;
      const source = from[1];
      const internalStage = definedStages.has(source.toLowerCase());
      if (!internalStage && !/@sha256:[a-f0-9]{64}$/iu.test(source)) {
        violations.push(`Dockerfile base image must be pinned by digest: ${line}`);
      }
      if (source.startsWith("node:")) {
        nodeImageReferences.add(source);
        if (!source.includes(expectedNodeImage)) {
          violations.push(
            `Dockerfile Node.js base must match .node-version (${nodeVersion}): ${line}`,
          );
        }
      }
      if (from[2]) definedStages.add(from[2].toLowerCase());
    }
  }
  if (nodeImageReferences.size > 1) {
    violations.push(
      "Every Dockerfile must use one identical digest-pinned Node.js base image.",
    );
  }
  return violations;
}

function verifyNpmPolicy(packageDocument, npmConfig, nodeVersion) {
  const violations = [];
  const packageManagerMatch = /^npm@(\d+\.\d+\.\d+)$/u.exec(
    packageDocument.packageManager ?? "",
  );
  if (!packageManagerMatch) {
    violations.push("package.json packageManager must pin one exact npm version.");
  } else {
    const npmVersion = packageManagerMatch[1];
    const npmMajor = Number.parseInt(npmVersion.split(".")[0] ?? "", 10);
    const expectedNpmEngine = `>=${npmVersion} <${npmMajor + 1}`;
    if (packageDocument.engines?.npm !== expectedNpmEngine) {
      violations.push(
        `package.json engines.npm must be ${expectedNpmEngine} to match packageManager.`,
      );
    }
    const packageManager = packageDocument.devEngines?.packageManager;
    if (
      packageManager?.name !== "npm" ||
      packageManager.version !== npmVersion ||
      packageManager.onFail !== "error"
    ) {
      violations.push(
        `package.json devEngines.packageManager must require npm ${npmVersion} with onFail=error.`,
      );
    }
  }
  const runtime = packageDocument.devEngines?.runtime;
  if (
    runtime?.name !== "node" ||
    runtime.version !== nodeVersion ||
    runtime.onFail !== "error"
  ) {
    violations.push(
      `package.json devEngines.runtime must require Node ${nodeVersion} with onFail=error.`,
    );
  }
  if (!/^engine-strict=true$/mu.test(npmConfig)) {
    violations.push(".npmrc must fail closed with engine-strict=true.");
  }
  if (!/^strict-allow-scripts=true$/mu.test(npmConfig)) {
    violations.push(".npmrc must fail closed with strict-allow-scripts=true.");
  }
  const allowScripts = packageDocument.allowScripts ?? {};
  for (const [dependency, expected] of Object.entries({
    "esbuild@0.28.1": true,
    "fsevents@2.3.2": true,
    "fsevents@2.3.3": true,
    protobufjs: false,
    "tesseract.js": false,
  })) {
    if (allowScripts[dependency] !== expected) {
      violations.push(
        `package.json allowScripts must set ${dependency} to ${expected}.`,
      );
    }
  }
  return violations;
}
