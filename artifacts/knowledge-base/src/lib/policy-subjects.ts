import type { PolicySubject } from "@workspace/api-client-react";

export interface SubjectNode {
  subject: PolicySubject;
  depth: number;
  path: PolicySubject[];
}

/** Depth-first flattening of the subject tree, siblings sorted by name. */
export function flattenSubjects(subjects: PolicySubject[]): SubjectNode[] {
  const byParent = new Map<number | null, PolicySubject[]>();
  const ids = new Set(subjects.map((s) => s.id));
  for (const s of subjects) {
    const key = s.parentId !== null && ids.has(s.parentId) ? s.parentId : null;
    const list = byParent.get(key) ?? [];
    list.push(s);
    byParent.set(key, list);
  }
  const out: SubjectNode[] = [];
  const visit = (parent: number | null, path: PolicySubject[]) => {
    const list = (byParent.get(parent) ?? []).slice().sort((a, b) => a.name.localeCompare(b.name));
    for (const s of list) {
      const next = [...path, s];
      out.push({ subject: s, depth: path.length, path: next });
      visit(s.id, next);
    }
  };
  visit(null, []);
  return out;
}

export function subjectPath(subjects: PolicySubject[], id: number | null | undefined): PolicySubject[] {
  if (id == null) return [];
  return flattenSubjects(subjects).find((n) => n.subject.id === id)?.path ?? [];
}

export function descendantIds(subjects: PolicySubject[], id: number): Set<number> {
  const out = new Set<number>([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const s of subjects) {
      if (s.parentId !== null && out.has(s.parentId) && !out.has(s.id)) {
        out.add(s.id);
        changed = true;
      }
    }
  }
  return out;
}
