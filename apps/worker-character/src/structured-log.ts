interface CharacterWorkerLogEntry {
  level: string;
  message: string;
  context?: Record<string, unknown>;
}

export function writeCharacterWorkerLog({
  level,
  message,
  context,
}: CharacterWorkerLogEntry): void {
  process.stdout.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      service: "motionprep-worker-character",
      message,
      context,
    })}\n`,
  );
}
