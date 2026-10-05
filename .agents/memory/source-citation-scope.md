---
name: Manual source citations
description: Why source URL validation stays format-only rather than fetching remote content.
---

Source citations use manually supplied descriptions and HTTP/HTTPS URLs. Do not fetch or crawl a citation URL just to validate it or generate its description.

**Why:** The approved citation feature excludes automatic discovery and remote fetching. Sources can be behind access restrictions or reachable only from the author's network, and server-side URL fetching would introduce an unnecessary SSRF risk.

**How to apply:** Keep citation URL validation format-only when extending the shared editor or its server sanitization. Any future source discovery or preview fetching needs its own explicit scope and security design.