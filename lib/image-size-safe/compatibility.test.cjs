const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const imageSize = require("./index");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=", "base64");
test("hardened image adapter accepts Metro bytes, cross-realm bytes and Expo local paths", () => {
  assert.equal(imageSize(png).width, 1);
  const crossRealm = vm.runInNewContext("new Uint8Array(bytes)", { bytes: [...png] });
  assert.equal(imageSize(crossRealm).height, 1);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "memex-image-size-"));
  try {
    const file = path.join(directory, "fixture.png");
    fs.writeFileSync(file, png);
    assert.equal(imageSize(file).width, 1);
    assert.throws(() => imageSize(directory), /not a file/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
test("adapter rejects URLs, invalid data and oversized byte arrays without old vulnerable parser", () => {
  assert.throws(() => imageSize("https://external.invalid/image.png"), /local files/);
  assert.throws(() => imageSize({}), /Uint8Array/);
  assert.throws(() => imageSize(Buffer.from("not an image")), /unsupported/);
  assert.throws(() => imageSize(new Uint8Array(24 * 1024 * 1024 + 1)), /too large/);
});
