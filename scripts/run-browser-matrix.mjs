import { spawnSync } from "node:child_process";

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  throw new Error("The browser matrix must be launched through npm.");
}
const forwardedArguments = process.argv.slice(2);

for (const engine of ["chromium", "firefox", "webkit"]) {
  const result = spawnSync(
    process.execPath,
    [npmCli, "run", `test:e2e:${engine}`, "--", ...forwardedArguments],
    {
      env: process.env,
      stdio: "inherit",
    },
  );

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
