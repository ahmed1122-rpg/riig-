export function integrationEndpoints(environment) {
  const postgresPort = integrationPort(
    environment,
    "INTEGRATION_POSTGRES_PORT",
    55_432,
  );
  const mailpitPort = integrationPort(
    environment,
    "INTEGRATION_MAILPIT_PORT",
    58_025,
  );
  const apiAPort = integrationPort(
    environment,
    "INTEGRATION_API_A_PORT",
    54_101,
  );
  const apiBPort = integrationPort(
    environment,
    "INTEGRATION_API_B_PORT",
    54_102,
  );
  return {
    apiOrigins: [loopbackOrigin(apiAPort), loopbackOrigin(apiBPort)],
    mailpitOrigin: loopbackOrigin(mailpitPort),
    databaseUrl:
      "postgresql://motionprep:motionprep-integration" +
      `@127.0.0.1:${postgresPort}/motionprep`,
  };
}

export function integrationPort(environment, name, fallback) {
  const value = environment[name]?.trim();
  if (!value) return fallback;
  if (!/^\d+$/u.test(value)) {
    throw new Error(`${name} must be a valid TCP port.`);
  }
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${name} must be between 1 and 65535.`);
  }
  return port;
}

export async function withAvailableIntegrationPorts(
  environment,
  allocate = allocateLoopbackPorts,
) {
  const missing = dynamicPortNames.filter((name) => !environment[name]?.trim());
  const resolved = { ...environment };
  if (missing.length > 0) {
    const allocated = await allocate(missing.length);
    if (
      allocated.length !== missing.length ||
      new Set(allocated).size !== allocated.length
    ) {
      throw new Error("Integration port allocator returned an invalid port set.");
    }
    missing.forEach((name, index) => {
      resolved[name] = String(integrationPort(
        { value: String(allocated[index]) },
        "value",
        1,
      ));
    });
  }
  const selected = dynamicPortNames.map((name) =>
    integrationPort(resolved, name, 1),
  );
  if (new Set(selected).size !== selected.length) {
    throw new Error("Integration service ports must be distinct.");
  }
  return resolved;
}

async function allocateLoopbackPorts(count) {
  const servers = [];
  try {
    for (let index = 0; index < count; index += 1) {
      const server = createServer();
      servers.push(server);
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
    }
    return servers.map((server) => {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Could not allocate an integration loopback port.");
      }
      return address.port;
    });
  } finally {
    await Promise.all(servers.map((server) => new Promise((resolve) => {
      server.close(() => resolve());
    })));
  }
}

function loopbackOrigin(port) {
  return `http://127.0.0.1:${port}`;
}
import { createServer } from "node:net";

const dynamicPortNames = [
  "INTEGRATION_POSTGRES_PORT",
  "INTEGRATION_MAILPIT_PORT",
  "INTEGRATION_API_A_PORT",
  "INTEGRATION_API_B_PORT",
];
