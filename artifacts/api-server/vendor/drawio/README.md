# Bundled draw.io editor

The editor is **draw.io v32.4.1**, from
https://github.com/jgraph/drawio/releases/tag/v32.4.1.
The original `draw.war` is stored as `drawio-32.4.1.war`.
SHA-256: `b83663313ccdecef6581476a7eaa96750bccf1bfdc3768981eb5d95e94be7820`.

`build-diagram-editor.mjs` verifies that archive, extracts only static assets to
the API's build output, and replaces **js/PreConfig.js** with our offline
configuration. No build or normal editing/export downloads anything. The API
serves these files at `/api/diagram-editor/`; Docker already copies the entire
API `dist` directory, so the runtime needs neither Java nor an export service.
No database migration is needed.

## Licensing and notices

Core draw.io code is Apache 2.0; see `LICENSE`. Original copyright headers and
licenses inside the JS, image, shape and stencil directories remain intact.
The upstream `UPSTREAM-README.md` records applicable third-party/icon terms,
including the restriction on distributing certain visual assets through
Atlassian products or the Atlassian marketplace/plugin ecosystem.
`LIBAVOID-LICENSE` also preserves the routing library's applicable LGPL notice;
its unmodified upstream files and license are retained in the static bundle.
Templates, plugins, service workers, cloud authentication pages and Java
servlets are not packaged into the served editor.

The archive remains unmodified. Only PreConfig is modified in the extracted
bundle, with a modification notice at the top of that file.

## Integration and security

The frame has `sandbox="allow-scripts allow-downloads"` and **does not** have
`allow-same-origin`, popups, top navigation, forms or worker permissions.
The API sets its own matching sandbox policy, blocks framing external sites,
and limits the frame's connections to the static editor directory. Its static
files permit anonymous CORS so the opaque-origin frame can read its own assets;
application API endpoints do not receive this permission.
Frame ancestors are limited to this origin and Replit's workspace UI; allowing
that extra ancestor is necessary when the app itself is inside Preview.

Cloud integrations, remote export/proxy services, plugins and custom libraries
are disabled. Remote image/font requests are blocked, not silently proxied.
Messages must originate from the exact mounted frame's window and have origin
`null`; exports are matched to a request ID and have strict payload limits.
There is no hosted-editor fallback.

A PNG containing draw.io's `mxfile` metadata is the authoritative attachment.
Every edit uploads a **new** PNG; previous files remain available to article
history. Both PNG and `.drawio` downloads come from these bytes, not from a
separate mutable source record. The preview is an ordinary raster image in the
reader and PDF. Markdown retains the image's diagram marker as raw HTML; ZIP
exports retain raw HTML and image bytes, and encrypted backups retain the
complete image records. Article permissions protect the image and its source.

Limits: PNG 10 MB; editable source 2 MB (including expanded compressed pages);
diagram dimensions 8192 px per side and 16 million pixels total.
The frame is non-interactive during export/upload so changes cannot race the
saved snapshot; uploads time out with the current diagram still recoverable.
Procedure-step descriptions currently use plain text, not this WYSIWYG.
Mobile diagram authoring is not included.

## Updating the pinned editor

1. Download the official release archive and independently verify its origin
   and checksum. Replace the vendored archive and update the version/hash in
   `build-diagram-editor.mjs`. Do not replace it with a hosted URL.
2. Refresh the upstream license/README and applicable third-party notices from
   that exact tag; review any licensing or integration changes.
3. Build the API and frontend. The changed hash replaces extracted assets.
4. Run diagram PNG/attachment/export tests. In the real opaque-origin frame,
   verify configure/load, creating shapes, XML PNG export, reloading/reopening,
   edit replacement, both downloads, cancellation and a failed upload retry.
   Check network activity: normal editor use must remain on this host.
5. Check reader/PDF rendering and isolated backup/export/import round trips.
   Never test a destructive restore against the working database.
