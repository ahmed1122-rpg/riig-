export function databaseUrlRequiresTls(value: string): boolean {
  const url = new URL(value);
  const sslMode = url.searchParams.get("sslmode")?.toLowerCase();
  return (
    ["postgresql:", "postgres:"].includes(url.protocol) &&
    ["require", "verify-ca", "verify-full"].includes(sslMode ?? "")
  );
}
