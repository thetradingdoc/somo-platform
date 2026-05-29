import React from 'react';

const PHOTO_STEPS = ['capture', 'analyzing', 'confirm', 'correct'];
const GOAL_STEPS = ['intent'];
const MATCH_STEPS = ['match', 'kellyGate', 'clarify', 'specialistZip'];
const PLAN_STEPS = ['preview', 'specialist', 'dual'];
const SAVE_STEPS = ['save', 'done'];

const CHAPTERS = [
  { id: 'photo', label: 'Photo', steps: PHOTO_STEPS },
  { id: 'goal', label: 'Goal', steps: GOAL_STEPS },
  { id: 'match', label: 'Match', steps: MATCH_STEPS },
  { id: 'plan', label: 'Plan', steps: PLAN_STEPS },
  { id: 'save', label: 'Save', steps: SAVE_STEPS },
];

function chapterState(chapter, step) {
  const idx = chapter.steps.indexOf(step);
  if (idx >= 0) return { active: true, done: false, microIdx: idx };
  const lastStep = chapter.steps[chapter.steps.length - 1];
  const stepOrder = (s) => {
    for (let c = 0; c < CHAPTERS.length; c += 1) {
      const i = CHAPTERS[c].steps.indexOf(s);
      if (i >= 0) return c * 10 + i;
    }
    return -1;
  };
  if (stepOrder(step) > stepOrder(lastStep)) return { active: false, done: true, microIdx: -1 };
  return { active: false, done: false, microIdx: -1 };
}

export default function FunnelStepDots({ step }) {
  return (
    <div
      className="funnel-steps funnel-steps--chapters"
      role="progressbar"
      aria-label="Somo onboarding progress"
    >
      <div className="funnel-step-chapter-row">
        {CHAPTERS.map((chapter, ci) => {
          const { active, done, microIdx } = chapterState(chapter, step);
          const chapterCls = [
            'funnel-step-chapter',
            active ? 'funnel-step-chapter--active' : '',
            done ? 'funnel-step-chapter--done' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <React.Fragment key={chapter.id}>
              {ci > 0 ? <span className="funnel-step-chapter-sep" aria-hidden="true" /> : null}
              <div className={chapterCls}>
                <span className="funnel-step-chapter-label">{chapter.label}</span>
                <div className="funnel-step-chapter-dots" aria-hidden="true">
                  {chapter.steps.map((id, i) => {
                    const dotDone = done || (active && i < microIdx);
                    const dotActive = active && i === microIdx;
                    let cls = 'funnel-step-dot';
                    if (dotDone) cls += ' funnel-step-dot--done';
                    else if (dotActive) cls += ' funnel-step-dot--active';
                    return <span key={id} className={cls} />;
                  })}
                </div>
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
