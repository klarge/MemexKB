import { convert } from "html-to-text";
import { sanitizeArticleHtml } from "./sanitize";
import type { ContentKind, ProcedureStep } from "@workspace/db";

export const contentKinds = ["knowledge", "policy", "procedure"] as const;
export function isContentKind(value: unknown): value is ContentKind {
  return contentKinds.includes(value as ContentKind);
}
export function validateSteps(value: unknown): ProcedureStep[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw new Error("A procedure requires between 1 and 100 steps");
  }
  return value.map((step) => {
    if (!step || typeof step.title !== "string" || typeof step.description !== "string" ||
        !step.title.trim() || !convert(step.description).trim() ||
        step.title.length > 500 || step.description.length > 100_000) {
      throw new Error("Each step requires a title and description (maximum 500 and 100,000 characters)");
    }
    return { title: step.title.trim(), description: sanitizeArticleHtml(step.description) };
  });
}
export function contentWithSteps(article: { content: string; procedureSteps?: ProcedureStep[] }): string {
  const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return article.content + (article.procedureSteps?.length
    ? `<h2>Steps</h2><ol>${article.procedureSteps.map((s) => `<li><h3>${escape(s.title)}</h3>${s.description}</li>`).join("")}</ol>`
    : "");
}