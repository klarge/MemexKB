import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

export interface StepDraft {
  title: string;
  description: string;
}

export function validateSteps(steps: StepDraft[]): string | null {
  if (steps.length < 1) return "Add at least one step.";
  const bad = steps.findIndex((s) => !s.title.trim() || !s.description.trim());
  if (bad !== -1) return `Step ${bad + 1} needs both a title and a description.`;
  return null;
}

export function cleanSteps(steps: StepDraft[]): StepDraft[] {
  return steps.map((s) => ({ title: s.title.trim(), description: s.description.trim() }));
}

export function ProcedureStepsEditor({
  steps,
  onChange,
  disabled,
}: {
  steps: StepDraft[];
  onChange: (steps: StepDraft[]) => void;
  disabled?: boolean;
}) {
  const update = (i: number, patch: Partial<StepDraft>) =>
    onChange(steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= steps.length) return;
    const next = steps.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <div className="space-y-3" data-testid="procedure-steps-editor">
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-base">Steps</Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            Steps are saved in this order. A project created from this procedure starts with one card per step.
            Use [[slug|label]] to link to other documents.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => onChange([...steps, { title: "", description: "" }])}
          data-testid="button-add-step"
        >
          <Plus className="mr-1 h-4 w-4" /> Add step
        </Button>
      </div>
      {steps.length === 0 && (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          No steps yet. A procedure needs at least one step.
        </div>
      )}
      <ol className="space-y-3">
        {steps.map((step, i) => (
          <li key={i} className="rounded-md border bg-card p-3 space-y-2" data-testid={`step-row-${i}`}>
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center bg-primary text-primary-foreground text-xs font-semibold tabular-nums">
                {i + 1}
              </span>
              <Input
                value={step.title}
                disabled={disabled}
                onChange={(e) => update(i, { title: e.target.value })}
                placeholder="Step title"
                aria-label={`Step ${i + 1} title`}
                data-testid={`input-step-title-${i}`}
              />
              <Button type="button" variant="ghost" size="icon" disabled={disabled || i === 0} onClick={() => move(i, -1)} aria-label="Move step up" data-testid={`button-step-up-${i}`}>
                <ArrowUp className="h-4 w-4" />
              </Button>
              <Button type="button" variant="ghost" size="icon" disabled={disabled || i === steps.length - 1} onClick={() => move(i, 1)} aria-label="Move step down" data-testid={`button-step-down-${i}`}>
                <ArrowDown className="h-4 w-4" />
              </Button>
              <Button type="button" variant="ghost" size="icon" disabled={disabled} onClick={() => onChange(steps.filter((_, idx) => idx !== i))} aria-label="Delete step" data-testid={`button-step-delete-${i}`}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
            <Textarea
              value={step.description}
              disabled={disabled}
              onChange={(e) => update(i, { description: e.target.value })}
              placeholder="What needs to happen in this step?"
              rows={3}
              aria-label={`Step ${i + 1} description`}
              data-testid={`input-step-description-${i}`}
            />
          </li>
        ))}
      </ol>
    </div>
  );
}
