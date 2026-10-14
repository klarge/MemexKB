"use strict";

const probe = require("probe-image-size");
const fs = require("node:fs");

function imageSize(input) {
  // Expo's image tools also use the historical filename overload. Metro's
  // transform workers can pass byte arrays created in a different JS realm.
  // Keep the hardened parser; do not restore the vulnerable image-size parser.
  if (typeof input === "string") {
    if (/^[a-z]+:\/\//i.test(input)) throw new TypeError("image-size accepts local files only");
    const descriptor = fs.openSync(input, "r");
    try {
      const info = fs.fstatSync(descriptor);
      if (!info.isFile() || info.size > 24 * 1024 * 1024) throw new TypeError("image-size input is too large or is not a file");
      input = fs.readFileSync(descriptor);
    } finally { fs.closeSync(descriptor); }
  }
  if (!ArrayBuffer.isView(input) || input.BYTES_PER_ELEMENT !== 1) {
    throw new TypeError("image-size expects a Uint8Array or Buffer");
  }
  if (input.byteLength > 24 * 1024 * 1024) throw new TypeError("image-size input is too large");

  const result = probe.sync(Buffer.from(input.buffer, input.byteOffset, input.byteLength));
  if (!result || !Number.isFinite(result.width) || !Number.isFinite(result.height)) {
    throw new TypeError("unsupported image type");
  }

  return {
    width: result.width,
    height: result.height,
    type: result.type,
    ...(result.orientation === undefined
      ? {}
      : { orientation: result.orientation }),
  };
}

module.exports = imageSize;
module.exports.default = imageSize;
module.exports.imageSize = imageSize;