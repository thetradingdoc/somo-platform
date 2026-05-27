# RCM (Revenue Cycle Management)

This folder documents the **operational billing loop** that sits between medical coding and money movement:

- Eligibility and benefits verification (X12 270/271 via Stedi)
- Prior authorization (case-level workflow: detect → request → decision → auth number on claim)
- Claims submission and claim status (X12 837 + 276/277)
- Remittance/EOB interpretation and claim outcomes

## Read in this order

1. Prior authorization (canonical): [`PA_ARCHITECTURE.md`](./PA_ARCHITECTURE.md)
2. Stedi workstream and runbook: [`STEDI_PA_WORKSTREAM.md`](./STEDI_PA_WORKSTREAM.md)

## Related docs (do not duplicate)

- Medical coding (retrieval + confidence): [`docs/Medical Coding/ARCHITECTURE.md`](../Medical%20Coding/ARCHITECTURE.md)
- Payor entity resolution and plan search: [`docs/Payor/README.md`](../Payor/README.md)
- Integrations overview (Stedi vs UHC FHIR): [`docs/integrations/README.md`](../integrations/README.md)
- Consolidated platform architecture: [`docs/architecture/README.md`](../architecture/README.md)

