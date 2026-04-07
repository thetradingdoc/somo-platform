# Vision UV R&D (separate track)

**Last Updated:** April 8, 2026

UV-assisted skin imaging is a separate R&D stream from current RGB capture guidance.

## Why separate

- Standard webcams filter UV/IR; RGB feeds do not provide true UV reflectance/fluorescence.
- Software-only changes are insufficient for clinically meaningful UV interpretation.
- UV must not block current ROI/quality capture rollout.

## Required components

- Hardware: UV-capable illumination + compatible sensor/camera pipeline.
- Capture protocol: fixed distance/angle, exposure controls, ambient light constraints.
- Calibration: per-device normalization, reference targets, repeatability checks.
- Safety: patient instructions for UV exposure handling and contraindications.

## Validation gates before rollout

- Region capture repeatability benchmark (same site, multiple captures).
- Inter-device consistency analysis.
- Clinician agreement study on UV-derived features.
- Bias/performance checks across skin tones and lighting environments.

## Scope boundaries (current production)

- Current production uses RGB capture guidance and provider handoff support.
- CV outputs remain assistive (non-diagnostic) and clinician-reviewed.
- UV remains **R&D only** until hardware + validation milestones are complete.
