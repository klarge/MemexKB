import assert from "node:assert/strict";
import test from "node:test";
import { AUTOSAVE_CHECKPOINT_MS, versionAction, type LatestVersion, type VersionContent } from "../src/lib/article-version-policy";

const now = new Date("2026-10-14T10:00:00Z");
const content: VersionContent = {
  title: "Article", content: "<p>First</p>", policySubjectId: null, procedureSteps: [],
};
const latest: LatestVersion = { ...content, createdById: 1, autosaveStartedAt: now };
const changed = { ...content, content: "<p>Second</p>" };
const after = (ms: number) => new Date(now.getTime() + ms);

test("first autosave and legacy/manual snapshots create independent checkpoints", () => {
  assert.equal(versionAction(undefined, content, 1, "autosave", now), "insert");
  assert.equal(versionAction({ ...latest, autosaveStartedAt: null }, changed, 1, "autosave", now), "insert");
});
test("same editor autosaves coalesce strictly within an absolute five-minute window", () => {
  assert.equal(versionAction(latest, changed, 1, "autosave", after(3000)), "replace");
  assert.equal(versionAction(latest, changed, 1, "autosave", after(AUTOSAVE_CHECKPOINT_MS - 1)), "replace");
  assert.equal(versionAction(latest, changed, 1, "autosave", after(AUTOSAVE_CHECKPOINT_MS)), "insert");
  assert.equal(versionAction(latest, changed, 1, "autosave", after(-1)), "insert");
});
test("editor changes preserve independent versions even when content matches", () => {
  assert.equal(versionAction(latest, changed, 2, "autosave", after(3000)), "insert");
  assert.equal(versionAction(latest, content, 2, "autosave", after(3000)), "insert");
});
test("manual saves preserve changed snapshots and seal unchanged autosaves", () => {
  assert.equal(versionAction(latest, changed, 1, "manual", after(3000)), "insert");
  assert.equal(versionAction(latest, content, 1, "manual", after(3000)), "seal");
  assert.equal(versionAction({ ...latest, autosaveStartedAt: null }, content, 1, "manual", after(3000)), "skip");
});
test("identical autosaves are skipped even after the checkpoint window", () => {
  assert.equal(versionAction(latest, content, 1, "autosave", after(3000)), "skip");
  assert.equal(versionAction(latest, content, 1, "autosave", after(AUTOSAVE_CHECKPOINT_MS)), "skip");
});
test("restores always keep an independent fixed checkpoint", () => {
  assert.equal(versionAction(latest, content, 1, "restore", after(3000)), "insert");
});
test("titles, policy subjects, ordered procedure titles and bodies are snapshot content", () => {
  for (const next of [
    { ...content, title: "Renamed" },
    { ...content, policySubjectId: 5 },
    { ...content, procedureSteps: [{ title: "Step", description: "<p>Do it</p>" }] },
  ]) assert.equal(versionAction(latest, next, 1, "autosave", after(3000)), "replace");
  const steps = [{ title: "A", description: "First" }, { title: "B", description: "Second" }];
  const procedure = { ...latest, procedureSteps: steps };
  assert.equal(versionAction(procedure, { ...content, procedureSteps: [...steps].reverse() }, 1, "autosave", after(3000)), "replace");
  assert.equal(versionAction(procedure, { ...content, procedureSteps: steps.map(s => ({ description: s.description, title: s.title })) }, 1, "autosave", after(3000)), "skip");
});
