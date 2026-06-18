# RCM (Revenue Cycle Management)

This folder documents the **operational billing loop** that sits between medical coding and money movement:

- Eligibility and benefits verification (X12 270/271 via Stedi)
- Prior authorization (case-level workflow: detect → request → decision → auth number on claim)
- Claims submission and claim status (X12 837 + 276/277)
- Remittance/EOB interpretation and claim outcomes

## Read in this order

1. Kelly RCM architecture (provider identity + journey backbone): [`KELLY_RCM_ARCHITECTURE.md`](./KELLY_RCM_ARCHITECTURE.md)
2. Prior authorization (canonical): [`PA_ARCHITECTURE.md`](./PA_ARCHITECTURE.md)
3. Stedi workstream and runbook: [`STEDI_PA_WORKSTREAM.md`](./STEDI_PA_WORKSTREAM.md)
4. Execution backlog: [`../../todos/PENDING.md`](../../todos/PENDING.md)

## Voice and production operations (Kelly telephony)

Kelly voice behavior on production is documented separately from RCM billing stages:

| Doc | Purpose |
|-----|---------|
| [`docs/deployment/VOICE_CURRENT_ARCHITECTURE.md`](../deployment/VOICE_CURRENT_ARCHITECTURE.md) | Inbound/outbound paths, endpoints, smoke tests |
| [`docs/runbooks/GCP_DEPLOY_ROLLBACK_RUNBOOK.md`](../runbooks/GCP_DEPLOY_ROLLBACK_RUNBOOK.md) | Cloud Run deploy, rollback, voice/429 troubleshooting |
| [`docs/deployment/retell-agent-inventory.md`](../deployment/retell-agent-inventory.md) | Retell agent verify inventory (`retell-agent-inventory.json`) |

## Related docs (do not duplicate)

- Medical coding (retrieval + confidence): [`docs/Medical Coding/ARCHITECTURE.md`](../Medical%20Coding/ARCHITECTURE.md)
- Payor entity resolution and plan search: [`docs/Payor/README.md`](../Payor/README.md)
- Integrations overview (Stedi vs UHC FHIR): [`docs/integrations/README.md`](../integrations/README.md)
- Consolidated platform architecture: [`docs/architecture/README.md`](../architecture/README.md)

