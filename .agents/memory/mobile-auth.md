---
name: Mobile auth cookie extraction
description: How the Expo app authenticates with the Memex API server and maintains session state.
---

The Memex API uses express-session with a `connect.sid` cookie. React Native's `fetch` does not manage cookies automatically.

**Rule:** After POST /api/auth/login, read `res.headers.get('set-cookie')`, regex-extract `connect.sid=([^;]+)`, store the value (URL-encoded, as-is) in AsyncStorage, and send it as `Cookie: connect.sid=<value>` on every subsequent request.

**Why:** The standard browser cookie jar is absent in React Native. Attempting to rely on automatic cookie forwarding silently fails — all subsequent API calls return 401.

**How to apply:** The `apiFetch` helper in `context/AppContext.tsx` prepends `Cookie: connect.sid=<sessionCookie>` to every request header when `sessionCookie` is set.
