---
name: Mobile auth cookie extraction
description: How the Expo app authenticates with the Memex API server and maintains session state.
---

The Memex API uses express-session with a `connect.sid` cookie. React Native's `fetch` does not manage cookies automatically.

**Rule:** After POST /api/auth/login, read `res.headers.get('set-cookie')`, regex-extract `connect.sid=([^;]+)`, store the value (URL-encoded, as-is) in native protected credential storage, never AsyncStorage, and send it as `Cookie: connect.sid=<value>` on subsequent native requests.

**Why:** The standard browser cookie jar is absent in React Native. Attempting to rely on automatic cookie forwarding silently fails — subsequent API calls return 401. Session credentials need Android Keystore-backed protection, separate from article-cache storage.

**How to apply:** Preserve explicit native cookie forwarding, including image downloads, while keeping the browser preview on its browser cookie jar. Never forward Memex cookies to arbitrary article-supplied image URLs or third-party hosts.
