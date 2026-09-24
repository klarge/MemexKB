---
name: Orval path/query collision
description: Generator edge case when a documented API operation has both path and query parameters.
---

Adding inline query parameters to an existing OpenAPI operation with a path parameter can make the generated Zod path schema and generated types export the same `<Operation>Params` name through the shared barrel, failing library typechecking.

**Why:** Orval generates separate path and query schemas but a combined parameter type with the path schema's export name. This occurred while adding optional pagination to a project-document listing.

**How to apply:** Run code generation and library typechecking after changing API parameter contracts. If the collision occurs, consider separating/renaming generated exports at the generator boundary before expanding the spec; a prose description can document an optional compatibility query without changing generated client types when a narrow fix is needed.