import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

test("the form resolver accepts valid Zod 4 credentials and maps invalid fields to form errors", async () => {
  const schema = z.object({ email: z.string().email(), password: z.string().min(1) });
  const resolve = zodResolver(schema);
  const options = { fields: {}, shouldUseNativeValidation: false };
  const credentials = { email: "user@example.test", password: "test-password" };
  const valid = await resolve(credentials, {}, options);
  assert.deepEqual(valid.values, credentials);
  assert.deepEqual(valid.errors, {});
  const invalid = await resolve({ email: "invalid", password: "" }, {}, options);
  assert.deepEqual(invalid.values, {});
  assert.ok(invalid.errors.email?.message);
  assert.ok(invalid.errors.password?.message);
});

test("Zod 4 cross-field password errors reach the confirmation field", async () => {
  const schema = z.object({
    currentPassword: z.string().min(1), newPassword: z.string().min(8), confirmPassword: z.string(),
  }).refine(value => value.newPassword === value.confirmPassword, {
    message: "Passwords don't match", path: ["confirmPassword"],
  });
  const result = await zodResolver(schema)({
    currentPassword: "old-password", newPassword: "new-password", confirmPassword: "different-password",
  }, {}, { fields: {}, shouldUseNativeValidation: false });
  assert.equal(result.errors.confirmPassword?.message, "Passwords don't match");
});
