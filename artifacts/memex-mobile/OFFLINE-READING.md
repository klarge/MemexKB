# Android offline knowledge reading

This milestone is **read-only, one-way downloading**, not two-way sync.
Existing Logs and Tasks features are unchanged.

## Using downloads

1. Connect to your trusted Memex server and sign in. Prefer HTTPS. A deliberately
   selected HTTP server is supported, but HTTP exposes sign-in and content to
   anyone able to observe that network.
2. **Download all** saves accessible knowledge articles, policies, and procedures.
   Opening any of these documents online also saves
   its text and supported Memex-hosted images. **Refresh saved** updates the
   catalog and articles already saved; it does not download every new article.
3. Check each article's status. Partial downloads are not advertised as complete.
   If an image fails, previously saved text remains readable. Retry resumes
   images already downloaded for that exact document.
4. Use **Downloaded**, text search, and tag filters without a connection. Search
   covers saved article bodies and listed titles, not bodies never downloaded.
5. **Remove** and **Clear** delete device copies only. They never delete or edit
   server articles. Internal links open native article screens; a missing saved
   target is explicitly unavailable offline.

Use the content-type filters to browse Knowledge, Policies, or Procedures alongside
the existing Downloaded and tag filters. Procedure steps retain their saved order,
titles, rich-text descriptions, and supported local images; offline search includes
step titles and descriptions. Policy subject IDs are retained, but the web policy
category tree is not reproduced. Procedure execution/project creation is not offered:
this is read-only reference access. Existing downloads without a content type remain
knowledge articles. Reconnect and use Refresh saved to discover policies/procedures,
then Download all (or download individual documents) before going offline.

“Saved offline” means the supported local content is downloaded. External-image
exceptions are stated in the status. The saved date belongs to the actual local
copy; a failed refresh does not advance its date or the last-successful-refresh
timestamp. Known newer server versions are labelled out of date.

## Identity, credentials, and retention

- On Android, the session cookie is held in `expo-secure-store`, not AsyncStorage.
  It is extracted from the login response because native fetch does not reliably
  forward browser-style cookie sessions. The web preview uses browser cookies and
  browser storage; it is **not** evidence of Android Keystore protection.
- Downloads are isolated by normalized server URL **and** user ID. Signing out,
  switching account, or changing server invalidates pending downloads and clears
  the departing identity's private cache. A storage I/O queue prevents a late
  write from recreating data after clearing.
- Native documents/images are in the app-private document directory. The cache
  is not independently encrypted by this app; it relies on Android's application
  sandbox and device encryption. A rooted, compromised, or unlocked device is
  outside this protection. Cloud backup and device-transfer backup are excluded
  by the generated Android manifest and backup rules.
- Offline access lasts **up to seven days after sign-in**, matching the current
  server session duration. Expiry requires signing in again and clears the local
  identity's downloads. Foregrounding the app rechecks the deadline.
- A disconnected device cannot learn that an article was deleted or its access
  revoked. On reconnection/foregrounding, a complete successful authorized list
  reconciles removals. Definitive article 403/404 removes its local copy. Image
  403/404 removes the unavailable image and rechecks the article's permission:
  a missing image alone never deletes authorized text. Cached immutable images
  are permission-checked with HEAD before their bytes are reused;
  confirmed session 401 clears the signed-in identity. Timeouts, 5xx responses,
  incomplete pagination, and changed pagination totals never authorize pruning.
- Only exact Memex image API endpoints on the configured server receive an
  authenticated image request. External image URLs are never fetched. Supported
  raster formats are PNG, JPEG, GIF, and WebP, with a 10 MiB per-image limit.
- Older per-user cached text is migrated only alongside its existing server and
  signed-in identity. It is labelled partial until images are downloaded.

## Reader compatibility

| Content | Native offline behavior |
| --- | --- |
| Headings, paragraphs, bold/italic/underline/strikethrough | Rendered as native text |
| Ordered/unordered lists, quotes | Rendered; visual typography follows the native theme |
| Code and preformatted text | Native monospace text, not an executable editor |
| Tables | Native horizontally scrolling rows/cells; HTML rowspan/colspan sizing and interactive content inside cells are not supported |
| Infoboxes | Title, plain-text fields, and downloaded image; fields use the native table presentation |
| Manual sources/citations | Saved text and anchors; source links are not fetched or opened as external websites |
| Same-server KB links and wikilinks | Native navigation; missing downloads explicitly unavailable offline |
| Policies and procedures | Native read-only documents, type filters, offline search, and links across all three content types |
| Procedure steps | Ordered step headings and rich-text descriptions, downloaded images, and links; no execution or editing |
| Heading/source fragment links | Scroll to the containing top-level block, not an exact text-line position |
| Memex images and static diagram previews | Downloaded local raster images; no diagram editor or editable XML |
| External images/sites | Explicit unavailable notice; no claim of offline website access |
| Video/audio/embeds/form controls | Explicit read-only/unsupported placeholder |
| Web-only layout CSS, nested tables, interactive widgets | Not a pixel-identical web layout; no whole-site WebView |

## Standalone APK and verification

Use **Build Android APK** in GitHub Actions. It runs `assembleRelease` so the JS/
Hermes bundle, fonts, and application assets are embedded and Metro is disabled.
The generated Expo project's public debug signing key is intentionally used for
this **testing** variant, not production distribution. Do not publish it to the
Play Store or treat that public certificate as production signing.

The artifact is `memex-android-standalone-test-<run number>`. The action checks
that the APK contains its bundle/fonts, runs the offline engine regression suite,
and installs it on an Android emulator with no Metro. An isolated, synthetic
fixture server supplies knowledge articles, a policy, a procedure with steps, and
protected images. The smoke check
downloads them, force-stops the app, disables networking, relaunches, checks
native reading/cross-type links, procedure-step search, and removes a local copy. Screenshots/logs are
uploaded separately. No production or development database is modified.

Local regression command:

```
pnpm --filter @workspace/memex-mobile run typecheck
pnpm --filter @workspace/api-server exec tsx --test ../memex-mobile/test/offline.test.ts
```

An Android JS export and generated-project inspection do not prove that an APK
installs or renders on a device. The GitHub emulator job must pass before claiming
device-level verification.
