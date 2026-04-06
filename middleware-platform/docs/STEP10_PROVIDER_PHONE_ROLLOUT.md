# Provider phone surfacing — rollout checklist

Before enabling directory phones in chat or voice:

1. **Source of truth**: Confirm numbers come only from `provider_profiles` (or equivalent verified directory), not from model text.
2. **Trust field**: UI and TTS must respect `phone_trust === 'verified_directory'` before `tel:` links or reading digits aloud.
3. **Privacy**: Log and trace payloads must redact phone values outside approved flows (see `redaction-service`).
4. **Clinical / legal**: Obtain clinic policy sign-off for displaying or speaking clinic directory numbers to patients; document consent and opt-out if required in your jurisdiction.

The checkout chat client shows a **Call** button only when `phone_trust` is `verified_directory` and a phone is present; otherwise it prompts users to use the clinic’s main number or booking flow.
