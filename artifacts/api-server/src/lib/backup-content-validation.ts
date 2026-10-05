import { isContentKind, validateSteps } from "./content-kinds";

type Row = Record<string, unknown>;
type ContentSections = Record<"policySubjects" | "articles" | "articleVersions" | "templates" | "siteSettings", Row[]>;

/** Validate new structured metadata before a full restore can replace any data. */
export function validateBackupContent(data: ContentSections): void {
  const subjects = new Map<number, number | null>();
  for (const row of data.policySubjects) {
    if (!Number.isSafeInteger(row.id) || Number(row.id) <= 0 || subjects.has(Number(row.id)) ||
        typeof row.name !== "string" || !row.name.trim() || row.name.length > 200 ||
        (row.parentId != null && (!Number.isSafeInteger(row.parentId) || Number(row.parentId) <= 0))) {
      throw new Error("Backup contains an invalid policy category.");
    }
    subjects.set(Number(row.id), row.parentId == null ? null : Number(row.parentId));
  }
  const resolved = new Set<number>();
  for (const id of subjects.keys()) {
    const chain = new Set<number>();
    let current: number | null = id;
    while (current !== null && !resolved.has(current)) {
      if (!subjects.has(current)) throw new Error("Backup policy category references a missing parent.");
      if (chain.has(current)) throw new Error("Backup policy categories contain a cycle.");
      chain.add(current);
      current = subjects.get(current)!;
    }
    for (const member of chain) resolved.add(member);
  }

  const articleKinds = new Map<unknown, string>();
  for (const row of data.articles) {
    const kind = row.kind ?? "knowledge";
    if (!isContentKind(kind)) throw new Error("Backup contains an invalid article kind.");
    if (kind !== "knowledge" && (row.isLogEntry || row.projectId != null)) {
      throw new Error("Backup policies and procedures cannot be logs or project documents.");
    }
    if (kind === "policy" && !subjects.has(Number(row.policySubjectId))) {
      throw new Error("Backup policy references a missing category.");
    }
    if (kind === "procedure") validateSteps(row.procedureSteps);
    articleKinds.set(row.id, kind);
  }
  for (const row of data.articleVersions) {
    // History has no kind field. A ZIP overwrite may change Knowledge into a
    // Procedure while retaining earlier versions with no structured steps.
    if (articleKinds.get(row.articleId) === "procedure" && row.procedureSteps != null) {
      if (!Array.isArray(row.procedureSteps)) throw new Error("Backup contains invalid historical procedure steps.");
      if (row.procedureSteps.length) validateSteps(row.procedureSteps);
    }
  }
  const templateKinds = new Map<number, string>();
  for (const row of data.templates) {
    const kind = row.kind ?? "knowledge";
    if (!isContentKind(kind)) throw new Error("Backup contains an invalid template kind.");
    if (kind === "procedure") validateSteps(row.procedureSteps);
    templateKinds.set(Number(row.id), kind);
  }
  for (const row of data.siteSettings) {
    const expected = row.key === "policy_template_id" ? "policy" : row.key === "procedure_template_id" ? "procedure" : null;
    if (expected && row.value && row.value !== "0" && templateKinds.get(Number(row.value)) !== expected) {
      throw new Error("Backup default template is missing or has the wrong content kind.");
    }
  }
}