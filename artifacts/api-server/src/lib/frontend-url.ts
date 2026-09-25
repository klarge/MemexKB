/** Public-facing base URL for SSO metadata and callback URLs. */
export function frontendUrl(
  req: { protocol: string; get: (header: string) => string | undefined },
  configuredBase = process.env.APP_BASE_URL,
): string {
  const base = configuredBase ?? `${req.protocol}://${req.get("host")}`;
  return base.replace(/\/+$/, "");
}