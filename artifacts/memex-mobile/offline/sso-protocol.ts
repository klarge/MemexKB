// Custom-scheme interception cannot authenticate another app without the PKCE
// verifier. Never derive server selection or a redirect destination from a link.
export const SSO_CALLBACK = 'memex-mobile://sso-callback';
export function parseSsoCallback(value: string, expectedState: string): string {
  const url = new URL(value);
  if (`${url.protocol}//${url.host}${url.pathname}` !== SSO_CALLBACK ||
      url.username || url.password || url.hash ||
      url.searchParams.getAll('state').length !== 1 ||
      url.searchParams.get('state') !== expectedState ||
      [...url.searchParams.keys()].some(key => !['state', 'code', 'error'].includes(key))) {
    throw new Error('The sign-in callback did not match this request. Please try again.');
  }
  if (url.searchParams.has('error')) throw new Error('The provider could not complete sign-in. Please try again.');
  const code = url.searchParams.get('code');
  if (url.searchParams.getAll('code').length !== 1 || !code || !/^[A-Za-z0-9_-]{43}$/.test(code)) {
    throw new Error('The server returned an invalid sign-in callback.');
  }
  return code;
}

export interface SsoDependencies<User> {
  random: () => Promise<string>;
  challenge: (verifier: string) => Promise<string>;
  start: (challenge: string, state: string) => Promise<string>;
  browser: (ticket: string) => Promise<{ type: string; url?: string }>;
  exchange: (code: string, verifier: string, state: string) => Promise<User>;
  cancel: (ticket: string, verifier: string) => Promise<void>;
  isCurrent: () => boolean;
}

/** Kept independent of Expo to exercise cancellation and account-switch races. */
export async function runSso<User>(dependencies: SsoDependencies<User>): Promise<User | null> {
  const verifier = await dependencies.random();
  const state = await dependencies.random();
  let ticket: string | null = null;
  try {
    ticket = await dependencies.start(await dependencies.challenge(verifier), state);
    if (!dependencies.isCurrent()) return null;
    const result = await dependencies.browser(ticket);
    if (result.type !== 'success' || !dependencies.isCurrent()) return null;
    const code = parseSsoCallback(result.url ?? '', state);
    const user = await dependencies.exchange(code, verifier, state);
    return dependencies.isCurrent() ? user : null;
  } finally {
    if (ticket) await dependencies.cancel(ticket, verifier).catch(() => {});
  }
}
