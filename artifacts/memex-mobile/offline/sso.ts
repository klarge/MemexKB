import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { fromByteArray } from 'base64-js';
import { startMobileSso, exchangeMobileSso, cancelMobileSso } from '@workspace/api-client-react';
import { runSso, SSO_CALLBACK } from './sso-protocol';
import type { AuthUser } from './credentials';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { fetchWithTimeout } from './network';

const base64url = (value: string) => value.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const requestOptions = (server: string) => ({
  baseUrl: server, headers: { 'X-Memex-Client': 'native' }, redirect: 'error' as const,
});
async function bounded<T>(operation: (signal: AbortSignal) => Promise<T>, milliseconds = 15_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), milliseconds);
  try { return await operation(controller.signal); }
  finally { clearTimeout(timer); }
}
export async function revokeNativeSession(server: string, cookie: string) {
  await fetchWithTimeout(`${server}/api/auth/logout`, {
    method: 'POST', headers: { 'X-Memex-Client': 'native', Cookie: `connect.sid=${cookie}` }, redirect: 'error',
  }, 5000).catch(() => {});
}

export async function nativeSso(server: string, providerId: number, isCurrent: () => boolean) {
  // Native credentials must never travel over cleartext, including the code exchange.
  if (new URL(server).protocol !== 'https:') throw new Error('SSO sign-in requires an HTTPS server. Change the server address to its HTTPS URL.');
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
    throw new Error('SSO requires the installed Memex Android app. The custom browser callback is not available in Expo Go.');
  }
  let cookie: string | undefined;
  let completed = false;
  try {
    const user = await runSso<AuthUser>({
    random: async () => base64url(fromByteArray(await Crypto.getRandomBytesAsync(32))),
    challenge: async verifier => base64url(await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, { encoding: Crypto.CryptoEncoding.BASE64 })),
    start: async (challenge, state) => (await bounded(signal => startMobileSso({ providerId, challenge, state }, { ...requestOptions(server), signal }))).ticket,
    browser: async ticket => WebBrowser.openAuthSessionAsync(
      `${server}/api/auth/mobile/browser?ticket=${encodeURIComponent(ticket)}`, SSO_CALLBACK,
      { preferEphemeralSession: true },
    ),
    exchange: async (code, verifier, state) => {
      const identity = await bounded(signal => exchangeMobileSso({ code, verifier, state }, {
        ...requestOptions(server),
        signal,
        onResponse: response => { cookie = /connect\.sid=([^;]+)/.exec(response.headers.get('set-cookie') ?? '')?.[1]; },
      }));
      if (!cookie || !Number.isSafeInteger(identity.id)) throw new Error('The server did not return a valid session.');
      return identity;
    },
    cancel: async (ticket, verifier) => { await bounded(signal => cancelMobileSso({ ticket, verifier }, { ...requestOptions(server), signal }), 5000); },
    isCurrent,
  });
    completed = Boolean(user && cookie);
    return user && cookie ? { user, cookie } : null;
  } finally {
    // A server/account switch after exchange must also revoke the orphan session.
    if (cookie && !completed) void revokeNativeSession(server, cookie);
  }
}
