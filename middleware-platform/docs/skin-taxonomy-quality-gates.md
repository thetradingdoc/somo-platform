# Skin Taxonomy Quality Gates

## Offline gates
- Agreement (core skin type): >= 0.90 on adjudicated set.
- Condition multi-label F1: >= 0.85.
- Pigment risk precision (high): >= 0.85.
- False emergency escalation from skin-only inputs: <= 1%.

## Online gates
- `step1.skin_type.unknown` rate <= 25% after week 2.
- `step1.skin_type.conflict_blocked.count` stable (no sudden spikes).
- No increase in unsafe recommendation incidents.

## Rollout plan
1. Shadow mode: compute only, no behavior change.
2. 10% traffic with rollback switch.
3. 50% traffic when online gates green for 72h.
4. 100% traffic after one full weekly cycle.

## Rollback switches
- `SKIN_MAP_TAXONOMY_V1=0` disables full module.
- `SKIN_TYPE_CONFIRMATION_REQUIRED=0` disables confirm prompts.
- `SKIN_CONDITION_ROUTING_ENABLED=0` disables condition steering.
