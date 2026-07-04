'use client';

/**
 * TrainingStagePill — displays current stage 0-4 + tooltip for next-stage requirement.
 *
 * v1.0 rubric (mirrors studioService.computeTrainingStage):
 *   0 Onboarded    → 1 SkillsAdded  (upload SKILL.md)
 *   1 SkillsAdded  → 2 Evaluated    (run eval within 30 days)
 *   2 Evaluated    → 3 Orchestrator (complete a sub-agent hire)
 *   3 Orchestrator → 4 Dreamed      (approve an auto-dream cycle)
 *   4 Dreamed      → 4              (maxed)
 */

interface StageProgress {
  stage: number;
  stage_name: string;
  progress_to_next: { target_stage: number; target_name: string; requirement: string };
}

interface TrainingStagePillProps {
  stage: number;
  progress?: StageProgress;
  className?: string;
}

const STAGE_STYLES = [
  'bg-surface-container-low text-on-surface-variant border-outline-variant',
  'bg-tertiary/10 text-tertiary border-tertiary/30',
  'bg-primary/10 text-primary border-primary/30',
  'bg-secondary/10 text-secondary border-secondary/30',
  'bg-primary text-on-primary border-primary',
];

const STAGE_LABELS = ['Onboarded', 'SkillsAdded', 'Evaluated', 'Orchestrator', 'Dreamed'];

export function TrainingStagePill({ stage, progress, className }: TrainingStagePillProps): JSX.Element {
  const idx = Math.max(0, Math.min(4, stage));
  const label = STAGE_LABELS[idx];
  const style = STAGE_STYLES[idx];
  const tooltip = progress?.progress_to_next
    ? `Next: Stage ${progress.progress_to_next.target_stage} (${progress.progress_to_next.target_name}). ${progress.progress_to_next.requirement}`
    : `Current stage: ${label}`;
  return (
    <span
      title={tooltip}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${style} ${className ?? ''}`}
    >
      <span className="font-bold">Stage {idx}</span>
      <span>·</span>
      <span>{label}</span>
    </span>
  );
}
