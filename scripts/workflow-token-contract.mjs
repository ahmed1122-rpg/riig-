export function requireWorkflowTokens(
  violations,
  source,
  label,
  tokens,
) {
  for (const token of tokens) {
    if (!source.includes(token)) {
      violations.push(`${label} workflow is missing token: ${token}`);
    }
  }
}
