import { spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputDirectory = join(root, "artifacts", "adobe-golden", "generated");
const image = "motionprep-adobe-golden:local";

await mkdir(outputDirectory, { recursive: true });
run("docker", [
  "build",
  "--target",
  "adobe-golden-generator",
  "--tag",
  image,
  ".",
]);
run("docker", [
  "run",
  "--rm",
  "--env",
  "ADOBE_GOLDEN_OUTPUT_DIRECTORY=/output",
  "--volume",
  `${outputDirectory}:/output`,
  image,
]);

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}.`);
  }
}
