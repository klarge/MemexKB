import assert from "node:assert/strict";
import { test } from "node:test";
import { frontendUrl } from "../src/lib/frontend-url";

const request = {
  protocol: "https",
  get: (header: string) => header === "host" ? "wiki.example.com" : undefined,
};

test("SSO metadata and callback URLs use a single slash before the API path", () => {
  for (const configuredBase of ["https://wiki.example.com/", "https://wiki.example.com"]) {
    const base = frontendUrl(request, configuredBase);
    assert.equal(base, "https://wiki.example.com");
    assert.equal(`${base}/api/auth/saml/1/callback`, "https://wiki.example.com/api/auth/saml/1/callback");
  }

  const previousBase = process.env.APP_BASE_URL;
  delete process.env.APP_BASE_URL;
  try {
    assert.equal(frontendUrl(request), "https://wiki.example.com");
  } finally {
    if (previousBase === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = previousBase;
  }
});