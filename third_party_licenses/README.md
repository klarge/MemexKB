# Third-party licenses

Memex's original code is licensed under the [MIT License](../LICENSE).
That license does not replace the licenses or ownership notices of bundled
third-party code, libraries, images, icons, stencils, or other assets.

## Bundled draw.io editor

See [drawio/README.md](drawio/README.md) for the pinned version, upstream source,
modifications, license texts, and additional asset terms:

- [Apache License 2.0](drawio/LICENSE) — draw.io editor code.
- [GNU Lesser General Public License 2.1](drawio/LIBAVOID-LICENSE) — libavoid.
- [Upstream README and asset terms](drawio/UPSTREAM-README.md) — including the
  restrictions applicable to certain icons and stencil libraries.

These license and notice files are included in the Docker runtime image at
`/app/third_party_licenses`. The editor build also preserves its vendor licenses,
notices, and original asset copyright headers in `dist/diagram-editor`.

This directory documents the bundled draw.io integration; it is not an
exhaustive license inventory of all package dependencies. Other dependencies
retain their own licenses and any applicable notice obligations.
