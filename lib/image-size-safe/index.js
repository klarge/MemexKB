"use strict";

const probe = require("probe-image-size");

function imageSize(input) {
  if (!(input instanceof Uint8Array)) {
    throw new TypeError("image-size expects a Uint8Array or Buffer");
  }

  const result = probe.sync(input);
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