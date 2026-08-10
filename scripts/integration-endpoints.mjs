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

function loopbackOrigin(port) {
  return `http://127.0.0.1:${port}`;
}
