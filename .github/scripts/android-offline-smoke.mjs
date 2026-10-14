import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const apk = process.argv[2];
if (!apk) throw new Error('Pass the standalone testing APK path.');
const evidence = '/tmp/memex-android-evidence';
mkdirSync(evidence, { recursive: true });
const adb = (...args) => execFileSync('adb', args, { encoding: 'utf8', timeout: 30_000 });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const xml = () => {
  adb('shell', 'uiautomator', 'dump', '/sdcard/memex-ui.xml');
  return adb('shell', 'cat', '/sdcard/memex-ui.xml');
};
const attr = (node, name) => new RegExp(`${name}="([^"]*)"`).exec(node)?.[1] ?? '';
async function find(value, attribute = 'text', timeout = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const document = xml();
    for (const node of document.match(/<node\b[^>]*>/g) ?? []) {
      const field = attr(node, attribute);
      if (field === value || (attribute === 'resource-id' && field.endsWith(`/${value}`))) return node;
    }
    await sleep(1000);
  }
  throw new Error(`Native UI did not show ${attribute}=${value}.`);
}
async function tap(value, attribute = 'text') {
  const node = await find(value, attribute);
  const bounds = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(attr(node, 'bounds'));
  if (!bounds) throw new Error(`Missing tap bounds for ${value}`);
  adb('shell', 'input', 'tap', String(Math.round((Number(bounds[1]) + Number(bounds[3])) / 2)), String(Math.round((Number(bounds[2]) + Number(bounds[4])) / 2)));
  await sleep(600);
}
async function type(id, value) {
  await tap(id, 'resource-id');
  adb('shell', 'input', 'keycombination', '113', '29'); // Ctrl+A
  adb('shell', 'input', 'keyevent', '67');
  if (value) adb('shell', 'input', 'text', value);
  adb('shell', 'input', 'keyevent', '4'); // Dismiss keyboard.
}
function launch() { adb('shell', 'monkey', '-p', 'com.memex.mobile', '-c', 'android.intent.category.LAUNCHER', '1'); }
function screenshot(name) {
  const bytes = execFileSync('adb', ['exec-out', 'screencap', '-p']);
  writeFileSync(`${evidence}/${name}.png`, bytes);
}
try {
  adb('install', '-r', apk);
  adb('reverse', 'tcp:8083', 'tcp:8083');
  adb('shell', 'pm', 'clear', 'com.memex.mobile');
  launch(); // No Metro process exists on this runner.
  await find('server-url', 'resource-id');
  screenshot('standalone-cold-start');
  // Server input defaults to http://; clear it robustly with Ctrl+A.
  await tap('server-url', 'resource-id');
  adb('shell', 'input', 'keycombination', '113', '29');
  adb('shell', 'input', 'keyevent', '67');
  adb('shell', 'input', 'text', 'http://127.0.0.1:8083');
  adb('shell', 'input', 'keyevent', '4');
  await tap('connect-button', 'resource-id');
  await type('login-email', 'reader@example.test');
  await type('login-password', 'offline-fixture');
  await tap('sign-in-button', 'resource-id');
  await find('article-offline-field-guide', 'resource-id');
  await tap('Download all articles', 'content-desc');
  await find('Saved offline (1 external image unavailable)');
  await find('Saved offline');
  await sleep(4000);
  screenshot('downloaded');
  adb('shell', 'am', 'force-stop', 'com.memex.mobile');
  adb('reverse', '--remove', 'tcp:8083');
  adb('shell', 'cmd', 'connectivity', 'airplane-mode', 'enable');
  adb('shell', 'svc', 'wifi', 'disable');
  launch();
  await find('article-offline-field-guide', 'resource-id');
  await tap('kind-policy', 'resource-id');
  await find('article-safety-policy', 'resource-id');
  await tap('article-safety-policy', 'resource-id');
  await find('POLICY_OFFLINE_BODY');
  screenshot('offline-policy');
  await tap('Safety Procedure');
  await find('PROCEDURE_OFFLINE_BODY');
  await find('1. Inspect equipment');
  await find('PROCEDURE_STEP_SEARCH_TOKEN');
  screenshot('offline-procedure');
  await tap('Safety Policy');
  await find('POLICY_OFFLINE_BODY');
  // Return through native history to the filtered list.
  for (let i = 0; i < 3; i++) {
    adb('shell', 'input', 'keyevent', '4');
    await sleep(600);
  }
  await tap('kind-procedure', 'resource-id');
  await type('article-search', 'PROCEDURE_STEP_SEARCH_TOKEN');
  await find('article-safety-procedure', 'resource-id');
  screenshot('offline-procedure-search');
  await type('article-search', '');
  await tap('kind-knowledge', 'resource-id');
  await type('article-search', 'FIELD_GUIDE_OFFLINE_BODY');
  await find('article-offline-field-guide', 'resource-id');
  if (xml().includes('article-linked-reference')) throw new Error('Offline body search did not filter out the unrelated article.');
  screenshot('offline-body-search');
  await type('article-search', '');
  await tap('article-offline-field-guide', 'resource-id');
  await find('FIELD_GUIDE_OFFLINE_BODY');
  screenshot('offline-article');
  await tap('Linked Reference');
  await find('LINKED_REFERENCE_OFFLINE_BODY');
  screenshot('offline-internal-link');
  // Prove local removal doesn't need a server and removes the saved body.
  await tap('reader-remove', 'resource-id');
  await tap('button1', 'resource-id'); // Native confirmation dialog.
  await find('Not downloaded');
  screenshot('removed-local-copy');
  console.log('PASS: native standalone startup, cold airplane-mode KB/policy/procedure reading, step search, internal links and local removal.');
} catch (error) {
  screenshot('failure');
  writeFileSync(`${evidence}/logcat.txt`, adb('logcat', '-d'));
  writeFileSync(`${evidence}/ui.xml`, xml());
  throw error;
} finally {
  adb('shell', 'cmd', 'connectivity', 'airplane-mode', 'disable');
}
