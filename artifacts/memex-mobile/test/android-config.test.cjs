const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');

test('offline Android plugin resolves through declared Expo and registers native mods', () => {
  const plugin = require('../plugins/withOfflineAndroid.cjs');
  const config = plugin({ name: 'Native config regression', slug: 'native-config-regression' });
  assert.equal(typeof config.mods.android.manifest, 'function');
  assert.equal(typeof config.mods.android.dangerous, 'function');
});

test('production expo-constants config generation succeeds before native compilation', () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'memex-native-config-'));
  try {
    const constantsRoot = path.dirname(require.resolve('expo-constants/package.json'));
    const script = path.join(constantsRoot, 'scripts/getAppConfig.js');
    // Reproduce the same config-loading subprocess used by createExpoConfig.
    const result = spawnSync(process.execPath, [script, projectRoot, output], {
      cwd: projectRoot,
      env: { ...process.env, NODE_ENV: 'production' },
      encoding: 'utf8',
      timeout: 60_000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr || 'Native config generation failed');
    const actual = JSON.parse(fs.readFileSync(path.join(output, 'app.config'), 'utf8'));
    const expected = require('../app.json').expo;
    assert.equal(actual.name, expected.name);
    assert.equal(actual.android.package, expected.android.package);
  } finally {
    fs.rmSync(output, { recursive: true, force: true });
  }
});
