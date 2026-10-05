import test from "node:test";
import assert from "node:assert/strict";
import { validateBackupContent } from "../src/lib/backup-content-validation";

const base = () => ({
  policySubjects: [{ id: 1, name: "Operations", parentId: null }, { id: 2, name: "Safety", parentId: 1 }],
  articles: [{ id: 1, kind: "policy", policySubjectId: 2 }],
  articleVersions: [],
  templates: [{ id: 1, kind: "policy" }],
  siteSettings: [{ key: "policy_template_id", value: "1" }],
});
test("backup metadata retains nested categories and accepts older Knowledge defaults", () => {
  validateBackupContent(base());
  validateBackupContent({ policySubjects: [], articles: [{ id: 1 }], articleVersions: [], templates: [{ id: 1 }], siteSettings: [] });
});
test("backup rejects cycles and policies without a category before replacement", () => {
  const cyclic = base();
  cyclic.policySubjects[0].parentId = 2;
  assert.throws(() => validateBackupContent(cyclic), /cycle/);
  const missing = base();
  missing.articles[0].policySubjectId = 99;
  assert.throws(() => validateBackupContent(missing), /missing category/);
});
test("backup rejects malformed procedures and wrong-type default templates", () => {
  assert.throws(() => validateBackupContent({ ...base(), articles: [{ id: 1, kind: "procedure", procedureSteps: [] }] }), /procedure requires/);
  const wrong = base();
  wrong.templates[0].kind = "knowledge";
  assert.throws(() => validateBackupContent(wrong), /wrong content kind/);
});
test("procedure history may predate structured steps but malformed history is rejected", () => {
  const data = {
    ...base(),
    articles: [{ id: 1, kind: "procedure", procedureSteps: [{ title: "Step", description: "Instructions" }] }],
    articleVersions: [{ articleId: 1, procedureSteps: [] }],
  };
  validateBackupContent(data);
  assert.throws(() => validateBackupContent({ ...data, articleVersions: [{ articleId: 1, procedureSteps: "invalid" }] }), /historical/);
});