# draw.io third-party notices

## Component and origin

- Component: draw.io editor, version **32.4.1**.
- Upstream project: <https://github.com/jgraph/drawio>.
- Pinned release: <https://github.com/jgraph/drawio/releases/tag/v32.4.1>.
- Vendored archive:
  `artifacts/api-server/vendor/drawio/drawio-32.4.1.war`.

The original archive remains unmodified. The packaging script extracts static
editor assets and replaces `js/PreConfig.js` with the application's offline,
self-hosted configuration. The replacement carries a modification notice;
original copyright and license headers in the other assets are retained.

## Editor code: Apache License 2.0

The draw.io editor is third-party software, not relicensed under Memex's MIT
license. Its original copyright notices remain in the bundled files.
The complete upstream Apache 2.0 license is preserved in [LICENSE](LICENSE).

## libavoid: GNU Lesser General Public License 2.1

The editor contains libavoid routing code under LGPL 2.1. Its complete license
text is preserved in [LIBAVOID-LICENSE](LIBAVOID-LICENSE), and its original
license file and README remain in the editor's `js/libavoid-js/` directory.

The upstream README identifies the routing bundle's build/source repository as
<https://github.com/jgraph/drawio-libavoid>, using libavoid from
<https://www.adaptagrams.org/>.

Redistributors must assess and satisfy the LGPL's applicable corresponding
source, modification, and relinking requirements for the version they ship.
Merely including this license directory does not establish full LGPL compliance.

## Icons, stencils, and other upstream assets

[UPSTREAM-README.md](UPSTREAM-README.md) is preserved verbatim from the vendored
release and records the upstream asset terms. In particular, certain icons and
stencil libraries cannot be incorporated into or distributed for use with
Atlassian products or through the Atlassian marketplace/plugin ecosystem without
explicit written permission. Upstream states that this restriction does not
apply to end-user diagram output, such as exported images or documents.

Other bundled libraries and assets retain their individual licenses and
copyright notices. This notice does not grant rights beyond those upstream terms.

## Keeping notices current

These license texts and the upstream README are verbatim copies of the files
in `artifacts/api-server/vendor/drawio/`. When upgrading the vendored editor,
update these copies together with the release, review changed licensing terms,
and retain notices embedded in the static assets.
