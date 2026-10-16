import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSsoCallback, runSso, type SsoDependencies } from '../offline/sso-protocol';

const state = 's'.repeat(43);
const code = 'c'.repeat(43);
const callback = `memex-mobile://sso-callback?code=${code}&state=${state}`;
test('callback validation works without URLSearchParams iterator helpers', () => {
  const original = Object.getOwnPropertyDescriptor(URLSearchParams.prototype, 'keys')!;
  Object.defineProperty(URLSearchParams.prototype, 'keys', { ...original, value: undefined });
  try {
    assert.equal(parseSsoCallback(callback, state), code);
    assert.throws(() => parseSsoCallback(`${callback}&redirect=https://attacker.example`, state));
    assert.throws(() => parseSsoCallback(`${callback}&%72edirect=https://attacker.example`, state));
  } finally {
    Object.defineProperty(URLSearchParams.prototype, 'keys', original);
  }
});
test('callback accepts only the fixed destination, current state and one valid code', () => {
  assert.equal(parseSsoCallback(callback, state), code);
  for (const link of [
    callback.replace('memex-mobile:', 'https:'),
    callback.replace('sso-callback', 'attacker.example'),
    `${callback}&redirect=https://attacker.example`,
    `${callback}&state=${state}`, `${callback}&code=${code}`, `${callback}#ignored`,
    callback.replace(code, 'invalid'), callback.replace(state, 'x'.repeat(43)),
    `memex-mobile://sso-callback?error=sso_failed&state=${state}`,
  ]) assert.throws(() => parseSsoCallback(link, state));
});

function fixture() {
  const calls: string[] = [];
  let current = true;
  const deps: SsoDependencies<{ id: number }> = {
    random: async () => state, challenge: async () => 'challenge',
    start: async () => { calls.push('start'); return 'ticket'; },
    browser: async () => ({ type: 'success', url: callback }),
    exchange: async () => { calls.push('exchange'); return { id: 2 }; },
    cancel: async () => { calls.push('cancel'); },
    isCurrent: () => current,
  };
  return { deps, calls, switchAccount: () => { current = false; } };
}
test('cancelling the system browser never exchanges or adopts a credential', async () => {
  for (const type of ['cancel', 'dismiss']) {
    const f = fixture();
    f.deps.browser = async () => ({ type });
    assert.equal(await runSso(f.deps), null);
    assert.deepEqual(f.calls, ['start', 'cancel']);
  }
});
test('expired callbacks surface the server error and invalidate pending state', async () => {
  const f = fixture();
  f.deps.exchange = async () => { throw new Error('Sign-in expired'); };
  await assert.rejects(runSso(f.deps), /expired/);
  assert.deepEqual(f.calls, ['start', 'cancel']);
});
test('server/account switches during browser or exchange cannot adopt the old identity', async () => {
  const browser = fixture();
  browser.deps.browser = async () => { browser.switchAccount(); return { type: 'success', url: callback }; };
  assert.equal(await runSso(browser.deps), null);
  assert.deepEqual(browser.calls, ['start', 'cancel']);
  const exchange = fixture();
  exchange.deps.exchange = async () => { exchange.switchAccount(); return { id: 1 }; };
  assert.equal(await runSso(exchange.deps), null);
  assert.deepEqual(exchange.calls, ['start', 'cancel']);
});
test('successful handoff returns only the identity from this exchange and cleans up', async () => {
  const f = fixture();
  assert.deepEqual(await runSso(f.deps), { id: 2 });
  assert.deepEqual(f.calls, ['start', 'exchange', 'cancel']);
});
