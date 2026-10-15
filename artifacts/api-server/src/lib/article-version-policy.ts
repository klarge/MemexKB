export const AUTOSAVE_CHECKPOINT_MS = 5 * 60 * 1000;

export interface VersionContent {
  title: string;
  content: string;
  policySubjectId: number | null;
  procedureSteps: { title: string; description: string }[];
}

export interface LatestVersion extends VersionContent {
  createdById: number | null;
  autosaveStartedAt: Date | null;
}

export type VersionMode = "autosave" | "manual" | "restore";

/** An absolute window, not a sliding one: continuous editing still keeps checkpoints. */
export function versionAction(
  latest: LatestVersion | undefined,
  next: VersionContent,
  editorId: number | null,
  mode: VersionMode,
  now: Date,
): "insert" | "replace" | "seal" | "skip" {
  if (!latest || mode === "restore" || latest.createdById !== editorId) return "insert";
  const same = latest.title === next.title && latest.content === next.content &&
    latest.policySubjectId === next.policySubjectId &&
    JSON.stringify(latest.procedureSteps.map(s => [s.title, s.description])) ===
      JSON.stringify(next.procedureSteps.map(s => [s.title, s.description]));
  // An explicit Save fixes the latest autosave even when its content is unchanged.
  if (same) return mode === "manual" && latest.autosaveStartedAt !== null ? "seal" : "skip";
  const start = latest.autosaveStartedAt?.getTime();
  if (mode === "autosave" && start !== undefined &&
    now.getTime() >= start && now.getTime() - start < AUTOSAVE_CHECKPOINT_MS) return "replace";
  return "insert";
}
