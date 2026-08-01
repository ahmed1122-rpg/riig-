const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

export interface CookieMutationOriginInput {
  method: string;
  hasSessionCookie: boolean;
  origin?: string;
  referer?: string;
  allowedOrigins: ReadonlySet<string>;
  requireOrigin: boolean;
}

export function isCookieMutationOriginAllowed(
  input: CookieMutationOriginInput,
): boolean {
  if (safeMethods.has(input.method.toUpperCase()) || !input.hasSessionCookie) {
    return true;
  }

  const candidate = input.origin ?? originFromReferer(input.referer);
  if (!candidate) return !input.requireOrigin;

  try {
    return input.allowedOrigins.has(new URL(candidate).origin);
  } catch {
    return false;
  }
}

function originFromReferer(referer?: string): string | undefined {
  if (!referer) return undefined;
  try {
    return new URL(referer).origin;
  } catch {
    return undefined;
  }
}
