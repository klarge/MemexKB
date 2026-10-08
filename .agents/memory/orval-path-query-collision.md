---
name: Orval export collisions
description: Duplicate generated Zod barrel exports from combined parameters or externally referenced request schemas.
---

Adding inline query parameters to an existing OpenAPI operation with a path parameter can make the generated Zod path schema and generated types export the same `<Operation>Params` name through the shared barrel, failing library typechecking.

**Why:** Orval generates separate path and query schemas but a combined parameter type with the path schema's export name. This occurred while adding optional pagination to a project-document listing.

**How to apply:** Run code generation and library typechecking after changing API parameter contracts. If the collision occurs, consider separating/renaming generated exports at the generator boundary before expanding the spec; a prose description can document an optional compatibility query without changing generated client types when a narrow fix is needed.

Externally referenced request schemas can also produce duplicate request-body
exports even after their files are allowlisted for resolution. Keeping named
request/response component schemas in the main OpenAPI document avoided that
collision without modifying generated code.

**Why:** External-reference resolution and export-name generation are separate;
allowlisting the file fixed resolution but not the duplicate Zod barrel exports.

**How to apply:** Prefer named local component references when adding request
bodies. Always require code generation's library typecheck to pass; do not
hand-edit generated barrels.