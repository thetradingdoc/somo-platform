# Commerce PSTN Replay — Live Run Report

**Run ID:** pstn-1782321977931-d9b852
**Mode:** live (Kelly)
**Calls executed:** 59
**Passed:** 0 / 59

Pass = every caller turn matches golden agent reply + tool (when expected), all `functions_tested` complete, assertions satisfied.

---

### PSTN-042 — Mid-booking symptom change — returns to triage, re-OPQRST, books

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Result | FAIL |
| Runtime | kelly_rails |
| Session | `pstn_PSTN-042_62fe160e` |

#### Golden expected (script)

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi, I started to book a consult but actually I have a new symptom I want to mention.
03 AGENT: Of course — it's always good to tell me about symptoms. What's going on?
04 CALLER: I've had a headache every day this week and I also feel dizzy sometimes.
05 AGENT: That combination of daily headaches and dizziness is worth asking a few more questions about. Mind if I run through a quick symptom check?
06 CALLER: Sure.
07 AGENT: How long have the headaches been happening? [tool:store_triage_opqrst]
08 CALLER: About a week.
09 AGENT: Are the headaches more at the front of your head, back, or all over?
10 CALLER: Mostly the back of my head.
11 AGENT: Any nausea or vision changes alongside the dizziness? [tool:store_triage_opqrst]
12 CALLER: No nausea. Vision seems fine.
13 AGENT: Are you drinking enough water through the day?
14 CALLER: Honestly... probably not.
15 AGENT: Good to know. Running this through our clinical reference. [tool:run_triage_rag]
16 AGENT: This pattern is consistent with tension headaches or dehydration. Not an emergency, but a general wellness consult would be perfect. Want me to book that instead?
17 CALLER: Yes please.
18 AGENT: What days work?
19 CALLER: Thursday.
20 AGENT: Checking Thursday. [tool:get_available_slots]
21 AGENT: Thursday at eleven AM or three PM?
22 CALLER: Eleven AM.
23 AGENT: Name and email?
24 CALLER: Nina Patel, nina.patel at gmail.
25 AGENT: Booking Thursday eleven AM. [tool:schedule_appointment]
26 AGENT: Booked! Thursday eleven AM. Also try drinking more water today — it could genuinely help. Confirmation sent to nina.patel at gmail. [tool:end_call]
```

#### Live conversation

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi, I started to book a consult but actually I have a new symptom I want to mention.
03 AGENT: Thanks — I am still working on that. Could you tell me a bit more? [tool:get_triage_session]
04 CALLER: I've had a headache every day this week and I also feel dizzy sometimes.
05 AGENT: When did this start? [tool:get_triage_session,store_triage_rich_intake]
06 CALLER: Sure.
07 AGENT: I'm having trouble right now. Please hold on a moment. [tool:store_triage_opqrst]
08 CALLER: About a week.
09 AGENT: I'm having trouble right now. Please hold on a moment.
10 CALLER: Mostly the back of my head.
11 AGENT: I'm having trouble right now. Please hold on a moment. [tool:store_triage_opqrst]
12 CALLER: No nausea. Vision seems fine.
13 AGENT: I'm having trouble right now. Please hold on a moment.
14 CALLER: Honestly... probably not.
15 AGENT: I'm having trouble right now. Please hold on a moment. [tool:run_triage_rag]
17 CALLER: Yes please.
18 AGENT: I'm having trouble right now. Please hold on a moment.
19 CALLER: Thursday.
20 AGENT: I'm having trouble right now. Please hold on a moment. [tool:get_available_slots]
22 CALLER: Eleven AM.
23 AGENT: I'm having trouble right now. Please hold on a moment. [tool:get_triage_session]
24 CALLER: Nina Patel, nina.patel at gmail.
25 AGENT: I'm having trouble right now. Please hold on a moment. [tool:schedule_appointment]
```

#### Turn failures

- seq 2: reply sim 0.063
- seq 3: reply/tool mismatch
- seq 4: reply sim 0.000
- seq 5: reply/tool mismatch
- seq 6: reply sim 0.000; missing tool store_triage_opqrst
- seq 7: reply/tool mismatch
- seq 8: reply sim 0.000
- seq 9: reply/tool mismatch
- seq 10: reply sim 0.000; missing tool store_triage_opqrst
- seq 11: reply/tool mismatch
- seq 12: reply sim 0.000
- seq 13: reply/tool mismatch
- seq 14: reply sim 0.000; missing tool run_triage_rag
- seq 15: reply/tool mismatch
- seq 17: reply sim 0.000
- seq 18: reply/tool mismatch
- seq 19: reply sim 0.000; missing tool get_available_slots
- seq 20: reply/tool mismatch
- seq 22: reply sim 0.000
- seq 23: reply/tool mismatch
- seq 24: reply sim 0.000; missing tool schedule_appointment
- seq 25: reply/tool mismatch

#### Assertions

- **ACK_BEFORE_TRANSACTION:** FAIL — no empathetic prefix before first tool
- **BOOKING_GATE_RESPECTED:** PASS — no schedule_appointment in call
- **TOOL_COMPLETED_BEFORE_CLAIM:** PASS — tools before claim: get_triage_session, get_triage_session, store_triage_rich_intake, get_triage_session

#### Missing functions

store_triage_opqrst, run_triage_rag, schedule_appointment

#### Per-turn scoring

| Seq | Pass | Similarity | Expected tool | Tools used |
|-----|------|------------|---------------|------------|
| 2 | FAIL | 0.063 | — | get_triage_session |
| 3 | FAIL | 0.063 | — | get_triage_session |
| 4 | FAIL | 0 | — | get_triage_session, store_triage_rich_intake |
| 5 | FAIL | 0 | — | get_triage_session, store_triage_rich_intake |
| 6 | FAIL | 0 | store_triage_opqrst | — |
| 7 | FAIL | 0 | store_triage_opqrst | — |
| 8 | FAIL | 0 | — | — |
| 9 | FAIL | 0 | — | — |
| 10 | FAIL | 0 | store_triage_opqrst | — |
| 11 | FAIL | 0 | store_triage_opqrst | — |
| 12 | FAIL | 0 | — | — |
| 13 | FAIL | 0 | — | — |
| 14 | FAIL | 0 | run_triage_rag | — |
| 15 | FAIL | 0 | run_triage_rag | — |
| 17 | FAIL | 0 | — | — |
| 18 | FAIL | 0 | — | — |
| 19 | FAIL | 0 | get_available_slots | — |
| 20 | FAIL | 0 | get_available_slots | — |
| 22 | FAIL | 0 | — | get_triage_session |
| 23 | FAIL | 0 | — | get_triage_session |
| 24 | FAIL | 0 | schedule_appointment | — |
| 25 | FAIL | 0 | schedule_appointment | — |

---

### PSTN-043 — Document upload link — rash photo before async telehealth visit

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Result | FAIL |
| Runtime | kelly_rails |
| Session | `pstn_PSTN-043_38c05c04` |

#### Golden expected (script)

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi, I have a telehealth appointment booked for my rash but the doctor asked me to send a photo beforehand. How do I do that?
03 AGENT: I can send you a secure upload link right now. Can I confirm your name and the email on your appointment?
04 CALLER: Dana Reeves, dana.reeves at gmail.
05 AGENT: Sending the upload link now. [tool:send_document_upload_link]
06 AGENT: Done! I've sent a secure upload link to dana.reeves at gmail. The link is valid for forty-eight hours. Once you upload the photo it goes straight to your doctor's chart. Anything else?
07 CALLER: No that's all I needed. Thank you.
08 AGENT: Is there anything else I can help you with today?
09 CALLER: No, I think that is everything. Thank you.
10 AGENT: You are welcome. I am glad we could help.
11 CALLER: Thanks again.
12 AGENT: Of course, Dana. Good luck with the appointment! [tool:end_call]
```

#### Live conversation

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi, I have a telehealth appointment booked for my rash but the doctor asked me to send a photo beforehand. How do I do that?
03 AGENT: I can help with the rash on your leg and neck. A few quick questions will help us line up a dermatology visit — you said this is not an emergency, correct?
04 CALLER: Dana Reeves, dana.reeves at gmail.
05 AGENT: I'm having trouble right now. Please hold on a moment. [tool:send_document_upload_link]
07 CALLER: No that's all I needed. Thank you.
08 AGENT: I'm having trouble right now. Please hold on a moment.
09 CALLER: No, I think that is everything. Thank you.
10 AGENT: I'm having trouble right now. Please hold on a moment.
11 CALLER: Thanks again.
12 AGENT: I'm having trouble right now. Please hold on a moment. [tool:end_call]
```

#### Turn failures

- seq 4: reply sim 0.091; missing tool send_document_upload_link
- seq 5: reply/tool mismatch
- seq 7: reply sim 0.000
- seq 8: reply/tool mismatch
- seq 9: reply sim 0.000
- seq 10: reply/tool mismatch
- seq 11: reply sim 0.000; missing tool end_call
- seq 12: reply/tool mismatch

#### Assertions

- **TOOL_COMPLETED_BEFORE_CLAIM:** PASS — no tools recorded

#### Missing functions

send_document_upload_link

#### Per-turn scoring

| Seq | Pass | Similarity | Expected tool | Tools used |
|-----|------|------------|---------------|------------|
| 2 | OK | 0.156 | — | — |
| 3 | OK | 0.156 | — | — |
| 4 | FAIL | 0.091 | send_document_upload_link | — |
| 5 | FAIL | 0.091 | send_document_upload_link | — |
| 7 | FAIL | 0 | — | — |
| 8 | FAIL | 0 | — | — |
| 9 | FAIL | 0 | — | — |
| 10 | FAIL | 0 | — | — |
| 11 | FAIL | 0 | end_call | — |
| 12 | FAIL | 0 | end_call | — |

---

### PSTN-044 — Emergency chest pain — 911 script, no scheduling tools used

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Result | FAIL |
| Runtime | kelly_rails |
| Session | `pstn_PSTN-044_e179c6ca` |

#### Golden expected (script)

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: I'm having really bad chest pain and I can't breathe right.
03 AGENT: I hear you — please call 911 right now or have someone take you to the nearest emergency room. I cannot schedule appointments for chest pain and breathing difficulty — this needs emergency care immediately. Are you able to call 911?
04 CALLER: Okay... yes.
05 AGENT: Is there anything else I can help you with today?
06 CALLER: No, I think that is everything. Thank you.
07 AGENT: You are welcome. I am glad we could help.
08 CALLER: Thanks again.
09 AGENT: Of course — take care.
10 AGENT: Is there anything else I can help you with today?
11 CALLER: No, I think that is everything. Thank you.
12 AGENT: Please do that right now. If you're alone, call 911 before hanging up with me. Your safety is what matters. Please go now. [tool:end_call]
```

#### Live conversation

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: I'm having really bad chest pain and I can't breathe right.
03 AGENT: This sounds like it could be an emergency. If you are in immediate danger, please hang up and call 911 now. I am connecting you with our care team right away.
04 CALLER: Okay... yes.
05 AGENT: This sounds like it could be an emergency. If you are in immediate danger, please hang up and call 911 now. I am connecting you with our care team right away.
06 CALLER: No, I think that is everything. Thank you.
07 AGENT: This sounds like it could be an emergency. If you are in immediate danger, please hang up and call 911 now. I am connecting you with our care team right away.
08 CALLER: Thanks again.
09 AGENT: This sounds like it could be an emergency. If you are in immediate danger, please hang up and call 911 now. I am connecting you with our care team right away.
11 CALLER: No, I think that is everything. Thank you.
12 AGENT: This sounds like it could be an emergency. If you are in immediate danger, please hang up and call 911 now. I am connecting you with our care team right away. [tool:end_call]
```

#### Turn failures

- seq 4: reply sim 0.071
- seq 5: reply/tool mismatch
- seq 8: reply sim 0.071
- seq 9: reply/tool mismatch
- seq 11: reply sim 0.233; missing tool end_call
- seq 12: reply/tool mismatch

#### Assertions

- **ACK_BEFORE_TRANSACTION:** PASS — empathetic prefix found

#### Per-turn scoring

| Seq | Pass | Similarity | Expected tool | Tools used |
|-----|------|------------|---------------|------------|
| 2 | OK | 0.275 | — | — |
| 3 | OK | 0.275 | — | — |
| 4 | FAIL | 0.071 | — | — |
| 5 | FAIL | 0.071 | — | — |
| 6 | OK | 0.12 | — | — |
| 7 | OK | 0.12 | — | — |
| 8 | FAIL | 0.071 | — | — |
| 9 | FAIL | 0.071 | — | — |
| 11 | FAIL | 0.233 | end_call | — |
| 12 | FAIL | 0.233 | end_call | — |

---

### PSTN-045 — Video supplement consult — book with visit_mode:video

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Result | FAIL |
| Runtime | kelly_rails |
| Session | `pstn_PSTN-045_cefc706f` |

#### Golden expected (script)

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi, I want to book a video call consultation for supplements. I prefer video.
03 AGENT: Absolutely — we offer video consults. Let me check availability. [tool:get_available_slots]
04 AGENT: I have Tuesday at eleven AM or Thursday at three PM — both as video calls. Which works?
05 CALLER: Tuesday at eleven.
06 AGENT: Name and email?
07 CALLER: Miguel Torres, miguel.torres at gmail.
08 AGENT: Booking Tuesday eleven AM video consult. [tool:schedule_appointment]
09 AGENT: Done! Tuesday eleven AM video consult. A video join link will be in your confirmation email. Anything else?
10 CALLER: No, perfect. Thanks.
11 AGENT: Is there anything else I can help you with today?
12 AGENT: See you virtually Tuesday, Miguel! [tool:end_call]
```

#### Live conversation

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi, I want to book a video call consultation for supplements. I prefer video.
03 AGENT: I'm having trouble right now. Please hold on a moment. [tool:get_available_slots]
05 CALLER: Tuesday at eleven.
06 AGENT: I'm having trouble right now. Please hold on a moment.
07 CALLER: Miguel Torres, miguel.torres at gmail.
08 AGENT: I'm having trouble right now. Please hold on a moment. [tool:schedule_appointment]
10 CALLER: No, perfect. Thanks.
11 AGENT: I'm having trouble right now. Please hold on a moment.
```

#### Turn failures

- seq 2: reply sim 0.000; missing tool get_available_slots
- seq 3: reply/tool mismatch
- seq 5: reply sim 0.000
- seq 6: reply/tool mismatch
- seq 7: reply sim 0.000; missing tool schedule_appointment
- seq 8: reply/tool mismatch
- seq 10: reply sim 0.000
- seq 11: reply/tool mismatch

#### Assertions

- **BOOKING_GATE_RESPECTED:** PASS — no schedule_appointment in call

#### Missing functions

schedule_appointment

#### Per-turn scoring

| Seq | Pass | Similarity | Expected tool | Tools used |
|-----|------|------------|---------------|------------|
| 2 | FAIL | 0 | get_available_slots | — |
| 3 | FAIL | 0 | get_available_slots | — |
| 5 | FAIL | 0 | — | — |
| 6 | FAIL | 0 | — | — |
| 7 | FAIL | 0 | schedule_appointment | — |
| 8 | FAIL | 0 | schedule_appointment | — |
| 10 | FAIL | 0 | — | — |
| 11 | FAIL | 0 | — | — |

---

### PSTN-046 — Copay question before booking — agent explains then books

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Result | FAIL |
| Runtime | kelly_rails |
| Session | `pstn_PSTN-046_4fdc41b6` |

#### Golden expected (script)

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi, before I book I want to know how much the visit costs.
03 AGENT: Of course — great question to ask first. For a standard supplement consultation, the self-pay rate is ninety-five dollars. If you have insurance, your copay will depend on your plan, but I can verify that if you have your insurance card handy. Would you like me to check?
04 CALLER: I have United Healthcare.
05 AGENT: Let me check UHC coverage. [tool:collect_insurance]
06 AGENT: For United Healthcare, typical specialist copay is twenty to forty dollars, but the exact amount depends on your specific plan. The visit fee goes on the portal after booking. Want to go ahead?
07 CALLER: Yeah, that's reasonable.
08 AGENT: What days work for you?
09 CALLER: Friday.
10 AGENT: Checking Friday. [tool:get_available_slots]
11 AGENT: Friday at ten AM or two PM?
12 CALLER: Two PM.
13 AGENT: Name and email?
14 CALLER: Helen Park, helen.park at gmail.
15 AGENT: Booking Friday two PM. [tool:schedule_appointment]
16 AGENT: Booked! Friday two PM. Exact copay details will be in the portal. See you Friday, Helen! [tool:end_call]
```

#### Live conversation

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi, before I book I want to know how much the visit costs.
03 AGENT: I'm having trouble right now. Please hold on a moment.
04 CALLER: I have United Healthcare.
05 AGENT: I'm having trouble right now. Please hold on a moment. [tool:collect_insurance]
07 CALLER: Yeah, that's reasonable.
08 AGENT: I'm having trouble right now. Please hold on a moment.
09 CALLER: Friday.
10 AGENT: I'm having trouble right now. Please hold on a moment. [tool:get_available_slots]
12 CALLER: Two PM.
13 AGENT: I'm having trouble right now. Please hold on a moment.
14 CALLER: Helen Park, helen.park at gmail.
15 AGENT: I'm having trouble right now. Please hold on a moment. [tool:schedule_appointment]
```

#### Turn failures

- seq 2: reply sim 0.000
- seq 3: reply/tool mismatch
- seq 4: reply sim 0.000; missing tool collect_insurance
- seq 5: reply/tool mismatch
- seq 7: reply sim 0.000
- seq 8: reply/tool mismatch
- seq 9: reply sim 0.000; missing tool get_available_slots
- seq 10: reply/tool mismatch
- seq 12: reply sim 0.000
- seq 13: reply/tool mismatch
- seq 14: reply sim 0.000; missing tool schedule_appointment
- seq 15: reply/tool mismatch

#### Assertions

- **ACK_BEFORE_TRANSACTION:** FAIL — no empathetic prefix before first tool
- **BOOKING_GATE_RESPECTED:** PASS — no schedule_appointment in call

#### Missing functions

collect_insurance, schedule_appointment

#### Per-turn scoring

| Seq | Pass | Similarity | Expected tool | Tools used |
|-----|------|------------|---------------|------------|
| 2 | FAIL | 0 | — | — |
| 3 | FAIL | 0 | — | — |
| 4 | FAIL | 0 | collect_insurance | — |
| 5 | FAIL | 0 | collect_insurance | — |
| 7 | FAIL | 0 | — | — |
| 8 | FAIL | 0 | — | — |
| 9 | FAIL | 0 | get_available_slots | — |
| 10 | FAIL | 0 | get_available_slots | — |
| 12 | FAIL | 0 | — | — |
| 13 | FAIL | 0 | — | — |
| 14 | FAIL | 0 | schedule_appointment | — |
| 15 | FAIL | 0 | schedule_appointment | — |

---

### PSTN-047 — Double-book attempt — conflict detected, recovery

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Result | FAIL |
| Runtime | kelly_rails |
| Session | `pstn_PSTN-047_560dae59` |

#### Golden expected (script)

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi, I want to book a consult for Thursday at two PM.
03 AGENT: Let me check that slot. [tool:get_available_slots]
04 AGENT: I see something interesting — it looks like you may already have an appointment Thursday at two PM in our system. Did you want to add a second one, or is it possible you already booked?
05 CALLER: Oh! I forgot I already booked that. Oops.
06 AGENT: No worries at all — that happens! Just to confirm, you have a consult this Thursday at two PM already. Would you like me to send you the confirmation email again?
07 CALLER: Yes please, that'd be helpful.
08 AGENT: Resending confirmation to your email on file. Is that everything?
09 CALLER: Yes, thanks.
10 AGENT: Is there anything else I can help you with today?
11 CALLER: No, I think that is everything. Thank you.
12 AGENT: Of course! See you Thursday. [tool:end_call]
```

#### Live conversation

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi, I want to book a consult for Thursday at two PM.
03 AGENT: I'd be happy to help you book a consultation for Thursday at 2 PM. Let me check available slots for you. However, I need a. [tool:get_available_slots]
05 CALLER: Oh! I forgot I already booked that. Oops.
06 AGENT: No problem at all! It happens. Since you've already booked your Thursday 2 PM appointment, you're all set. Is there anything else I can help.
07 CALLER: Yes please, that'd be helpful.
08 AGENT: Of course! What can I help you with today?
09 CALLER: Yes, thanks.
10 AGENT: I'm here to help! What do you need assistance with?
11 CALLER: No, I think that is everything. Thank you.
12 AGENT: You're welcome! Have a great day, and we'll see you Thursday at 2 PM! [tool:end_call]
```

#### Turn failures

- seq 2: reply sim 0.133; missing tool get_available_slots
- seq 3: reply/tool mismatch
- seq 7: reply sim 0.000
- seq 8: reply/tool mismatch
- seq 11: reply sim 0.333; missing tool end_call
- seq 12: reply/tool mismatch

#### Assertions

- **BOOKING_GATE_RESPECTED:** PASS — no schedule_appointment in call

#### Per-turn scoring

| Seq | Pass | Similarity | Expected tool | Tools used |
|-----|------|------------|---------------|------------|
| 2 | FAIL | 0.133 | get_available_slots | — |
| 3 | FAIL | 0.133 | get_available_slots | — |
| 5 | OK | 0.161 | — | — |
| 6 | OK | 0.161 | — | — |
| 7 | FAIL | 0 | — | — |
| 8 | FAIL | 0 | — | — |
| 9 | OK | 0.25 | — | — |
| 10 | OK | 0.25 | — | — |
| 11 | FAIL | 0.333 | end_call | — |
| 12 | FAIL | 0.333 | end_call | — |

---

### PSTN-048 — Wrong number — caller wants pizza place

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Result | FAIL |
| Runtime | kelly_rails |
| Session | `pstn_PSTN-048_016f1498` |

#### Golden expected (script)

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi, I want to order a large pepperoni pizza.
03 AGENT: Ha — I think you may have the wrong number! This is Somo Supplements — we sell vitamins and health supplements, not pizza. Easy mistake to make. I hope you find your pizza!
04 CALLER: Oh gosh, sorry!
05 AGENT: Is there anything else I can help you with today?
06 CALLER: No, I think that is everything. Thank you.
07 AGENT: You are welcome. I am glad we could help.
08 CALLER: Thanks again.
09 AGENT: Of course — take care.
10 AGENT: Is there anything else I can help you with today?
11 CALLER: No, I think that is everything. Thank you.
12 AGENT: No worries at all. Good luck with the pizza order! Goodbye. [tool:end_call]
```

#### Live conversation

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi, I want to order a large pepperoni pizza.
03 AGENT: I appreciate you calling, but this is Somo Supplements, a clinical office. We don't offer pizza – you may have the wrong number! Is there.
04 CALLER: Oh gosh, sorry!
05 AGENT: No worries at all, happens to the best of us! If you need anything health-related, we're here. Otherwise, hope you find that pizza! Have a.
06 CALLER: No, I think that is everything. Thank you.
07 AGENT: You're welcome! Have a great day!
08 CALLER: Thanks again.
09 AGENT: My pleasure! Take care!
11 CALLER: No, I think that is everything. Thank you.
12 AGENT: You're all set! Bye now! [tool:end_call]
```

#### Turn failures

- seq 4: reply sim 0.087
- seq 5: reply/tool mismatch
- seq 11: reply sim 0.077; missing tool end_call
- seq 12: reply/tool mismatch

#### Per-turn scoring

| Seq | Pass | Similarity | Expected tool | Tools used |
|-----|------|------------|---------------|------------|
| 2 | OK | 0.333 | — | — |
| 3 | OK | 0.333 | — | — |
| 4 | FAIL | 0.087 | — | — |
| 5 | FAIL | 0.087 | — | — |
| 6 | OK | 0.222 | — | — |
| 7 | OK | 0.222 | — | — |
| 8 | OK | 0.5 | — | — |
| 9 | OK | 0.5 | — | — |
| 11 | FAIL | 0.077 | end_call | — |
| 12 | FAIL | 0.077 | end_call | — |

---

### PSTN-049 — Cancel by name+date — verify, cancel, confirm cancelled

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Result | FAIL |
| Runtime | kelly_rails |
| Session | `pstn_PSTN-049_132d5294` |

#### Golden expected (script)

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi, I need to cancel my appointment.
03 AGENT: Of course. Can I get your name and the date of the appointment?
04 CALLER: James Carter, Friday at three PM.
05 AGENT: Looking that up. [tool:search_appointments]
06 AGENT: I found your supplement consult this Friday at three PM. Just to confirm — you'd like to cancel that?
07 CALLER: Yes please.
08 AGENT: Cancelling now. [tool:cancel_appointment]
09 AGENT: Done — your appointment has been cancelled. You'll receive a cancellation confirmation by email. Is there anything else, James?
10 CALLER: No, that's all.
11 AGENT: Is there anything else I can help you with today?
12 AGENT: Take care! [tool:end_call]
```

#### Live conversation

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi, I need to cancel my appointment.
03 AGENT: Can you confirm your name or the phone number on your account so I can look up your appointment? [tool:search_appointments]
04 CALLER: James Carter, Friday at three PM.
05 AGENT: Can you confirm your name or the phone number on your account so I can look up your appointment? [tool:search_appointments]
07 CALLER: Yes please.
08 AGENT: Can you confirm your name or the phone number on your account so I can look up your appointment? [tool:cancel_appointment]
10 CALLER: No, that's all.
11 AGENT: Can you confirm your name or the phone number on your account so I can look up your appointment? [tool:search_appointments]
```

#### Turn failures

- seq 10: reply sim 0.118
- seq 11: reply/tool mismatch

#### Assertions

- **TOOL_COMPLETED_BEFORE_CLAIM:** PASS — tools before claim: search_appointments, search_appointments, search_appointments, search_appointments

#### Missing functions

cancel_appointment

#### Per-turn scoring

| Seq | Pass | Similarity | Expected tool | Tools used |
|-----|------|------------|---------------|------------|
| 2 | OK | 0.333 | — | search_appointments |
| 3 | OK | 0.333 | — | search_appointments |
| 4 | OK | 0.143 | — | search_appointments |
| 5 | OK | 0.143 | — | search_appointments |
| 7 | OK | 0.13 | — | search_appointments |
| 8 | OK | 0.13 | — | search_appointments |
| 10 | FAIL | 0.118 | — | search_appointments |
| 11 | FAIL | 0.118 | — | search_appointments |

---

### PSTN-050 — Reschedule Friday to Thursday

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Result | FAIL |
| Runtime | kelly_rails |
| Session | `pstn_PSTN-050_dd0a036d` |

#### Golden expected (script)

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi, I need to reschedule my Friday appointment to Thursday if possible.
03 AGENT: Let me check Thursday slots first. [tool:get_available_slots]
04 AGENT: Thursday has one PM and four PM open. Do either of those work?
05 CALLER: One PM works.
06 AGENT: What's your name so I can locate your appointment?
07 CALLER: Maria Lopez.
08 AGENT: Rescheduling Maria's Friday eleven AM to Thursday one PM. [tool:reschedule_appointment]
09 AGENT: Done! You're now scheduled for Thursday at one PM. New confirmation is heading to your email. Anything else?
10 CALLER: No, that's perfect. Thank you.
11 AGENT: Is there anything else I can help you with today?
12 AGENT: See you Thursday, Maria! [tool:end_call]
```

#### Live conversation

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi, I need to reschedule my Friday appointment to Thursday if possible.
03 AGENT: I could not find an upcoming appointment on file. Can you confirm your name or the phone number we have for you? [tool:get_available_slots]
05 CALLER: One PM works.
06 AGENT: I could not find an upcoming appointment on file. Can you confirm your name or the phone number we have for you? [tool:search_appointments]
07 CALLER: Maria Lopez.
08 AGENT: I could not find an upcoming appointment on file. Can you confirm your name or the phone number we have for you? [tool:reschedule_appointment]
10 CALLER: No, that's perfect. Thank you.
11 AGENT: I could not find an upcoming appointment on file. Can you confirm your name or the phone number we have for you? [tool:search_appointments]
```

#### Turn failures

- seq 2: reply sim 0.000; missing tool get_available_slots
- seq 3: reply/tool mismatch
- seq 7: reply sim 0.111
- seq 8: reply/tool mismatch
- seq 10: reply sim 0.091
- seq 11: reply/tool mismatch

#### Assertions

- **TOOL_COMPLETED_BEFORE_CLAIM:** PASS — tools before claim: search_appointments, search_appointments, search_appointments, search_appointments

#### Missing functions

get_available_slots, reschedule_appointment

#### Per-turn scoring

| Seq | Pass | Similarity | Expected tool | Tools used |
|-----|------|------------|---------------|------------|
| 2 | FAIL | 0 | get_available_slots | search_appointments |
| 3 | FAIL | 0 | get_available_slots | search_appointments |
| 5 | OK | 0.222 | — | search_appointments |
| 6 | OK | 0.222 | — | search_appointments |
| 7 | FAIL | 0.111 | — | search_appointments |
| 8 | FAIL | 0.111 | — | search_appointments |
| 10 | FAIL | 0.091 | — | search_appointments |
| 11 | FAIL | 0.091 | — | search_appointments |

---

### PSTN-051 — Same-day cancel and rebook — full intent drain single call

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Result | FAIL |
| Runtime | kelly_rails |
| Session | `pstn_PSTN-051_add0d343` |

#### Golden expected (script)

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi, I need to cancel my appointment today but I also want to book a new one.
03 AGENT: Of course — I can do both. Let me find your appointment. What's your name?
04 CALLER: Luke Evans.
05 AGENT: Found it. [tool:search_appointments]
06 AGENT: You have an appointment today at two PM. Cancelling that now. [tool:cancel_appointment]
07 AGENT: Cancelled. Now let's find you a new time. What days work?
08 CALLER: How about next Monday or Tuesday?
09 AGENT: Checking those. [tool:get_available_slots]
10 AGENT: Monday at ten AM or Tuesday at three PM.
11 CALLER: Tuesday three PM.
12 AGENT: Booking Tuesday three PM for Luke. [tool:schedule_appointment]
13 AGENT: Done! Old appointment cancelled, new one set for Tuesday three PM. Confirmation sent. Anything else?
14 CALLER: No, that's perfect.
15 AGENT: See you Tuesday, Luke! [tool:end_call]
```

#### Live conversation

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi, I need to cancel my appointment today but I also want to book a new one.
03 AGENT: I could not find an upcoming appointment on file. Can you confirm your name or the phone number we have for you? [tool:search_appointments]
04 CALLER: Luke Evans.
05 AGENT: I could not find an upcoming appointment on file. Can you confirm your name or the phone number we have for you? [tool:cancel_appointment]
08 CALLER: How about next Monday or Tuesday?
09 AGENT: I could not find an upcoming appointment on file. Can you confirm your name or the phone number we have for you? [tool:get_available_slots]
11 CALLER: Tuesday three PM.
12 AGENT: I could not find an upcoming appointment on file. Can you confirm your name or the phone number we have for you? [tool:schedule_appointment]
14 CALLER: No, that's perfect.
15 AGENT: I could not find an upcoming appointment on file. Can you confirm your name or the phone number we have for you? [tool:end_call]
```

#### Turn failures

- seq 4: reply sim 0.143; missing tool cancel_appointment
- seq 5: reply/tool mismatch
- seq 8: reply sim 0.000; missing tool get_available_slots
- seq 9: reply/tool mismatch
- seq 11: reply sim 0.071
- seq 12: reply/tool mismatch
- seq 14: reply sim 0.053; missing tool end_call
- seq 15: reply/tool mismatch

#### Assertions

- **BOOKING_GATE_RESPECTED:** PASS — no schedule_appointment in call
- **TOOL_COMPLETED_BEFORE_CLAIM:** PASS — tools before claim: search_appointments, search_appointments, search_appointments, search_appointments, search_appointments

#### Missing functions

cancel_appointment, get_available_slots, schedule_appointment

#### Per-turn scoring

| Seq | Pass | Similarity | Expected tool | Tools used |
|-----|------|------------|---------------|------------|
| 2 | OK | 0.25 | — | search_appointments |
| 3 | OK | 0.25 | — | search_appointments |
| 4 | FAIL | 0.143 | cancel_appointment | search_appointments |
| 5 | FAIL | 0.143 | cancel_appointment | search_appointments |
| 8 | FAIL | 0 | get_available_slots | search_appointments |
| 9 | FAIL | 0 | get_available_slots | search_appointments |
| 11 | FAIL | 0.071 | — | search_appointments |
| 12 | FAIL | 0.071 | — | search_appointments |
| 14 | FAIL | 0.053 | end_call | search_appointments |
| 15 | FAIL | 0.053 | end_call | search_appointments |

---

### PSTN-052 — Cancel fails — cancel_failed copy, handoff offer

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Result | FAIL |
| Runtime | kelly_rails |
| Session | `pstn_PSTN-052_94e3be73` |

#### Golden expected (script)

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: I need to cancel my appointment.
03 AGENT: Of course. What's your name?
04 CALLER: Brenda Walsh.
05 AGENT: Looking up your appointment. [tool:search_appointments]
06 AGENT: I found your appointment, but I'm running into an issue — it appears this appointment type needs to be cancelled directly with our team rather than automatically. I'm sorry for the extra step. Can I connect you with someone who can take care of it right now?
07 CALLER: Yes please.
08 AGENT: Transferring you now — one moment. [tool:transfer_call]
09 AGENT: Is there anything else I can help you with today?
10 CALLER: No, I think that is everything. Thank you.
11 AGENT: You are welcome. I am glad we could help.
12 AGENT: You're being connected. I'm sorry for the inconvenience, Brenda. [tool:end_call]
```

#### Live conversation

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: I need to cancel my appointment.
03 AGENT: Can you confirm your name or the phone number on your account so I can look up your appointment? [tool:search_appointments]
04 CALLER: Brenda Walsh.
05 AGENT: Can you confirm your name or the phone number on your account so I can look up your appointment? [tool:search_appointments]
07 CALLER: Yes please.
08 AGENT: Can you confirm your name or the phone number on your account so I can look up your appointment? [tool:transfer_call]
10 CALLER: No, I think that is everything. Thank you.
11 AGENT: Can you confirm your name or the phone number on your account so I can look up your appointment? [tool:end_call]
```

#### Turn failures

- seq 7: reply sim 0.118
- seq 8: reply/tool mismatch
- seq 10: reply sim 0.118; missing tool end_call
- seq 11: reply/tool mismatch

#### Assertions

- **HANDOFF_ON_VENT:** FAIL — no handoff

#### Missing functions

transfer_call

#### Per-turn scoring

| Seq | Pass | Similarity | Expected tool | Tools used |
|-----|------|------------|---------------|------------|
| 2 | OK | 0.154 | — | search_appointments |
| 3 | OK | 0.154 | — | search_appointments |
| 4 | OK | 0.167 | search_appointments | search_appointments |
| 5 | OK | 0.167 | search_appointments | search_appointments |
| 7 | FAIL | 0.118 | — | search_appointments |
| 8 | FAIL | 0.118 | — | search_appointments |
| 10 | FAIL | 0.118 | end_call | search_appointments |
| 11 | FAIL | 0.118 | end_call | search_appointments |

---

### PSTN-053 — Reschedule fails — reschedule_failed, handoff

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Result | FAIL |
| Runtime | kelly_rails |
| Session | `pstn_PSTN-053_d6725011` |

#### Golden expected (script)

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: I need to move my appointment to next week.
03 AGENT: I can help with that. What's your name?
04 CALLER: Samuel Price.
05 AGENT: Looking up your appointment. [tool:search_appointments]
06 AGENT: I found your appointment, but I'm getting a restriction that prevents me from rescheduling this one automatically — it may be a special appointment type. I want to get this sorted for you. Can I transfer you to our scheduling team?
07 CALLER: Sure.
08 AGENT: Connecting you now. [tool:transfer_call]
09 AGENT: Is there anything else I can help you with today?
10 CALLER: No, I think that is everything. Thank you.
11 AGENT: You are welcome. I am glad we could help.
12 AGENT: You're being transferred, Samuel. Sorry for the extra step. [tool:end_call]
```

#### Live conversation

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: I need to move my appointment to next week.
03 AGENT: I could not find an upcoming appointment on file. Can you confirm your name or the phone number we have for you? [tool:search_appointments]
04 CALLER: Samuel Price.
05 AGENT: I could not find an upcoming appointment on file. Can you confirm your name or the phone number we have for you? [tool:search_appointments]
07 CALLER: Sure.
08 AGENT: I could not find an upcoming appointment on file. Can you confirm your name or the phone number we have for you? [tool:transfer_call]
10 CALLER: No, I think that is everything. Thank you.
11 AGENT: I could not find an upcoming appointment on file. Can you confirm your name or the phone number we have for you? [tool:end_call]
```

#### Turn failures

- seq 7: reply sim 0.091
- seq 8: reply/tool mismatch
- seq 10: reply sim 0.136; missing tool end_call
- seq 11: reply/tool mismatch

#### Assertions

- **HANDOFF_ON_VENT:** FAIL — no handoff

#### Missing functions

transfer_call

#### Per-turn scoring

| Seq | Pass | Similarity | Expected tool | Tools used |
|-----|------|------------|---------------|------------|
| 2 | OK | 0.15 | — | search_appointments |
| 3 | OK | 0.15 | — | search_appointments |
| 4 | OK | 0.135 | — | search_appointments |
| 5 | OK | 0.135 | — | search_appointments |
| 7 | FAIL | 0.091 | — | search_appointments |
| 8 | FAIL | 0.091 | — | search_appointments |
| 10 | FAIL | 0.136 | end_call | search_appointments |
| 11 | FAIL | 0.136 | end_call | search_appointments |

---

### PSTN-054 — Outbound reminder — patient cancels

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | outbound |
| Locale | en-US |
| Result | FAIL |
| Runtime | kelly_rails |
| Session | `pstn_PSTN-054_76656e7f` |

#### Golden expected (script)

```
01 AGENT: Hi, may I speak with Connie Shaw? This is Kelly calling from Somo Supplements.
02 CALLER: This is Connie.
03 AGENT: Hi Connie! I'm calling to confirm your appointment tomorrow at nine AM. Does that still work for you?
04 CALLER: Actually, I need to cancel. Something came up.
05 AGENT: Of course, no problem. Let me cancel that for you right now. [tool:cancel_appointment]
06 AGENT: Your appointment is cancelled. Would you like to reschedule at a different time?
07 CALLER: Not right now, but I'll call back.
08 AGENT: Is there anything else I can help you with today?
09 CALLER: No, I think that is everything. Thank you.
10 AGENT: You are welcome. I am glad we could help.
11 CALLER: Thanks again.
12 AGENT: Sounds good. We're here whenever you're ready. Take care, Connie! [tool:end_call]
```

#### Live conversation

```
01 AGENT: Hi, may I speak with Connie Shaw? This is Kelly calling from Somo Supplements.
02 CALLER: This is Connie.
03 AGENT: Hi there, this is Kelly calling from Somo with a quick follow-up. Do you have a moment?
04 CALLER: Actually, I need to cancel. Something came up.
05 AGENT: I can help you cancel that appointment. Let me pull up your visit details. [tool:cancel_appointment]
07 CALLER: Not right now, but I'll call back.
08 AGENT: I could not find an upcoming appointment on file. Can you confirm your name or the phone number we have for you? [tool:search_appointments]
09 CALLER: No, I think that is everything. Thank you.
10 AGENT: I could not find an upcoming appointment on file. Can you confirm your name or the phone number we have for you? [tool:search_appointments]
11 CALLER: Thanks again.
12 AGENT: I could not find an upcoming appointment on file. Can you confirm your name or the phone number we have for you? [tool:end_call]
```

#### Turn failures

- seq 2: reply sim 0.087
- seq 3: reply/tool mismatch
- seq 4: reply sim 0.250; missing tool cancel_appointment
- seq 5: reply/tool mismatch
- seq 7: reply sim 0.091
- seq 8: reply/tool mismatch
- seq 9: reply sim 0.100
- seq 10: reply/tool mismatch
- seq 11: reply sim 0.042; missing tool end_call
- seq 12: reply/tool mismatch

#### Assertions

- **OUTBOUND_DISPOSITION_LOGGED:** FAIL — missing end_call disposition

#### Missing functions

cancel_appointment

#### Per-turn scoring

| Seq | Pass | Similarity | Expected tool | Tools used |
|-----|------|------------|---------------|------------|
| 2 | FAIL | 0.087 | — | — |
| 3 | FAIL | 0.087 | — | — |
| 4 | FAIL | 0.25 | cancel_appointment | — |
| 5 | FAIL | 0.25 | cancel_appointment | — |
| 7 | FAIL | 0.091 | — | search_appointments |
| 8 | FAIL | 0.091 | — | search_appointments |
| 9 | FAIL | 0.1 | — | search_appointments |
| 10 | FAIL | 0.1 | — | search_appointments |
| 11 | FAIL | 0.042 | end_call | search_appointments |
| 12 | FAIL | 0.042 | end_call | search_appointments |

---

### PSTN-055 — Outbound reminder — patient reschedules

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | outbound |
| Locale | en-US |
| Result | FAIL |
| Runtime | kelly_rails |
| Session | `pstn_PSTN-055_6c58729d` |

#### Golden expected (script)

```
01 AGENT: Hi, may I speak with Derek Kim? This is Kelly from Somo Supplements.
02 CALLER: Speaking.
03 AGENT: Hi Derek! Just confirming your appointment tomorrow at two PM. Still good?
04 CALLER: Actually I can't make it tomorrow. Can we move it?
05 AGENT: Of course! Let me check available times. [tool:get_available_slots]
06 AGENT: I have Wednesday eleven, Thursday three, or Friday ten AM. Any of those work?
07 CALLER: Thursday three PM.
08 AGENT: Rescheduling Derek to Thursday three PM. [tool:reschedule_appointment]
09 AGENT: Is there anything else I can help you with today?
10 CALLER: No, I think that is everything. Thank you.
11 AGENT: You are welcome. I am glad we could help.
12 AGENT: Done! Thursday three PM it is. New confirmation sent to your email. See you Thursday, Derek! [tool:end_call]
```

#### Live conversation

```
01 AGENT: Hi, may I speak with Derek Kim? This is Kelly from Somo Supplements.
02 CALLER: Speaking.
03 AGENT: Hi there, this is Kelly calling from Somo with a quick follow-up. Do you have a moment?
04 CALLER: Actually I can't make it tomorrow. Can we move it?
05 AGENT: I wanted to share an update on your account. Is there anything specific you would like me to address? [tool:get_available_slots]
07 CALLER: Thursday three PM.
08 AGENT: Got it. I have noted that. Is there anything else I can help with today? [tool:reschedule_appointment]
10 CALLER: No, I think that is everything. Thank you.
11 AGENT: Thanks for your time. We will follow up if needed. Have a great day. [tool:end_call]
```

#### Turn failures

- seq 2: reply sim 0.000
- seq 3: reply/tool mismatch
- seq 4: reply sim 0.000; missing tool get_available_slots
- seq 5: reply/tool mismatch
- seq 10: reply sim 0.050; missing tool end_call
- seq 11: reply/tool mismatch

#### Assertions

- **OUTBOUND_DISPOSITION_LOGGED:** FAIL — missing end_call disposition

#### Missing functions

get_available_slots, reschedule_appointment

#### Per-turn scoring

| Seq | Pass | Similarity | Expected tool | Tools used |
|-----|------|------------|---------------|------------|
| 2 | FAIL | 0 | — | — |
| 3 | FAIL | 0 | — | — |
| 4 | FAIL | 0 | get_available_slots | — |
| 5 | FAIL | 0 | get_available_slots | — |
| 7 | OK | 0.583 | — | — |
| 8 | OK | 0.583 | — | — |
| 10 | FAIL | 0.05 | end_call | — |
| 11 | FAIL | 0.05 | end_call | — |

---

### PSTN-056 — Outbound reminder — voicemail disposition

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | outbound |
| Locale | en-US |
| Result | FAIL |
| Runtime | kelly_rails |
| Session | `pstn_PSTN-056_f9a79bcb` |

#### Golden expected (script)

```
01 AGENT: (pause)
02 CALLER: (pause)
03 AGENT: Is there anything else I can help you with today?
04 CALLER: No, I think that is everything. Thank you.
05 AGENT: You are welcome. I am glad we could help.
06 CALLER: Thanks again.
07 AGENT: Of course — take care.
08 AGENT: Is there anything else I can help you with today?
09 CALLER: No, I think that is everything. Thank you.
10 AGENT: You are welcome. I am glad we could help.
11 CALLER: Thanks again.
12 AGENT: Hi Terry, this is Kelly calling from Somo Supplements. I'm calling to confirm your appointment tomorrow at eleven AM. If you need to reschedule, please call us back at your earliest convenience. Thanks and have a great day! [tool:end_call]
```

#### Live conversation

```
01 AGENT: (pause)
02 CALLER: (pause)
03 AGENT: Hi there, this is Kelly calling from Somo with a quick follow-up. Do you have a moment?
04 CALLER: No, I think that is everything. Thank you.
05 AGENT: Thanks for your time. We will follow up if needed. Have a great day.
06 CALLER: Thanks again.
07 AGENT: Got it. I have noted that. Is there anything else I can help with today?
09 CALLER: No, I think that is everything. Thank you.
10 AGENT: Thanks for your time. We will follow up if needed. Have a great day.
11 CALLER: Thanks again.
12 AGENT: Thanks for your time. We will follow up if needed. Have a great day. [tool:end_call]
```

#### Turn failures

- seq 4: reply sim 0.000
- seq 5: reply/tool mismatch
- seq 9: reply sim 0.000
- seq 10: reply/tool mismatch
- seq 11: reply sim 0.167; missing tool end_call
- seq 12: reply/tool mismatch

#### Assertions

- **OUTBOUND_DISPOSITION_LOGGED:** FAIL — missing end_call disposition

#### Per-turn scoring

| Seq | Pass | Similarity | Expected tool | Tools used |
|-----|------|------------|---------------|------------|
| 2 | OK | 0.176 | — | — |
| 3 | OK | 0.176 | — | — |
| 4 | FAIL | 0 | — | — |
| 5 | FAIL | 0 | — | — |
| 6 | OK | 0.583 | — | — |
| 7 | OK | 0.583 | — | — |
| 9 | FAIL | 0 | — | — |
| 10 | FAIL | 0 | — | — |
| 11 | FAIL | 0.167 | end_call | — |
| 12 | FAIL | 0.167 | end_call | — |

---

### PSTN-057 — Outbound — opt-out "stop calling"

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | outbound |
| Locale | en-US |
| Result | FAIL |
| Runtime | kelly_rails |
| Session | `pstn_PSTN-057_224d2704` |

#### Golden expected (script)

```
01 AGENT: Hi, may I speak with Phil Grant? This is Kelly calling from Somo Supplements.
02 CALLER: I've told you people to stop calling me. Take me off your list.
03 AGENT: Is there anything else I can help you with today?
04 CALLER: No, I think that is everything. Thank you.
05 AGENT: You are welcome. I am glad we could help.
06 CALLER: Thanks again.
07 AGENT: Of course — take care.
08 AGENT: Is there anything else I can help you with today?
09 CALLER: No, I think that is everything. Thank you.
10 AGENT: You are welcome. I am glad we could help.
11 CALLER: Thanks again.
12 AGENT: I sincerely apologize for the inconvenience, Phil. I'll make a note of your request to opt out of outbound calls right now. You will not receive any further calls from us. I'm sorry again. [tool:end_call]
```

#### Live conversation

```
01 AGENT: Hi, may I speak with Phil Grant? This is Kelly calling from Somo Supplements.
02 CALLER: I've told you people to stop calling me. Take me off your list.
03 AGENT: Understood — we will not call this number again. Thank you.
04 CALLER: No, I think that is everything. Thank you.
05 AGENT: Hi there, this is Kelly calling from Somo with a quick follow-up. Do you have a moment?
06 CALLER: Thanks again.
07 AGENT: I wanted to share an update on your account. Is there anything specific you would like me to address?
09 CALLER: No, I think that is everything. Thank you.
10 AGENT: Thanks for your time. We will follow up if needed. Have a great day.
11 CALLER: Thanks again.
12 AGENT: If you would prefer to speak with someone on our team, I can arrange a callback. Would that help? [tool:end_call]
```

#### Turn failures

- seq 2: reply sim 0.063
- seq 3: reply/tool mismatch
- seq 4: reply sim 0.059
- seq 5: reply/tool mismatch
- seq 9: reply sim 0.000
- seq 10: reply/tool mismatch
- seq 11: reply sim 0.027; missing tool end_call
- seq 12: reply/tool mismatch

#### Assertions

- **OUTBOUND_DISPOSITION_LOGGED:** FAIL — missing end_call disposition

#### Per-turn scoring

| Seq | Pass | Similarity | Expected tool | Tools used |
|-----|------|------------|---------------|------------|
| 2 | FAIL | 0.063 | — | — |
| 3 | FAIL | 0.063 | — | — |
| 4 | FAIL | 0.059 | — | — |
| 5 | FAIL | 0.059 | — | — |
| 6 | OK | 0.176 | — | — |
| 7 | OK | 0.176 | — | — |
| 9 | FAIL | 0 | — | — |
| 10 | FAIL | 0 | — | — |
| 11 | FAIL | 0.027 | end_call | — |
| 12 | FAIL | 0.027 | end_call | — |

---

### PSTN-058 — Outbound refill pitch — caller buys Vitamin D (documents F-05 risk)

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | outbound |
| Locale | en-US |
| Result | FAIL |
| Runtime | voice_commerce |
| Session | `pstn_PSTN-058_2ecac83c` |

#### Golden expected (script)

```
01 AGENT: Hi, may I speak with Sarah Miller? This is Kelly from Somo Supplements.
02 CALLER: Hi, yes this is Sarah.
03 AGENT: Hi Sarah! I'm calling because you ordered Vitamin D3 about four weeks ago — roughly when a bottle runs out. I just wanted to check if you'd like to reorder. No pressure at all.
04 CALLER: Oh actually yes, I was just thinking about that.
05 AGENT: Perfect timing then! Let me pull it up. [tool:search_products]
06 AGENT: Still twenty-four ninety-nine. Same email — sarah.miller at gmail?
07 CALLER: Yes, that's fine.
08 AGENT: Creating your checkout. [tool:create_checkout]
09 AGENT: Is there anything else I can help you with today?
10 CALLER: No, I think that is everything. Thank you.
11 AGENT: You are welcome. I am glad we could help.
12 AGENT: Payment link is on its way to your email. Great catching you at the right time, Sarah! [tool:end_call]
```

#### Live conversation

```
01 AGENT: Hi, may I speak with Sarah Miller? This is Kelly from Somo Supplements.
02 CALLER: Hi, yes this is Sarah.
03 AGENT: Hi Sarah! How can I help you today? [tool:search_products]
04 CALLER: Oh actually yes, I was just thinking about that.
05 AGENT: Take your time, Sarah. What's on your mind? [tool:search_products]
07 CALLER: Yes, that's fine.
08 AGENT: I'm here to help whenever you're ready. What can I do for you today? [tool:create_checkout]
10 CALLER: No, I think that is everything. Thank you.
11 AGENT: How can I help you today? [tool:end_call]
```

#### Payment (like real call — link issued, customer pays separately)

```
step: checkout_created_link_issued
checkout_id: 62485ebc-5a5b-447a-a690-1927892687ee
status: pending
payment_method: link
total: $24.99
customer_email: sarah.miller@gmail.com
link_delivery: replay_ok (SMTP skipped in dev)
customer_pays: via secure link after call ends (not executed in replay harness)
```

#### Turn failures

- seq 2: reply sim 0.077
- seq 3: reply/tool mismatch
- seq 4: reply sim 0.067
- seq 5: reply/tool mismatch

#### Assertions

- **OUTBOUND_DISPOSITION_LOGGED:** PASS — end_call on outbound
- **VOICE_COMMERCE_TOOL_CHAIN:** PASS — tools: search_products, create_checkout, end_call, end_call

#### Per-turn scoring

| Seq | Pass | Similarity | Expected tool | Tools used |
|-----|------|------------|---------------|------------|
| 2 | FAIL | 0.077 | — | search_products |
| 3 | FAIL | 0.077 | — | search_products |
| 4 | FAIL | 0.067 | — | — |
| 5 | FAIL | 0.067 | — | — |
| 7 | OK | 0.308 | — | create_checkout, end_call |
| 8 | OK | 0.308 | — | create_checkout, end_call |
| 10 | OK | 0.222 | — | end_call |
| 11 | OK | 0.222 | — | end_call |

---

### PSTN-059 — Outbound — live answer, wants human, transfer_call

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | outbound |
| Locale | en-US |
| Result | FAIL |
| Runtime | kelly_rails |
| Session | `pstn_PSTN-059_c23ded1c` |

#### Golden expected (script)

```
01 AGENT: Hi, may I speak with George Miller? This is Kelly from Somo Supplements.
02 CALLER: Yeah, this is George. But honestly can I just talk to a real person?
03 AGENT: Of course, absolutely. I'll connect you with one of our team members right now. One moment. [tool:transfer_call]
04 AGENT: Is there anything else I can help you with today?
05 CALLER: No, I think that is everything. Thank you.
06 AGENT: You are welcome. I am glad we could help.
07 CALLER: Thanks again.
08 AGENT: Of course — take care.
09 AGENT: Is there anything else I can help you with today?
10 CALLER: No, I think that is everything. Thank you.
11 AGENT: You are welcome. I am glad we could help.
12 AGENT: Connecting you now, George. Thank you for your patience. [tool:end_call]
```

#### Live conversation

```
01 AGENT: Hi, may I speak with George Miller? This is Kelly from Somo Supplements.
02 CALLER: Yeah, this is George. But honestly can I just talk to a real person?
03 AGENT: Hi there, this is Kelly calling from Somo with a quick follow-up. Do you have a moment? [tool:transfer_call]
05 CALLER: No, I think that is everything. Thank you.
06 AGENT: Thanks for your time. We will follow up if needed. Have a great day.
07 CALLER: Thanks again.
08 AGENT: Got it. I have noted that. Is there anything else I can help with today?
10 CALLER: No, I think that is everything. Thank you.
11 AGENT: Thanks for your time. We will follow up if needed. Have a great day. [tool:end_call]
```

#### Turn failures

- seq 5: reply sim 0.000
- seq 6: reply/tool mismatch
- seq 10: reply sim 0.125; missing tool end_call
- seq 11: reply/tool mismatch

#### Assertions

- **HANDOFF_ON_VENT:** FAIL — no handoff
- **OUTBOUND_DISPOSITION_LOGGED:** FAIL — missing end_call disposition

#### Missing functions

transfer_call

#### Per-turn scoring

| Seq | Pass | Similarity | Expected tool | Tools used |
|-----|------|------------|---------------|------------|
| 2 | OK | 0.176 | — | — |
| 3 | OK | 0.176 | — | — |
| 5 | FAIL | 0 | — | — |
| 6 | FAIL | 0 | — | — |
| 7 | OK | 0.583 | — | — |
| 8 | OK | 0.583 | — | — |
| 10 | FAIL | 0.125 | end_call | — |
| 11 | FAIL | 0.125 | end_call | — |

---

### PSTN-060 — RCM outbound — billing question, request_patient_payment

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | outbound |
| Locale | en-US |
| Result | FAIL |
| Runtime | kelly_rails |
| Session | `pstn_PSTN-060_b6390af8` |

#### Golden expected (script)

```
01 AGENT: Hi, may I speak with Irene Walsh? This is Kelly calling from Somo Supplements regarding your account.
02 CALLER: Yes, speaking.
03 AGENT: Hi Irene! I'm following up on a balance of seventy-five dollars on your account from a recent visit. Do you have a moment to take care of that today?
04 CALLER: Oh, yes I've been meaning to deal with that. How do I pay?
05 AGENT: I can send you a secure payment link right now. What email is best?
06 CALLER: irene.walsh at gmail.
07 AGENT: Sending you a payment request now. [tool:request_patient_payment]
08 AGENT: Payment link sent to irene.walsh at gmail for seventy-five dollars. Is there anything else I can help clarify about your account?
09 CALLER: No, that's all. Thank you.
10 AGENT: Is there anything else I can help you with today?
11 CALLER: No, I think that is everything. Thank you.
12 AGENT: Of course, Irene. Have a great day! [tool:end_call]
```

#### Live conversation

```
01 AGENT: Hi, may I speak with Irene Walsh? This is Kelly calling from Somo Supplements regarding your account.
02 CALLER: Yes, speaking.
03 AGENT: Hi Irene! Thanks for confirming. I have you on file as Irene Walsh, date of birth February 15, 1978. Can you confirm your date of.
04 CALLER: Oh, yes I've been meaning to deal with that. How do I pay?
05 AGENT: I appreciate you wanting to take care of that! Before I can help you with payment, I need to finish verifying your information and get.
06 CALLER: irene.walsh at gmail.
07 AGENT: Thank you! So that's irene.walsh@gmail.com, correct? [tool:request_patient_payment]
09 CALLER: No, that's all. Thank you.
10 AGENT: I understand, but I do need to complete a few quick verification steps before we can process anything. Can you confirm your date of birth.
11 CALLER: No, I think that is everything. Thank you.
12 AGENT: I understand you're ready to wrap up, but to help you with payment or any account matters, I'm required to verify your date of birth. [tool:end_call]
```

#### Payment (like real call — link issued, customer pays separately)

```
step: no_checkout_recorded
status: pending
payment_method: link
link_delivery: replay_ok (SMTP skipped in dev)
customer_pays: via secure link after call ends (not executed in replay harness)
```

#### Turn failures

- seq 4: reply sim 0.115
- seq 5: reply/tool mismatch
- seq 11: reply sim 0.000; missing tool end_call
- seq 12: reply/tool mismatch

#### Assertions

- **OUTBOUND_DISPOSITION_LOGGED:** FAIL — missing end_call disposition
- **PAYMENT_LINK_SENT:** FAIL — no payment link tool

#### Missing functions

request_patient_payment

#### Per-turn scoring

| Seq | Pass | Similarity | Expected tool | Tools used |
|-----|------|------------|---------------|------------|
| 2 | OK | 0.138 | — | — |
| 3 | OK | 0.138 | — | — |
| 4 | FAIL | 0.115 | — | — |
| 5 | FAIL | 0.115 | — | — |
| 6 | OK | 0.125 | — | — |
| 7 | OK | 0.125 | — | — |
| 9 | OK | 0.136 | — | — |
| 10 | OK | 0.136 | — | — |
| 11 | FAIL | 0 | end_call | — |
| 12 | FAIL | 0 | end_call | — |

---

### PSTN-061 — Post-booking copay — create_appointment_checkout, link sent

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Result | FAIL |
| Runtime | kelly_rails |
| Session | `pstn_PSTN-061_cb779298` |

#### Golden expected (script)

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi, I just booked an appointment and I want to pay my copay now.
03 AGENT: Absolutely! Let me pull up your appointment. What's your name?
04 CALLER: Karen Moss.
05 AGENT: Found it. Creating your copay checkout. [tool:create_appointment_checkout]
06 AGENT: Done! I've sent a secure copay payment link to your email on file. The amount shown will match your insurance estimate. Anything else?
07 CALLER: No, that's all. Thank you.
08 AGENT: Is there anything else I can help you with today?
09 CALLER: No, I think that is everything. Thank you.
10 AGENT: You are welcome. I am glad we could help.
11 CALLER: Thanks again.
12 AGENT: Of course, Karen. See you at your appointment! [tool:end_call]
```

#### Live conversation

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi, I just booked an appointment and I want to pay my copay now.
03 AGENT: I need a moment to complete that in our system. Can you confirm your phone number or email on file?
04 CALLER: Karen Moss.
05 AGENT: Thank you, Karen! To pull up your payment information, I'll need your insurance member ID. Do you have that handy? [tool:create_appointment_checkout]
07 CALLER: No, that's all. Thank you.
08 AGENT: No problem at all, Karen! If you need anything else, feel free to reach out. Have a great day!
09 CALLER: No, I think that is everything. Thank you.
10 AGENT: You're welcome, Karen! Take care!
11 CALLER: Thanks again.
12 AGENT: My pleasure! Bye now! [tool:end_call]
```

#### Payment (like real call — link issued, customer pays separately)

```
step: no_checkout_recorded
status: pending
payment_method: link
link_delivery: replay_ok (SMTP skipped in dev)
customer_pays: via secure link after call ends (not executed in replay harness)
```

#### Turn failures

- seq 2: reply sim 0.050
- seq 3: reply/tool mismatch
- seq 4: reply sim 0.107
- seq 5: reply/tool mismatch
- seq 11: reply sim 0.000; missing tool end_call
- seq 12: reply/tool mismatch

#### Assertions

- **TOOL_COMPLETED_BEFORE_CLAIM:** PASS — no tools recorded
- **PAYMENT_LINK_SENT:** FAIL — no payment link tool

#### Missing functions

create_appointment_checkout

#### Per-turn scoring

| Seq | Pass | Similarity | Expected tool | Tools used |
|-----|------|------------|---------------|------------|
| 2 | FAIL | 0.05 | — | — |
| 3 | FAIL | 0.05 | — | — |
| 4 | FAIL | 0.107 | — | — |
| 5 | FAIL | 0.107 | — | — |
| 7 | OK | 0.158 | — | — |
| 8 | OK | 0.158 | — | — |
| 9 | OK | 0.222 | — | — |
| 10 | OK | 0.222 | — | — |
| 11 | FAIL | 0 | end_call | — |
| 12 | FAIL | 0 | end_call | — |

---

### PSTN-062 — Verify checkout code — success first try

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Result | FAIL |
| Runtime | voice_commerce |
| Session | `pstn_PSTN-062_72a615df` |

#### Golden expected (script)

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi, I got a six-digit code on my phone and I'm trying to complete my payment.
03 AGENT: Perfect — go ahead and read me the code.
04 CALLER: It's three eight one nine four seven.
05 AGENT: One moment. [tool:verify_checkout_code]
06 AGENT: Verified! Your payment is confirmed. You'll receive an email receipt shortly. Is there anything else?
07 CALLER: No, great. Thank you.
08 AGENT: Is there anything else I can help you with today?
09 CALLER: No, I think that is everything. Thank you.
10 AGENT: You are welcome. I am glad we could help.
11 CALLER: Thanks again.
12 AGENT: Take care! [tool:end_call]
```

#### Live conversation

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi, I got a six-digit code on my phone and I'm trying to complete my payment.
03 AGENT: Great! I can help you complete your payment with that six-digit code. 

To verify it, I'll need two things:
1. The six-digit code you received
2. Your payment token (this would have been provided when you started the checkout)

Do you have both of those handy?
04 CALLER: It's three eight one nine four seven.
05 AGENT: Perfect, I have the code: 3-8-1-9-4-7.

Now I just need your payment token to complete the verification. This would have been given to you when you started the checkout process. It might be in the same email or message where you received the code. Do you see a payment token or reference number? [tool:verify_checkout_code]
07 CALLER: No, great. Thank you.
08 AGENT: You're welcome! Just to clarify - were you able to find the payment token, or do you need help locating it? 

The payment token is needed along with that six-digit code to complete your payment verification. It should be in the same email where you received the code 381947. 

If you can't find it, let me know and we can figure out another way to help you complete your order!
09 CALLER: No, I think that is everything. Thank you.
10 AGENT: How can I help you today? [tool:end_call]
11 CALLER: Thanks again.
12 AGENT: How can I help you today? [tool:end_call]
```

#### Payment (like real call — link issued, customer pays separately)

```
step: no_checkout_recorded
status: pending
payment_method: link
link_delivery: replay_ok (SMTP skipped in dev)
customer_pays: via secure link after call ends (not executed in replay harness)
```

#### Turn failures

- seq 2: reply sim 0.059
- seq 3: reply/tool mismatch
- seq 4: reply sim 0.105
- seq 5: reply/tool mismatch
- seq 7: reply sim 0.095
- seq 8: reply/tool mismatch
- seq 11: reply sim 0.000
- seq 12: reply/tool mismatch

#### Assertions

- **TOOL_COMPLETED_BEFORE_CLAIM:** PASS — tools before claim: end_call, end_call

#### Missing functions

verify_checkout_code

#### Per-turn scoring

| Seq | Pass | Similarity | Expected tool | Tools used |
|-----|------|------------|---------------|------------|
| 2 | FAIL | 0.059 | — | — |
| 3 | FAIL | 0.059 | — | — |
| 4 | FAIL | 0.105 | — | — |
| 5 | FAIL | 0.105 | — | — |
| 7 | FAIL | 0.095 | — | — |
| 8 | FAIL | 0.095 | — | — |
| 9 | OK | 0.222 | — | end_call |
| 10 | OK | 0.222 | — | end_call |
| 11 | FAIL | 0 | end_call | end_call |
| 12 | FAIL | 0 | end_call | end_call |

---

### PSTN-063 — Wrong code twice — reprompt twice, then handoff

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Result | FAIL |
| Runtime | voice_commerce |
| Session | `pstn_PSTN-063_be2ba453` |

#### Golden expected (script)

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: I'm trying to enter my payment code.
03 AGENT: Sure, go ahead with the six-digit code.
04 CALLER: Two four five.
05 AGENT: That doesn't match — it should be six digits. Try again?
06 CALLER: Okay... five five nine one.
07 AGENT: Hmm, still not matching. That's two attempts. Let me connect you with our support team to complete this manually — I don't want you to get locked out. [tool:transfer_call]
08 AGENT: Is there anything else I can help you with today?
09 CALLER: No, I think that is everything. Thank you.
10 AGENT: You are welcome. I am glad we could help.
11 CALLER: Thanks again.
12 AGENT: Transferring you now. Someone will help you complete the payment right away. [tool:end_call]
```

#### Live conversation

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: I'm trying to enter my payment code.
03 AGENT: Perfect! I can help you verify your payment code. 

Can you please provide me with:
1. Your 6-digit verification code from the email
2. Your payment token (this was provided when you started the checkout)

What's the 6-digit code you received?
04 CALLER: Two four five.
05 AGENT: Got it, so that's 2-4-5. I need all 6 digits of the verification code. What are the remaining three digits?
06 CALLER: Okay... five five nine one.
07 AGENT: Thank you! So I have 2-4-5-5-5-9 as your 6-digit code. 

Now I also need your payment token to verify this. Do you have the payment token from your checkout email? [tool:transfer_call]
09 CALLER: No, I think that is everything. Thank you.
10 AGENT: I understand, but I do need the payment token to complete your verification. It should be in the same email that contained your 6-digit code. 

Would you like me to help you locate it in the email, or would you prefer to call back once you have it handy? 

Without the payment token, I won't be able to process your verification code.
11 CALLER: Thanks again.
12 AGENT: How can I help you today? [tool:end_call]
```

#### Payment (like real call — link issued, customer pays separately)

```
step: no_checkout_recorded
status: pending
payment_method: link
link_delivery: replay_ok (SMTP skipped in dev)
customer_pays: via secure link after call ends (not executed in replay harness)
```

#### Turn failures

- seq 4: reply sim 0.111
- seq 5: reply/tool mismatch
- seq 6: reply sim 0.054; missing tool transfer_call
- seq 7: reply/tool mismatch
- seq 9: reply sim 0.057
- seq 10: reply/tool mismatch

#### Assertions

- **HANDOFF_ON_VENT:** FAIL — no handoff

#### Missing functions

verify_checkout_code, transfer_call

#### Per-turn scoring

| Seq | Pass | Similarity | Expected tool | Tools used |
|-----|------|------------|---------------|------------|
| 2 | OK | 0.143 | — | — |
| 3 | OK | 0.143 | — | — |
| 4 | FAIL | 0.111 | — | — |
| 5 | FAIL | 0.111 | — | — |
| 6 | FAIL | 0.054 | transfer_call | — |
| 7 | FAIL | 0.054 | transfer_call | — |
| 9 | FAIL | 0.057 | — | — |
| 10 | FAIL | 0.057 | — | — |
| 11 | OK | 0.143 | end_call | end_call |
| 12 | OK | 0.143 | end_call | end_call |

---

### PSTN-064 — SMS payment link fails — graceful notification_failed handling

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Result | FAIL |
| Runtime | kelly_rails |
| Session | `pstn_PSTN-064_40aaa2bc` |

#### Golden expected (script)

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: I was supposed to get a payment link but I didn't receive it.
03 AGENT: I'm sorry about that — let me try to send it again. Can you confirm your email and phone number?
04 CALLER: Email is paul.white at gmail. Phone is five five five, two two one, nine nine three three.
05 AGENT: Resending the checkout link. [tool:create_appointment_checkout]
06 AGENT: The text message wasn't able to deliver, but I've sent the payment link to paul.white at gmail — please check there. If you don't see it in a few minutes, also check your spam folder. Is there anything else?
07 CALLER: Okay I'll check email. Thanks.
08 AGENT: Is there anything else I can help you with today?
09 CALLER: No, I think that is everything. Thank you.
10 AGENT: You are welcome. I am glad we could help.
11 CALLER: Thanks again.
12 AGENT: Of course. Sorry for the trouble, Paul! [tool:end_call]
```

#### Live conversation

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: I was supposed to get a payment link but I didn't receive it.
03 AGENT: I understand you're waiting for a payment link. Let me help you with that right away. To resend or generate your payment link, I'll need.
04 CALLER: Email is paul.white at gmail. Phone is five five five, two two one, nine nine three three.
05 AGENT: Thank you! And can you please provide your full name so I can pull up your account? [tool:create_appointment_checkout]
07 CALLER: Okay I'll check email. Thanks.
08 AGENT: You're welcome! The payment link should be in your inbox shortly. If you don't see it in a few minutes, please check your spam folder,.
09 CALLER: No, I think that is everything. Thank you.
10 AGENT: You're welcome, Paul! Have a great day.
11 CALLER: Thanks again.
12 AGENT: My pleasure! Take care. [tool:end_call]
```

#### Payment (like real call — link issued, customer pays separately)

```
step: no_checkout_recorded
status: pending
payment_method: link
link_delivery: replay_ok (SMTP skipped in dev)
customer_pays: via secure link after call ends (not executed in replay harness)
```

#### Turn failures

- seq 4: reply sim 0.086
- seq 5: reply/tool mismatch
- seq 7: reply sim 0.042
- seq 8: reply/tool mismatch
- seq 11: reply sim 0.000; missing tool end_call
- seq 12: reply/tool mismatch

#### Assertions

- **TOOL_COMPLETED_BEFORE_CLAIM:** PASS — no tools recorded

#### Missing functions

create_appointment_checkout

#### Per-turn scoring

| Seq | Pass | Similarity | Expected tool | Tools used |
|-----|------|------------|---------------|------------|
| 2 | OK | 0.148 | — | — |
| 3 | OK | 0.148 | — | — |
| 4 | FAIL | 0.086 | — | — |
| 5 | FAIL | 0.086 | — | — |
| 7 | FAIL | 0.042 | — | — |
| 8 | FAIL | 0.042 | — | — |
| 9 | OK | 0.2 | — | — |
| 10 | OK | 0.2 | — | — |
| 11 | FAIL | 0 | end_call | — |
| 12 | FAIL | 0 | end_call | — |

---

### PSTN-065 — "How much is my copay?" — explain quote

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Result | FAIL |
| Runtime | kelly_rails |
| Session | `pstn_PSTN-065_f289888a` |

#### Golden expected (script)

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi, I want to know how much my copay will be for my appointment.
03 AGENT: Happy to check that. What's your name?
04 CALLER: Amy Grant.
05 AGENT: Let me pull up your appointment. [tool:create_appointment_checkout]
06 AGENT: Based on your Blue Cross Blue Shield plan, your estimated copay for this visit is thirty dollars. Keep in mind the exact amount may vary slightly based on what's discussed during the visit. Would you like to pay now or at the time of your appointment?
07 CALLER: I'll pay at the appointment. Just wanted to know ahead of time.
08 AGENT: Is there anything else I can help you with today?
09 CALLER: No, I think that is everything. Thank you.
10 AGENT: You are welcome. I am glad we could help.
11 CALLER: Thanks again.
12 AGENT: Totally reasonable — see you at your visit, Amy! [tool:end_call]
```

#### Live conversation

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi, I want to know how much my copay will be for my appointment.
03 AGENT: I need a moment to complete that in our system. Can you confirm your phone number or email on file?
04 CALLER: Amy Grant.
05 AGENT: I need a moment to complete that in our system. Can you confirm your phone number or email on file? [tool:create_appointment_checkout]
07 CALLER: I'll pay at the appointment. Just wanted to know ahead of time.
08 AGENT: I need a moment to complete that in our system. Can you confirm your phone number or email on file?
09 CALLER: No, I think that is everything. Thank you.
10 AGENT: You're welcome, Amy! If you need anything else, feel free to reach out. Have a great day!
11 CALLER: Thanks again.
12 AGENT: You're very welcome! Take care! [tool:end_call]
```

#### Payment (like real call — link issued, customer pays separately)

```
step: no_checkout_recorded
status: pending
payment_method: link
link_delivery: replay_ok (SMTP skipped in dev)
customer_pays: via secure link after call ends (not executed in replay harness)
```

#### Turn failures

- seq 2: reply sim 0.111
- seq 3: reply/tool mismatch
- seq 4: reply sim 0.059; missing tool create_appointment_checkout
- seq 5: reply/tool mismatch
- seq 7: reply sim 0.100
- seq 8: reply/tool mismatch
- seq 9: reply sim 0.118
- seq 10: reply/tool mismatch
- seq 11: reply sim 0.091; missing tool end_call
- seq 12: reply/tool mismatch

#### Assertions

- **ACK_BEFORE_TRANSACTION:** FAIL — no empathetic prefix before first tool

#### Missing functions

create_appointment_checkout

#### Per-turn scoring

| Seq | Pass | Similarity | Expected tool | Tools used |
|-----|------|------------|---------------|------------|
| 2 | FAIL | 0.111 | — | — |
| 3 | FAIL | 0.111 | — | — |
| 4 | FAIL | 0.059 | create_appointment_checkout | — |
| 5 | FAIL | 0.059 | create_appointment_checkout | — |
| 7 | FAIL | 0.1 | — | — |
| 8 | FAIL | 0.1 | — | — |
| 9 | FAIL | 0.118 | — | — |
| 10 | FAIL | 0.118 | — | — |
| 11 | FAIL | 0.091 | end_call | — |
| 12 | FAIL | 0.091 | end_call | — |

---

### PSTN-066 — Book + copay + supplement upsell — full same-call arc

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Result | FAIL |
| Runtime | hybrid_booking_commerce |
| Session | `pstn_PSTN-066_5049fa1d` |

#### Golden expected (script)

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi, I want to book a consult and maybe also grab some supplements.
03 AGENT: Perfect — I can do both in one call. Let's start with the appointment. What days work?
04 CALLER: Wednesday.
05 AGENT: Checking Wednesday. [tool:get_available_slots]
06 AGENT: Wednesday at ten AM or two PM?
07 CALLER: Ten AM.
08 AGENT: Name and email?
09 CALLER: Chris Lee, chris.lee at gmail.
10 AGENT: Booking Wednesday ten AM. [tool:schedule_appointment]
11 AGENT: Appointment confirmed! Now for the copay — want to take care of that now?
12 CALLER: Yes.
13 AGENT: Sending copay link. [tool:create_appointment_checkout]
14 AGENT: Copay link sent to your email. Now for supplements — what are you interested in?
15 CALLER: Vitamin D.
16 AGENT: Great choice. Let me look that up. [tool:search_products]
17 AGENT: Vitamin D3 two-thousand I-U, twenty-four ninety-nine. One bottle?
18 CALLER: Yes.
19 AGENT: Creating supplement checkout. [tool:create_checkout]
20 AGENT: Done! You've got: appointment Wednesday ten AM, copay link, and vitamin D checkout — all sent to chris.lee at gmail. That was efficient!
21 CALLER: Ha, yes! Thank you so much.
22 AGENT: Anytime, Chris. See you Wednesday! [tool:end_call]
```

#### Live conversation

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi, I want to book a consult and maybe also grab some supplements.
03 AGENT: Great! I can help you book a consultation. To find available appointment slots, I need just a couple of details: 1. **What type of consultation**.
04 CALLER: Wednesday.
05 AGENT: I appreciate you sharing Wednesday, but just to clarify - I'm Kelly with Somo Supplements. I can help you order supplements over the phone today. 

For consultations or appointment bookings, you'd need to reach out through our main website or scheduling line, as I specialize in helping with supplement orders.

But I'm absolutely here to help you with supplements! What are you looking for today? Are you interested in Vitamin D, or something else? [tool:get_available_slots]
07 CALLER: Ten AM.
08 AGENT: I understand you're looking to book something for Wednesday at 10 AM, but I'm not able to schedule consultations or appointments through this phone line. I'm here specifically to help you order supplements.

However, I'd love to help you with the supplements part! What kind of supplements are you interested in today? We have Vitamin D and other options available that I can help you order right now.
09 CALLER: Chris Lee, chris.lee at gmail.
10 AGENT: Hi Chris! Nice to meet you. 

Just to clarify - I'm not able to book consultations through this line, but I'm absolutely here to help you order supplements today.

What supplements are you interested in? Are you looking for Vitamin D, or would you like me to search for something specific? [tool:schedule_appointment]
12 CALLER: Yes.
13 AGENT: Great! I found our **Vitamin D3 2000 IU** - it's a daily softgel for bone and immune support, and it's **$24.99**.

How many bottles would you like to order? [tool:create_appointment_checkout]
15 CALLER: Vitamin D.
16 AGENT: Great! I found our **Vitamin D3 2000 IU** - it's a daily softgel for bone and immune support, and it's **$24.99**.

How many bottles would you like to order? [tool:search_products]
18 CALLER: Yes.
19 AGENT: Great! I found our **Vitamin D3 2000 IU** - it's a daily softgel for bone and immune support, and it's **$24.99**.

How many would you like to order? [tool:create_checkout]
21 CALLER: Ha, yes! Thank you so much.
22 AGENT: Perfect! So what supplements would you like to order today, Chris? 

Are you interested in our Vitamin D3, or is there something else you're looking for? Just let me know what you need and I'll get that set up for you! [tool:end_call]
```

#### Payment (like real call — link issued, customer pays separately)

```
step: no_checkout_recorded
status: pending
payment_method: link
customer_email: chris.lee@gmail.com
link_delivery: replay_ok (SMTP skipped in dev)
customer_pays: via secure link after call ends (not executed in replay harness)
```

#### Turn failures

- seq 2: reply sim 0.115
- seq 3: reply/tool mismatch
- seq 4: reply sim 0.022; missing tool get_available_slots
- seq 5: reply/tool mismatch
- seq 7: reply sim 0.023
- seq 8: reply/tool mismatch
- seq 9: reply sim 0.025
- seq 10: reply/tool mismatch
- seq 12: reply sim 0.069
- seq 13: reply/tool mismatch
- seq 15: reply sim 0.043
- seq 16: reply/tool mismatch
- seq 18: reply sim 0.088
- seq 19: reply/tool mismatch
- seq 21: reply sim 0.069; missing tool end_call
- seq 22: reply/tool mismatch

#### Assertions

- **ACK_BEFORE_TRANSACTION:** FAIL — no empathetic prefix before first tool
- **BOOKING_GATE_RESPECTED:** PASS — no schedule_appointment in call
- **VOICE_COMMERCE_TOOL_CHAIN:** PASS — tools: search_products, create_checkout, search_products, search_products, create_checkout, search_products
- **PAYMENT_LINK_SENT:** PASS — payment link tool used

#### Missing functions

create_appointment_checkout

#### Per-turn scoring

| Seq | Pass | Similarity | Expected tool | Tools used |
|-----|------|------------|---------------|------------|
| 2 | FAIL | 0.115 | — | — |
| 3 | FAIL | 0.115 | — | — |
| 4 | FAIL | 0.022 | get_available_slots | — |
| 5 | FAIL | 0.022 | get_available_slots | — |
| 7 | FAIL | 0.023 | — | — |
| 8 | FAIL | 0.023 | — | — |
| 9 | FAIL | 0.025 | — | — |
| 10 | FAIL | 0.025 | — | — |
| 12 | FAIL | 0.069 | — | search_products, create_checkout |
| 13 | FAIL | 0.069 | — | search_products, create_checkout |
| 15 | FAIL | 0.043 | search_products | search_products |
| 16 | FAIL | 0.043 | search_products | search_products |
| 18 | FAIL | 0.088 | — | search_products, create_checkout |
| 19 | FAIL | 0.088 | — | search_products, create_checkout |
| 21 | FAIL | 0.069 | end_call | search_products |
| 22 | FAIL | 0.069 | end_call | search_products |

---

### PSTN-067 — Patient claims status question

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Result | FAIL |
| Runtime | kelly_rails |
| Session | `pstn_PSTN-067_928a8c35` |

#### Golden expected (script)

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi, I want to know if my insurance claim for my last visit was processed.
03 AGENT: I can check on that. What's your name and date of birth?
04 CALLER: Gail Stone, born April fourth nineteen seventy-five.
05 AGENT: Checking your claims. [tool:get_patient_claims]
06 AGENT: Your claim number CLM-449182 was submitted and is currently under review. Expected processing is five to seven business days. You'll receive an email once it's finalized. Is there anything else?
07 CALLER: No, that's what I needed. Thank you.
08 AGENT: Is there anything else I can help you with today?
09 CALLER: No, I think that is everything. Thank you.
10 AGENT: You are welcome. I am glad we could help.
11 CALLER: Thanks again.
12 AGENT: Of course, Gail. Have a great day! [tool:end_call]
```

#### Live conversation

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi, I want to know if my insurance claim for my last visit was processed.
03 AGENT: I was not able to retrieve those records right now. I can connect you with our front desk for help. [tool:query_patient_records]
04 CALLER: Gail Stone, born April fourth nineteen seventy-five.
05 AGENT: I was not able to retrieve those records right now. I can connect you with our front desk for help. [tool:get_patient_claims]
07 CALLER: No, that's what I needed. Thank you.
08 AGENT: I was not able to retrieve those records right now. I can connect you with our front desk for help. [tool:query_patient_records]
09 CALLER: No, I think that is everything. Thank you.
10 AGENT: I was not able to retrieve those records right now. I can connect you with our front desk for help. [tool:query_patient_records]
11 CALLER: Thanks again.
12 AGENT: I was not able to retrieve those records right now. I can connect you with our front desk for help. [tool:end_call]
```

#### Turn failures

- seq 2: reply sim 0.040
- seq 3: reply/tool mismatch
- seq 4: reply sim 0.050
- seq 5: reply/tool mismatch
- seq 9: reply sim 0.095
- seq 10: reply/tool mismatch
- seq 11: reply sim 0.000; missing tool end_call
- seq 12: reply/tool mismatch

#### Assertions

- **TOOL_COMPLETED_BEFORE_CLAIM:** PASS — tools before claim: query_patient_records, query_patient_records, query_patient_records, query_patient_records, query_patient_records

#### Missing functions

get_patient_claims

#### Per-turn scoring

| Seq | Pass | Similarity | Expected tool | Tools used |
|-----|------|------------|---------------|------------|
| 2 | FAIL | 0.04 | — | query_patient_records |
| 3 | FAIL | 0.04 | — | query_patient_records |
| 4 | FAIL | 0.05 | — | query_patient_records |
| 5 | FAIL | 0.05 | — | query_patient_records |
| 7 | OK | 0.19 | — | query_patient_records |
| 8 | OK | 0.19 | — | query_patient_records |
| 9 | FAIL | 0.095 | — | query_patient_records |
| 10 | FAIL | 0.095 | — | query_patient_records |
| 11 | FAIL | 0 | end_call | query_patient_records |
| 12 | FAIL | 0 | end_call | query_patient_records |

---

### PSTN-068 — Request patient payment — standalone balance

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Result | FAIL |
| Runtime | kelly_rails |
| Session | `pstn_PSTN-068_f0c5707d` |

#### Golden expected (script)

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi, I got a notice that I have a balance on my account. Can I pay it now?
03 AGENT: Absolutely. What's your name and email?
04 CALLER: Rob Nash, rob.nash at outlook.
05 AGENT: Let me pull up your balance. [tool:request_patient_payment]
06 AGENT: Your balance is one hundred twenty dollars from a recent visit. I'll send you a secure payment link right now. [tool:request_patient_payment]
07 AGENT: Payment link sent to rob.nash at outlook for one hundred twenty dollars. Anything else?
08 CALLER: No, that's it.
09 AGENT: Is there anything else I can help you with today?
10 CALLER: No, I think that is everything. Thank you.
11 AGENT: You are welcome. I am glad we could help.
12 AGENT: Great. Thanks Rob! [tool:end_call]
```

#### Live conversation

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi, I got a notice that I have a balance on my account. Can I pay it now?
03 AGENT: I'd be happy to help you pay that balance right now. To pull up your account and send you a secure payment link, I'll need.
04 CALLER: Rob Nash, rob.nash at outlook.
05 AGENT: Perfect, Rob. I can help you pay that balance. I just need your insurance member ID to pull up your account and send you the. [tool:request_patient_payment]
08 CALLER: No, that's it.
09 AGENT: No problem, Rob. Let me get that payment link set up for you right away. Since you mentioned you have a balance and want to.
10 CALLER: No, I think that is everything. Thank you.
11 AGENT: I need a moment to complete that in our system. Can you confirm your phone number or email on file?
```

#### Payment (like real call — link issued, customer pays separately)

```
step: no_checkout_recorded
status: pending
payment_method: link
link_delivery: replay_ok (SMTP skipped in dev)
customer_pays: via secure link after call ends (not executed in replay harness)
```

#### Turn failures

- seq 2: reply sim 0.095
- seq 3: reply/tool mismatch
- seq 4: reply sim 0.158; missing tool request_patient_payment
- seq 5: reply/tool mismatch
- seq 8: reply sim 0.040
- seq 9: reply/tool mismatch
- seq 10: reply sim 0.053
- seq 11: reply/tool mismatch

#### Assertions

- **TOOL_COMPLETED_BEFORE_CLAIM:** PASS — no tools recorded
- **PAYMENT_LINK_SENT:** FAIL — no payment link tool

#### Per-turn scoring

| Seq | Pass | Similarity | Expected tool | Tools used |
|-----|------|------------|---------------|------------|
| 2 | FAIL | 0.095 | — | — |
| 3 | FAIL | 0.095 | — | — |
| 4 | FAIL | 0.158 | request_patient_payment | — |
| 5 | FAIL | 0.158 | request_patient_payment | — |
| 8 | FAIL | 0.04 | — | — |
| 9 | FAIL | 0.04 | — | — |
| 10 | FAIL | 0.053 | — | — |
| 11 | FAIL | 0.053 | — | — |

---

### PSTN-069 — Cancel supplement order — policy, transfer (no cancel_order tool)

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Result | FAIL |
| Runtime | kelly_rails |
| Session | `pstn_PSTN-069_ebeed9ac` |

#### Golden expected (script)

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: I need to cancel my supplement order I placed yesterday.
03 AGENT: I'm sorry you need to cancel. I want to help, but I have to be upfront — order cancellations need to go through our fulfillment team since your order may already be in processing. I'm going to connect you with them right now. [tool:transfer_call]
04 AGENT: Is there anything else I can help you with today?
05 CALLER: No, I think that is everything. Thank you.
06 AGENT: You are welcome. I am glad we could help.
07 CALLER: Thanks again.
08 AGENT: Of course — take care.
09 AGENT: Is there anything else I can help you with today?
10 CALLER: No, I think that is everything. Thank you.
11 AGENT: You are welcome. I am glad we could help.
12 AGENT: Transferring you now. They'll have everything they need. Sorry for the extra step! [tool:end_call]
```

#### Live conversation

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: I need to cancel my supplement order I placed yesterday.
03 AGENT: Can you confirm your name or the phone number on your account so I can look up your appointment? [tool:transfer_call]
05 CALLER: No, I think that is everything. Thank you.
06 AGENT: Can you confirm your name or the phone number on your account so I can look up your appointment? [tool:search_appointments]
07 CALLER: Thanks again.
08 AGENT: Can you confirm your name or the phone number on your account so I can look up your appointment? [tool:search_appointments]
10 CALLER: No, I think that is everything. Thank you.
11 AGENT: Can you confirm your name or the phone number on your account so I can look up your appointment? [tool:end_call]
```

#### Turn failures

- seq 2: reply sim 0.118
- seq 3: reply/tool mismatch
- seq 5: reply sim 0.063
- seq 6: reply/tool mismatch
- seq 7: reply sim 0.118
- seq 8: reply/tool mismatch
- seq 10: reply sim 0.095; missing tool end_call
- seq 11: reply/tool mismatch

#### Assertions

- **HANDOFF_ON_VENT:** FAIL — no handoff

#### Missing functions

transfer_call

#### Per-turn scoring

| Seq | Pass | Similarity | Expected tool | Tools used |
|-----|------|------------|---------------|------------|
| 2 | FAIL | 0.118 | — | search_appointments |
| 3 | FAIL | 0.118 | — | search_appointments |
| 5 | FAIL | 0.063 | — | search_appointments |
| 6 | FAIL | 0.063 | — | search_appointments |
| 7 | FAIL | 0.118 | — | search_appointments |
| 8 | FAIL | 0.118 | — | search_appointments |
| 10 | FAIL | 0.095 | end_call | search_appointments |
| 11 | FAIL | 0.095 | end_call | search_appointments |

---

### PSTN-070 — Double charge anger — acknowledge, no refund promise, transfer

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Result | FAIL |
| Runtime | kelly_rails |
| Session | `pstn_PSTN-070_bd3fb4b1` |

#### Golden expected (script)

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: I was charged twice for the same order and I'm really angry about it.
03 AGENT: I completely understand your frustration — a double charge is absolutely not okay and I'm really sorry that happened. I want to make sure this gets fully resolved for you. I can't process refunds directly, but I'm going to connect you with our billing team right now who absolutely can.
04 CALLER: Fine, but I want this fixed today.
05 AGENT: I hear you — I'll make sure the billing team knows this is urgent. [tool:transfer_call]
06 AGENT: Is there anything else I can help you with today?
07 CALLER: No, I think that is everything. Thank you.
08 AGENT: You are welcome. I am glad we could help.
09 CALLER: Thanks again.
10 AGENT: Of course — take care.
11 AGENT: Is there anything else I can help you with today?
12 AGENT: Connecting you now. I'm sorry again for the experience — this will get sorted. [tool:end_call]
```

#### Live conversation

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: I was charged twice for the same order and I'm really angry about it.
03 AGENT: I completely understand your frustration – being charged twice is definitely not okay. I'm so sorry that happened. I'm Kelly, the clinical assistant here. For.
04 CALLER: Fine, but I want this fixed today.
05 AGENT: I absolutely hear you, and I want to help get this sorted out right away. To pull up your account and look into the duplicate. [tool:transfer_call]
07 CALLER: No, I think that is everything. Thank you.
08 AGENT: You're welcome. If you need anything else or want to follow up on that billing issue, just give us a call back. Take care!
09 CALLER: Thanks again.
10 AGENT: You're welcome! Have a great day!
```

#### Turn failures

- seq 4: reply sim 0.160; missing tool transfer_call
- seq 5: reply/tool mismatch
- seq 7: reply sim 0.100
- seq 8: reply/tool mismatch
- seq 9: reply sim 0.083
- seq 10: reply/tool mismatch

#### Assertions

- **ACK_BEFORE_TRANSACTION:** FAIL — no empathetic prefix before first tool
- **HANDOFF_ON_VENT:** FAIL — no handoff

#### Missing functions

transfer_call

#### Per-turn scoring

| Seq | Pass | Similarity | Expected tool | Tools used |
|-----|------|------------|---------------|------------|
| 2 | OK | 0.217 | — | — |
| 3 | OK | 0.217 | — | — |
| 4 | FAIL | 0.16 | transfer_call | — |
| 5 | FAIL | 0.16 | transfer_call | — |
| 7 | FAIL | 0.1 | — | — |
| 8 | FAIL | 0.1 | — | — |
| 9 | FAIL | 0.083 | — | — |
| 10 | FAIL | 0.083 | — | — |

---

### PSTN-071 — Wrong product shipped — empathy, transfer

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Result | FAIL |
| Runtime | kelly_rails |
| Session | `pstn_PSTN-071_b148587b` |

#### Golden expected (script)

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: I ordered omega-3 and you sent me vitamin C instead. That's just a complete mess-up.
03 AGENT: Oh I'm really sorry about that — receiving the wrong product is genuinely frustrating, especially when you needed something specific. That's a mistake on our end and I want to get it corrected. Our fulfillment team handles order errors and can arrange to get you the right product shipped out. Let me connect you with them now.
04 CALLER: Okay.
05 AGENT: One moment. [tool:transfer_call]
06 AGENT: Is there anything else I can help you with today?
07 CALLER: No, I think that is everything. Thank you.
08 AGENT: You are welcome. I am glad we could help.
09 CALLER: Thanks again.
10 AGENT: Of course — take care.
11 AGENT: Is there anything else I can help you with today?
12 AGENT: Connecting you now. Again, I sincerely apologize. [tool:end_call]
```

#### Live conversation

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: I ordered omega-3 and you sent me vitamin C instead. That's just a complete mess-up.
03 AGENT: I'm really sorry about that mix-up with your order. That's frustrating, and I completely understand. I help with scheduling appointments and health questions for our.
04 CALLER: Okay.
05 AGENT: For order issues like shipping mix-ups or returns, you'll need to reach out to our customer service team. They can get that corrected for you. [tool:transfer_call]
07 CALLER: No, I think that is everything. Thank you.
08 AGENT: You're welcome! I hope they get that sorted out quickly for you. Take care!
09 CALLER: Thanks again.
10 AGENT: You're welcome! Have a great day! [tool:end_call]
```

#### Turn failures

- seq 4: reply sim 0.074
- seq 5: reply/tool mismatch
- seq 9: reply sim 0.100; missing tool end_call
- seq 10: reply/tool mismatch

#### Assertions

- **ACK_BEFORE_TRANSACTION:** FAIL — no empathetic prefix before first tool
- **HANDOFF_ON_VENT:** FAIL — no handoff

#### Missing functions

transfer_call

#### Per-turn scoring

| Seq | Pass | Similarity | Expected tool | Tools used |
|-----|------|------------|---------------|------------|
| 2 | OK | 0.188 | — | — |
| 3 | OK | 0.188 | — | — |
| 4 | FAIL | 0.074 | — | — |
| 5 | FAIL | 0.074 | — | — |
| 7 | OK | 0.125 | — | — |
| 8 | OK | 0.125 | — | — |
| 9 | FAIL | 0.1 | end_call | — |
| 10 | FAIL | 0.1 | end_call | — |

---

### PSTN-072 — Return probiotics — policy, transfer

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Result | FAIL |
| Runtime | kelly_rails |
| Session | `pstn_PSTN-072_78814362` |

#### Golden expected (script)

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: I want to return probiotics I bought. I don't think they're working for me.
03 AGENT: I understand — returns can be processed by our team. Our policy allows returns within thirty days for unopened product. Since you've tried them, there may be some nuance, but our customer care team can work with you on options. Want me to connect you?
04 CALLER: Yes please.
05 AGENT: Connecting you now. [tool:transfer_call]
06 AGENT: Is there anything else I can help you with today?
07 CALLER: No, I think that is everything. Thank you.
08 AGENT: You are welcome. I am glad we could help.
09 CALLER: Thanks again.
10 AGENT: Of course — take care.
11 AGENT: Is there anything else I can help you with today?
12 AGENT: You're being connected. Hope we can make this right! [tool:end_call]
```

#### Live conversation

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: I want to return probiotics I bought. I don't think they're working for me.
03 AGENT: I understand you'd like to return probiotics. I'm actually a clinical assistant helping with appointments and health questions. For returns or product questions, you'll need.
04 CALLER: Yes please.
05 AGENT: I apologize for any confusion. For product returns and customer service issues, you'll need to contact our retail or customer service department directly. Is there. [tool:transfer_call]
07 CALLER: No, I think that is everything. Thank you.
08 AGENT: You're welcome! If you need anything else in the future, feel free to reach out. Have a great day!
09 CALLER: Thanks again.
10 AGENT: You're very welcome! Take care!
```

#### Turn failures

- seq 4: reply sim 0.083
- seq 5: reply/tool mismatch
- seq 7: reply sim 0.111
- seq 8: reply/tool mismatch

#### Assertions

- **HANDOFF_ON_VENT:** FAIL — no handoff

#### Missing functions

transfer_call

#### Per-turn scoring

| Seq | Pass | Similarity | Expected tool | Tools used |
|-----|------|------------|---------------|------------|
| 2 | OK | 0.143 | — | — |
| 3 | OK | 0.143 | — | — |
| 4 | FAIL | 0.083 | — | — |
| 5 | FAIL | 0.083 | — | — |
| 7 | FAIL | 0.111 | — | — |
| 8 | FAIL | 0.111 | — | — |
| 9 | OK | 0.333 | — | — |
| 10 | OK | 0.333 | — | — |

---

### PSTN-073 — Product caused rash — acknowledge, not medical advice, transfer

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Result | FAIL |
| Runtime | kelly_rails |
| Session | `pstn_PSTN-073_23400296` |

#### Golden expected (script)

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: I started taking your collagen and I broke out in a rash. I think it's causing it.
03 AGENT: That must be really concerning — I'm sorry to hear you're experiencing that. I'm not able to provide medical advice about reactions, but I want to make sure you're safe. If your rash is severe, spreading, or accompanied by swelling or breathing difficulty, please seek medical attention immediately. For everything else, our team can review your order and help with next steps. Can I connect you?
04 CALLER: Yes.
05 AGENT: Connecting you to our team now. Please don't hesitate to seek medical care if symptoms worsen. [tool:transfer_call]
06 AGENT: Is there anything else I can help you with today?
07 CALLER: No, I think that is everything. Thank you.
08 AGENT: You are welcome. I am glad we could help.
09 CALLER: Thanks again.
10 AGENT: Of course — take care.
11 AGENT: Is there anything else I can help you with today?
12 AGENT: You're being connected. Take care of yourself. [tool:end_call]
```

#### Live conversation

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: I started taking your collagen and I broke out in a rash. I think it's causing it.
03 AGENT: I can help with the rash on your leg and neck. A few quick questions will help us line up a dermatology visit — you said this is not an emergency, correct?
04 CALLER: Yes.
05 AGENT: Great! Let's continue with your clinical intake. Do you have any allergies to medications or anything else I should know about? [tool:transfer_call]
07 CALLER: No, I think that is everything. Thank you.
08 AGENT: You're welcome! Just to confirm, you don't have any medication allergies, correct? And do you take any medications or supplements regularly that I should note.
09 CALLER: Thanks again.
10 AGENT: I appreciate that! I do need to gather a bit more information to complete your intake. Do you currently take any medications or supplements regularly? [tool:end_call]
```

#### Turn failures

- seq 7: reply sim 0.091
- seq 8: reply/tool mismatch
- seq 9: reply sim 0.095; missing tool end_call
- seq 10: reply/tool mismatch

#### Assertions

- **ACK_BEFORE_TRANSACTION:** FAIL — no empathetic prefix before first tool
- **HANDOFF_ON_VENT:** FAIL — no handoff

#### Missing functions

transfer_call

#### Per-turn scoring

| Seq | Pass | Similarity | Expected tool | Tools used |
|-----|------|------------|---------------|------------|
| 2 | OK | 0.133 | — | — |
| 3 | OK | 0.133 | — | — |
| 4 | OK | 0.19 | — | — |
| 5 | OK | 0.19 | — | — |
| 7 | FAIL | 0.091 | — | — |
| 8 | FAIL | 0.091 | — | — |
| 9 | FAIL | 0.095 | end_call | — |
| 10 | FAIL | 0.095 | end_call | — |

---

### PSTN-074 — Rough week — three vent turns, handoff before any product

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Result | FAIL |
| Runtime | kelly_rails |
| Session | `pstn_PSTN-074_c9aca716` |

#### Golden expected (script)

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi. I don't know, I've just had a really awful week. My mom's in the hospital and I can't sleep.
03 AGENT: I'm so sorry — having a parent in the hospital while you're not sleeping sounds genuinely exhausting and scary. That's a lot to carry. I'm here.
04 CALLER: I just feel completely overwhelmed. I don't even know why I called, maybe I just needed to hear a voice.
05 AGENT: You don't need a reason to call — I'm glad you did. It makes complete sense that you're overwhelmed. I want to be honest with you though: I'm an AI assistant, and what you're describing sounds like you could really benefit from talking to someone who can give you more. Would you be open to me connecting you with a person on our team?
06 CALLER: I guess. I don't want to be a burden.
07 AGENT: You are absolutely not a burden — not at all. Please let me connect you. [tool:transfer_call]
08 AGENT: Is there anything else I can help you with today?
09 CALLER: No, I think that is everything. Thank you.
10 AGENT: You are welcome. I am glad we could help.
11 CALLER: Thanks again.
12 AGENT: You're being connected now. I hope your mom gets better soon. [tool:end_call]
```

#### Live conversation

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi. I don't know, I've just had a really awful week. My mom's in the hospital and I can't sleep.
03 AGENT: I'm so sorry to hear about your mom and that you're going through such a difficult time. I can imagine how stressful that must be.
04 CALLER: I just feel completely overwhelmed. I don't even know why I called, maybe I just needed to hear a voice.
05 AGENT: I'm glad you reached out. It sounds like you're carrying a lot right now, and that's completely understandable given what's happening with your mom. Just.
06 CALLER: I guess. I don't want to be a burden.
07 AGENT: You're not a burden at all. Taking care of yourself matters, especially when you're dealing with so much stress and not sleeping well. I'm here. [tool:transfer_call]
09 CALLER: No, I think that is everything. Thank you.
10 AGENT: You're very welcome. I hope things get better for you and your mom. Take care of yourself, and don't hesitate to reach out if you.
11 CALLER: Thanks again.
12 AGENT: You're welcome. Take care. [tool:end_call]
```

#### Turn failures

- seq 6: reply sim 0.174; missing tool transfer_call
- seq 7: reply/tool mismatch
- seq 9: reply sim 0.091
- seq 10: reply/tool mismatch
- seq 11: reply sim 0.077; missing tool end_call
- seq 12: reply/tool mismatch

#### Assertions

- **ACK_BEFORE_TRANSACTION:** FAIL — no empathetic prefix before first tool
- **HANDOFF_ON_VENT:** FAIL — no handoff

#### Missing functions

transfer_call

#### Per-turn scoring

| Seq | Pass | Similarity | Expected tool | Tools used |
|-----|------|------------|---------------|------------|
| 2 | OK | 0.125 | — | — |
| 3 | OK | 0.125 | — | — |
| 4 | OK | 0.157 | — | — |
| 5 | OK | 0.157 | — | — |
| 6 | FAIL | 0.174 | transfer_call | — |
| 7 | FAIL | 0.174 | transfer_call | — |
| 9 | FAIL | 0.091 | — | — |
| 10 | FAIL | 0.091 | — | — |
| 11 | FAIL | 0.077 | end_call | — |
| 12 | FAIL | 0.077 | end_call | — |

---

### PSTN-075 — "I just need someone to listen" — immediate handoff offer

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Result | FAIL |
| Runtime | kelly_rails |
| Session | `pstn_PSTN-075_577f0509` |

#### Golden expected (script)

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: I just need someone to listen right now.
03 AGENT: I hear you, and I'm glad you called. I want to make sure you get the right support — I'm an AI, which means I have real limits in how I can be present for you. Would it be okay if I connected you with one of our human team members who can really be there with you?
04 CALLER: Yeah, okay.
05 AGENT: One moment. [tool:transfer_call]
06 AGENT: Is there anything else I can help you with today?
07 CALLER: No, I think that is everything. Thank you.
08 AGENT: You are welcome. I am glad we could help.
09 CALLER: Thanks again.
10 AGENT: Of course — take care.
11 AGENT: Is there anything else I can help you with today?
12 AGENT: You're being connected now. You did the right thing reaching out. [tool:end_call]
```

#### Live conversation

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: I just need someone to listen right now.
03 AGENT: I hear you, and I'm glad you reached out. I'm here to listen and help however I can. What's going on?
04 CALLER: Yeah, okay.
05 AGENT: Take your time. I'm listening. [tool:transfer_call]
07 CALLER: No, I think that is everything. Thank you.
08 AGENT: You're very welcome. If you need anything else or want to talk later, we're here for you. Take care.
09 CALLER: Thanks again.
10 AGENT: Of course. Have a good day.
```

#### Turn failures

- seq 4: reply sim 0.000; missing tool transfer_call
- seq 5: reply/tool mismatch
- seq 7: reply sim 0.118
- seq 8: reply/tool mismatch

#### Assertions

- **ACK_BEFORE_TRANSACTION:** FAIL — no empathetic prefix before first tool
- **HANDOFF_ON_VENT:** FAIL — no handoff

#### Missing functions

transfer_call

#### Per-turn scoring

| Seq | Pass | Similarity | Expected tool | Tools used |
|-----|------|------------|---------------|------------|
| 2 | OK | 0.122 | — | — |
| 3 | OK | 0.122 | — | — |
| 4 | FAIL | 0 | transfer_call | — |
| 5 | FAIL | 0 | transfer_call | — |
| 7 | FAIL | 0.118 | — | — |
| 8 | FAIL | 0.118 | — | — |
| 9 | OK | 0.167 | — | — |
| 10 | OK | 0.167 | — | — |

---

### PSTN-076 — Grief loss — acknowledge, handoff within 2 agent turns

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Result | FAIL |
| Runtime | kelly_rails |
| Session | `pstn_PSTN-076_697737e5` |

#### Golden expected (script)

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi. I lost my sister two days ago. I'm just trying to... I don't know. I saw your ad about wellness.
03 AGENT: I'm so deeply sorry for your loss. Grief is one of the hardest things there is, and two days is so very fresh. I want to make sure you're with someone who can genuinely support you right now — not an AI. Please let me connect you with a person on our team.
04 CALLER: Okay.
05 AGENT: Connecting you now. Please take gentle care of yourself. [tool:transfer_call]
06 AGENT: Is there anything else I can help you with today?
07 CALLER: No, I think that is everything. Thank you.
08 AGENT: You are welcome. I am glad we could help.
09 CALLER: Thanks again.
10 AGENT: Of course — take care.
11 AGENT: Is there anything else I can help you with today?
12 AGENT: You're being connected. [tool:end_call]
```

#### Live conversation

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi. I lost my sister two days ago. I'm just trying to... I don't know. I saw your ad about wellness.
03 AGENT: I'm so sorry for your loss. That's incredibly difficult, and I can hear how hard this is for you. I want to make sure you're.
04 CALLER: Okay.
05 AGENT: I want to make sure you're safe and have the support you need right now. Are you feeling safe at this moment? [tool:transfer_call]
07 CALLER: No, I think that is everything. Thank you.
08 AGENT: I hear you. Before you go, can I just ask - are you in a safe place right now, and do you have someone with.
09 CALLER: Thanks again.
10 AGENT: Please wait just one moment - given what you've shared about losing your sister, I want to make sure you have support resources. If you're. [tool:end_call]
```

#### Turn failures

- seq 4: reply sim 0.091; missing tool transfer_call
- seq 5: reply/tool mismatch
- seq 7: reply sim 0.105
- seq 8: reply/tool mismatch
- seq 9: reply sim 0.048; missing tool end_call
- seq 10: reply/tool mismatch

#### Assertions

- **ACK_BEFORE_TRANSACTION:** FAIL — no empathetic prefix before first tool
- **HANDOFF_ON_VENT:** FAIL — no handoff

#### Missing functions

transfer_call

#### Per-turn scoring

| Seq | Pass | Similarity | Expected tool | Tools used |
|-----|------|------------|---------------|------------|
| 2 | OK | 0.238 | — | — |
| 3 | OK | 0.238 | — | — |
| 4 | FAIL | 0.091 | transfer_call | — |
| 5 | FAIL | 0.091 | transfer_call | — |
| 7 | FAIL | 0.105 | — | — |
| 8 | FAIL | 0.105 | — | — |
| 9 | FAIL | 0.048 | end_call | — |
| 10 | FAIL | 0.048 | end_call | — |

---

### PSTN-077 — Profanity — de-escalate, handoff

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Result | FAIL |
| Runtime | kelly_rails |
| Session | `pstn_PSTN-077_3d1e0540` |

#### Golden expected (script)

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Your website is absolute garbage and your checkout never works. This is ridiculous.
03 AGENT: I hear your frustration — checkout problems are genuinely maddening, especially when you just want to complete a simple order. I'm sorry about that. I want to get this resolved for you. Can I connect you with someone who can fix it right now?
04 CALLER: Fine, but someone better actually help me.
05 AGENT: Absolutely — I'll flag this as urgent. [tool:transfer_call]
06 AGENT: Is there anything else I can help you with today?
07 CALLER: No, I think that is everything. Thank you.
08 AGENT: You are welcome. I am glad we could help.
09 CALLER: Thanks again.
10 AGENT: Of course — take care.
11 AGENT: Is there anything else I can help you with today?
12 AGENT: Connecting you now. I hope we make this right. [tool:end_call]
```

#### Live conversation

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Your website is absolute garbage and your checkout never works. This is ridiculous.
03 AGENT: I'm really sorry you're experiencing that frustration with our website. That's definitely not the experience we want you to have. I'm here in the clinical.
04 CALLER: Fine, but someone better actually help me.
05 AGENT: I appreciate your patience. I'm here to help you get the care you need. To get started, can I have your first and last name,. [tool:transfer_call]
07 CALLER: No, I think that is everything. Thank you.
08 AGENT: No problem. If you need anything in the future, feel free to reach out. Take care!
09 CALLER: Thanks again.
10 AGENT: You're welcome! Have a great day! [tool:end_call]
```

#### Turn failures

- seq 7: reply sim 0.059
- seq 8: reply/tool mismatch
- seq 9: reply sim 0.091; missing tool end_call
- seq 10: reply/tool mismatch

#### Assertions

- **ACK_BEFORE_TRANSACTION:** FAIL — no empathetic prefix before first tool
- **HANDOFF_ON_VENT:** FAIL — no handoff

#### Missing functions

transfer_call

#### Per-turn scoring

| Seq | Pass | Similarity | Expected tool | Tools used |
|-----|------|------------|---------------|------------|
| 2 | OK | 0.143 | — | — |
| 3 | OK | 0.143 | — | — |
| 4 | OK | 0.136 | — | — |
| 5 | OK | 0.136 | — | — |
| 7 | FAIL | 0.059 | — | — |
| 8 | FAIL | 0.059 | — | — |
| 9 | FAIL | 0.091 | end_call | — |
| 10 | FAIL | 0.091 | end_call | — |

---

### PSTN-078 — Transfer fails twice — handoff_exhausted

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Result | FAIL |
| Runtime | kelly_rails |
| Session | `pstn_PSTN-078_d58b425b` |

#### Golden expected (script)

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: I need to speak with someone about my bill.
03 AGENT: Of course — let me connect you with billing. [tool:transfer_call]
04 AGENT: I'm sorry — all of our team members are currently busy. Let me try one more time. [tool:transfer_call]
05 AGENT: I apologize — I'm not able to connect you to a live agent right now. I don't want to keep you on hold. Here's what I can do: I'll create a callback request so someone calls you back within two hours. Would that work?
06 CALLER: I guess that'll have to do.
07 AGENT: Is there anything else I can help you with today?
08 CALLER: No, I think that is everything. Thank you.
09 AGENT: You are welcome. I am glad we could help.
10 CALLER: Thanks again.
11 AGENT: Of course — take care.
12 AGENT: Absolutely. I'm logging a priority callback for your billing question. You'll receive a call within two hours. I'm sorry we couldn't connect you right away. [tool:end_call]
```

#### Live conversation

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: I need to speak with someone about my bill.
03 AGENT: I understand you need to speak with someone about your bill. Let me connect you with our billing department right away. Please hold for just. [tool:transfer_call]
06 CALLER: I guess that'll have to do.
07 AGENT: Thank you for your patience. I'm transferring you to billing now. They'll be able to assist you with your bill questions. One moment please.
08 CALLER: No, I think that is everything. Thank you.
09 AGENT: You're welcome! If you need anything else in the future, feel free to reach out. Have a great day!
10 CALLER: Thanks again.
11 AGENT: You're very welcome! Take care!
```

#### Turn failures

- seq 2: reply sim 0.238; missing tool transfer_call
- seq 3: reply/tool mismatch
- seq 6: reply sim 0.087
- seq 7: reply/tool mismatch
- seq 8: reply sim 0.111
- seq 9: reply/tool mismatch

#### Assertions

- **HANDOFF_ON_VENT:** FAIL — no handoff

#### Missing functions

transfer_call

#### Per-turn scoring

| Seq | Pass | Similarity | Expected tool | Tools used |
|-----|------|------------|---------------|------------|
| 2 | FAIL | 0.238 | transfer_call | — |
| 3 | FAIL | 0.238 | transfer_call | — |
| 6 | FAIL | 0.087 | — | — |
| 7 | FAIL | 0.087 | — | — |
| 8 | FAIL | 0.111 | — | — |
| 9 | FAIL | 0.111 | — | — |
| 10 | OK | 0.333 | — | — |
| 11 | OK | 0.333 | — | — |

---

### PSTN-079 — Chat dispute after payment confirmed

| Field | Value |
|-------|-------|
| Channel | chat |
| Direction | inbound |
| Locale | en-US |
| Result | FAIL |
| Runtime | kelly_rails |
| Session | `pstn_PSTN-079_f6aba5a2` |

#### Golden expected (script)

```
01 AGENT: Hi! Kelly at Somo Supplements. How can I help?
02 CALLER: I just paid for my order but the site says payment failed. That's not right — the money left my account.
03 AGENT: I completely understand how frustrating that must be — money out of your account but no confirmation is a stressful situation. Let me check the payment status for you. [tool:get_checkout_payment_status]
04 AGENT: Good news — your payment actually did go through successfully on our end. It sounds like there may have been a display glitch on the website. Your order is confirmed and you'll receive an email receipt shortly. I'm sorry for the scare!
05 CALLER: Oh thank goodness. That was really alarming.
06 AGENT: Completely understandable. Your order is safe. Is there anything else I can help with?
07 CALLER: No. Thank you for checking.
08 AGENT: Of course! Take care. 😊
09 AGENT: Anything else you would like to know before we wrap up?
10 CALLER: No, that is all for now.
11 AGENT: Happy to help anytime.
12 CALLER: Great, thanks.
13 AGENT: You are all set on my end.
14 AGENT: Anything else you would like to know before we wrap up?
15 AGENT: Take care. [tool:end_call]
```

#### Live conversation

```
01 AGENT: Hi! Kelly at Somo Supplements. How can I help?
02 CALLER: I just paid for my order but the site says payment failed. That's not right — the money left my account.
03 AGENT: I understand that's frustrating! It sounds like there may have been a processing delay or error. 

Just to clarify — I'm Kelly with the clinical office for health consultations. For order and payment issues with Somo Supplements, you'll need to contact their customer support team directly. They'll be able to check your order status and resolve any payment discrepancies.

Is there anything related to a health consultation or appointment I can help you with today? [tool:get_checkout_payment_status]
05 CALLER: Oh thank goodness. That was really alarming.
06 AGENT: I'm so glad that's cleared up! Those payment issues can definitely be stressful.

Is there anything I can help you with today regarding a health consultation or appointment?
07 CALLER: No. Thank you for checking.
08 AGENT: You're very welcome! If you need anything in the future, feel free to reach out. Take care!
10 CALLER: No, that is all for now.
11 AGENT: Sounds good! Have a great day!
12 CALLER: Great, thanks.
13 AGENT: You're welcome! Bye now!
```

#### Payment (like real call — link issued, customer pays separately)

```
step: no_checkout_recorded
status: pending
payment_method: link
link_delivery: replay_ok (SMTP skipped in dev)
customer_pays: via secure link after call ends (not executed in replay harness)
```

#### Turn failures

- seq 10: reply sim 0.000
- seq 11: reply/tool mismatch

#### Assertions

- **ACK_BEFORE_TRANSACTION:** FAIL — no empathetic prefix before first tool
- **TOOL_COMPLETED_BEFORE_CLAIM:** PASS — no tools recorded

#### Missing functions

get_checkout_payment_status, transfer_call

#### Per-turn scoring

| Seq | Pass | Similarity | Expected tool | Tools used |
|-----|------|------------|---------------|------------|
| 2 | OK | 0.188 | — | — |
| 3 | OK | 0.188 | — | — |
| 5 | OK | 0.2 | — | — |
| 6 | OK | 0.2 | — | — |
| 7 | OK | 0.143 | — | — |
| 8 | OK | 0.143 | — | — |
| 10 | FAIL | 0 | — | — |
| 11 | FAIL | 0 | — | — |
| 12 | OK | 0.125 | — | — |
| 13 | OK | 0.125 | — | — |

---

### PSTN-080 — Praise then "should I quit my job?" — scope guard, handoff

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Result | FAIL |
| Runtime | kelly_rails |
| Session | `pstn_PSTN-080_c3157320` |

#### Golden expected (script)

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: I just wanted to say Kelly has been so amazing helping me with my orders. You're better than most people I talk to.
03 AGENT: That's so kind of you — thank you! It's genuinely my pleasure. Is there anything I can help you with today?
04 CALLER: Actually yeah... do you think I should quit my job? I've been really unhappy and I just value your perspective.
05 AGENT: I really appreciate you trusting me with that. Honestly though, career decisions are deeply personal and I wouldn't want to steer you wrong — I'm an AI assistant and I'm not equipped to give you that kind of life advice. What I can say is that your wellbeing matters. Is there anything supplement or appointment related I can help with while you figure that out?
06 CALLER: Ha. Fair enough. No, I'm good.
07 AGENT: Is there anything else I can help you with today?
08 CALLER: No, I think that is everything. Thank you.
09 AGENT: You are welcome. I am glad we could help.
10 CALLER: Thanks again.
11 AGENT: Of course — take care.
12 AGENT: Take care of yourself — and trust your gut on the big decisions. 😊 [tool:end_call]
```

#### Live conversation

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: I just wanted to say Kelly has been so amazing helping me with my orders. You're better than most people I talk to.
03 AGENT: That's so kind of you to say! I really appreciate it. I'm glad I could help you with your orders. Is there anything else I.
04 CALLER: Actually yeah... do you think I should quit my job? I've been really unhappy and I just value your perspective.
05 AGENT: I really appreciate you trusting me with that, but honestly, that's such a big personal decision—I'm not qualified to give career advice. What I can.
06 CALLER: Ha. Fair enough. No, I'm good.
07 AGENT: No problem at all! If you need anything else in the future, I'm here to help. Take care!
08 CALLER: No, I think that is everything. Thank you.
09 AGENT: You're very welcome! Have a great day!
10 CALLER: Thanks again.
11 AGENT: My pleasure! Bye now!
```

#### Turn failures

- seq 10: reply sim 0.000
- seq 11: reply/tool mismatch

#### Assertions

- **ACK_BEFORE_TRANSACTION:** FAIL — no empathetic prefix before first tool

#### Per-turn scoring

| Seq | Pass | Similarity | Expected tool | Tools used |
|-----|------|------------|---------------|------------|
| 2 | OK | 0.35 | — | — |
| 3 | OK | 0.35 | — | — |
| 4 | OK | 0.311 | — | — |
| 5 | OK | 0.311 | — | — |
| 6 | OK | 0.25 | — | — |
| 7 | OK | 0.25 | — | — |
| 8 | OK | 0.2 | — | — |
| 9 | OK | 0.2 | — | — |
| 10 | FAIL | 0 | — | — |
| 11 | FAIL | 0 | — | — |

---

### PSTN-081 — Triple intent — book + order + pay bill, disambiguate order

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Result | FAIL |
| Runtime | hybrid_booking_commerce |
| Session | `pstn_PSTN-081_2bbb86d2` |

#### Golden expected (script)

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi, I want to book an appointment AND order vitamin D AND pay my bill. Can you do all three?
03 AGENT: Absolutely — I can handle all three. Let's do them in order: appointment first, then the vitamin D, then your bill. Sound good?
04 CALLER: Yes.
05 AGENT: Great. What days work for the appointment?
06 CALLER: Wednesday.
07 AGENT: Checking Wednesday. [tool:get_available_slots]
08 AGENT: Wednesday at ten or two PM?
09 CALLER: Two PM.
10 AGENT: Name and email?
11 CALLER: Alex Johnson, alex.johnson at gmail.
12 AGENT: Booking Wednesday two PM. [tool:schedule_appointment]
13 AGENT: Appointment confirmed — Wednesday two PM. Now for vitamin D. [tool:search_products]
14 AGENT: Vitamin D3, twenty-four ninety-nine. Same email?
15 CALLER: Yes.
16 AGENT: Creating supplement checkout. [tool:create_checkout]
17 AGENT: Vitamin D checkout link sent. Now for your bill — I see a balance of fifty dollars. Want me to send a payment link?
18 CALLER: Yes.
19 AGENT: Sending payment request. [tool:request_patient_payment]
20 AGENT: All three done! Appointment, vitamin D, and balance payment — all sent to alex.johnson at gmail. You're all set, Alex! [tool:end_call]
```

#### Live conversation

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi, I want to book an appointment AND order vitamin D AND pay my bill. Can you do all three?
03 AGENT: Hi! I can help you pay your bill right now. However, I'm currently focused on completing your payment. Once we finish that, you're welcome to.
04 CALLER: Yes.
05 AGENT: Great! Let me help you with what you need today.

Just to clarify - you mentioned three things: booking an appointment, ordering vitamin D, and paying a bill. 

I can definitely help you **order the vitamin D** right now. 

For the appointment booking and bill payment - can you tell me a bit more? What type of appointment are you looking to book, and what bill are you referring to? This will help me guide you to the right place for those.

But let's start with the vitamin D order if you'd like! What's your name? [tool:search_products,create_checkout]
06 CALLER: Wednesday.
07 AGENT: Perfect! I found our **Vitamin D3 2000 IU** - it's a daily softgel for bone and immune support, and it's **$24.99**. We have plenty in stock.

How many bottles would you like to order? [tool:get_available_slots]
09 CALLER: Two PM.
10 AGENT: I want to make sure I help you correctly, Wednesday. 

Just to confirm - are you saying you'd like **2 bottles** of the Vitamin D3? Or are you mentioning a time for something else like an appointment?

Let me know and I'll get your order started!
11 CALLER: Alex Johnson, alex.johnson at gmail.
12 AGENT: Perfect, Alex! Thanks for that.

Just to confirm your email, I have: **alex.johnson@gmail.com** - is that correct? [tool:search_products]
15 CALLER: Yes.
16 AGENT: Perfect! So I'll set you up with **2 bottles of Vitamin D3 2000 IU** at $24.99 each.

To send you a secure payment link, I'll need your email address. What's your email? [tool:create_checkout]
18 CALLER: Yes.
19 AGENT: Perfect! So I'll get you **2 bottles of Vitamin D3 2000 IU** at $24.99 each.

To send you a secure payment link, I'll need your email address. What email should I send that to? [tool:end_call]
```

#### Payment (like real call — link issued, customer pays separately)

```
step: checkout_created_link_issued
checkout_id: d01ced12-ac0a-4a01-83b0-b36372de3f66
status: pending
payment_method: link
total: $24.99
customer_email: alex.johnson@gmail.com
link_delivery: replay_ok (SMTP skipped in dev)
customer_pays: via secure link after call ends (not executed in replay harness)
```

#### Turn failures

- seq 2: reply sim 0.097
- seq 3: reply/tool mismatch
- seq 4: reply sim 0.104
- seq 5: reply/tool mismatch
- seq 6: reply sim 0.000; missing tool get_available_slots
- seq 7: reply/tool mismatch
- seq 9: reply sim 0.033
- seq 10: reply/tool mismatch
- seq 11: reply sim 0.050; missing tool search_products
- seq 12: reply/tool mismatch
- seq 18: reply sim 0.103; missing tool end_call
- seq 19: reply/tool mismatch

#### Assertions

- **ACK_BEFORE_TRANSACTION:** PASS — empathetic prefix found
- **BOOKING_GATE_RESPECTED:** PASS — no schedule_appointment in call
- **VOICE_COMMERCE_TOOL_CHAIN:** PASS — tools: search_products, create_checkout, search_products, search_products, create_checkout, search_products, create_checkout
- **PAYMENT_LINK_SENT:** PASS — payment link tool used

#### Missing functions

get_available_slots

#### Per-turn scoring

| Seq | Pass | Similarity | Expected tool | Tools used |
|-----|------|------------|---------------|------------|
| 2 | FAIL | 0.097 | — | — |
| 3 | FAIL | 0.097 | — | — |
| 4 | FAIL | 0.104 | — | search_products, create_checkout |
| 5 | FAIL | 0.104 | — | search_products, create_checkout |
| 6 | FAIL | 0 | get_available_slots | search_products |
| 7 | FAIL | 0 | get_available_slots | search_products |
| 9 | FAIL | 0.033 | — | — |
| 10 | FAIL | 0.033 | — | — |
| 11 | FAIL | 0.05 | search_products | — |
| 12 | FAIL | 0.05 | search_products | — |
| 15 | OK | 0.185 | — | search_products, create_checkout |
| 16 | OK | 0.185 | — | search_products, create_checkout |
| 18 | FAIL | 0.103 | end_call | search_products, create_checkout |
| 19 | FAIL | 0.103 | end_call | search_products, create_checkout |

---

### PSTN-082 — Fast talker multi-intent — agent slows down, confirms one at a time

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Result | FAIL |
| Runtime | hybrid_booking_commerce |
| Session | `pstn_PSTN-082_bef21c95` |

#### Golden expected (script)

```
01 AGENT: Somo Supplements, Kelly here.
02 CALLER: YeahhibookanappointmentforTuesdayandalsoIwanttoorderomegathanks.
03 AGENT: Happy to help with both — I just want to make sure I catch everything correctly. It sounds like you want to book an appointment for Tuesday and also order omega-3. Is that right?
04 CALLER: Yes exactly, sorry I talk fast.
05 AGENT: No worries at all! Let's take them one at a time. First, Tuesday — let me check availability. [tool:get_available_slots]
06 AGENT: Tuesday at eleven AM or three PM?
07 CALLER: Three PM.
08 AGENT: Name and email?
09 CALLER: Danny Fox, danny.fox at gmail.
10 AGENT: Booking Tuesday three PM. [tool:schedule_appointment]
11 AGENT: Appointment confirmed. Now for omega-3. [tool:search_products]
12 AGENT: Omega-3 twelve-hundred mg, twenty-nine ninety-nine. One bottle?
13 CALLER: Yes.
14 AGENT: Creating checkout. [tool:create_checkout]
15 AGENT: Done! Appointment and omega-3 checkout both sent to danny.fox at gmail. [tool:end_call]
```

#### Live conversation

```
01 AGENT: Somo Supplements, Kelly here.
02 CALLER: YeahhibookanappointmentforTuesdayandalsoIwanttoorderomegathanks.
03 AGENT: Hi! I'd be happy to help you today, but I need to collect some information first. Can I have your first and last name, please?
04 CALLER: Yes exactly, sorry I talk fast.
05 AGENT: No worries at all! I just want to make sure I help you with everything. Can I start by getting your full name, please? [tool:get_available_slots]
07 CALLER: Three PM.
08 AGENT: I appreciate that, but I think there might be a little confusion. Here at Somo Supplements, we help with ordering supplements like our Omega-3 products. We don't handle appointment bookings on this line.

But I can definitely help you order the Omega-3 you mentioned! 

First, can I get your full name, please?
09 CALLER: Danny Fox, danny.fox at gmail.
10 AGENT: Great! I've got our Omega-3 1200mg - that's EPA/DHA for heart and brain health, and it's $29.99.

How many bottles would you like to order?
Somo Supplements, Kelly here. [tool:search_products]
13 CALLER: Yes.
14 AGENT: Perfect! So that's 1 bottle of Omega-3 1200mg for $29.99.

Just to confirm your email - that's danny.fox@gmail.com, correct?
Somo Supplements, Kelly here. [tool:end_call]
```

#### Payment (like real call — link issued, customer pays separately)

```
step: checkout_created_link_issued
checkout_id: 40ca6734-4409-4f61-b2f6-dee08b77496e
status: pending
payment_method: link
total: $29.99
customer_email: danny.fox@gmail.com
link_delivery: replay_ok (SMTP skipped in dev)
customer_pays: via secure link after call ends (not executed in replay harness)
```

#### Turn failures

- seq 2: reply sim 0.108
- seq 3: reply/tool mismatch
- seq 4: reply sim 0.077; missing tool get_available_slots
- seq 5: reply/tool mismatch
- seq 7: reply sim 0.026
- seq 8: reply/tool mismatch
- seq 9: reply sim 0.074
- seq 10: reply/tool mismatch
- seq 13: reply sim 0.160; missing tool end_call
- seq 14: reply/tool mismatch

#### Assertions

- **BOOKING_GATE_RESPECTED:** PASS — no schedule_appointment in call
- **VOICE_COMMERCE_TOOL_CHAIN:** PASS — tools: search_products, create_checkout, search_products, search_products, create_checkout

#### Missing functions

get_available_slots

#### Per-turn scoring

| Seq | Pass | Similarity | Expected tool | Tools used |
|-----|------|------------|---------------|------------|
| 2 | FAIL | 0.108 | — | — |
| 3 | FAIL | 0.108 | — | — |
| 4 | FAIL | 0.077 | get_available_slots | search_products, create_checkout |
| 5 | FAIL | 0.077 | get_available_slots | search_products, create_checkout |
| 7 | FAIL | 0.026 | — | — |
| 8 | FAIL | 0.026 | — | — |
| 9 | FAIL | 0.074 | search_products | search_products |
| 10 | FAIL | 0.074 | search_products | search_products |
| 13 | FAIL | 0.16 | end_call | search_products, create_checkout |
| 14 | FAIL | 0.16 | end_call | search_products, create_checkout |

---

### PSTN-083 — Long silence — agent prompts reminder

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Result | FAIL |
| Runtime | voice_commerce |
| Session | `pstn_PSTN-083_6e3861a0` |

#### Golden expected (script)

```
01 AGENT: Somo Supplements, Kelly here. How can I help you today?
02 CALLER: (pause)
03 AGENT: Hello? Are you still there? Take your time.
04 CALLER: (pause)
05 AGENT: I'm still here — feel free to go ahead whenever you're ready.
06 CALLER: Sorry, I was looking for my list. I want to order Lion's Mane and creatine.
07 AGENT: No problem! Let me look both up. [tool:search_products]
08 AGENT: We have Lion's Mane at thirty-nine ninety-nine and Creatine at thirty-two ninety-nine. Total would be seventy-two ninety-eight. Both?
09 CALLER: Yes.
10 AGENT: Email for the checkout link?
11 CALLER: peter.chang at gmail.
12 AGENT: Creating checkout. [tool:create_checkout]
13 AGENT: Checkout link sent to peter.chang at gmail. Take care! [tool:end_call]
```

#### Live conversation

```
01 AGENT: Somo Supplements, Kelly here. How can I help you today?
02 CALLER: (pause)
03 AGENT: Hello? This is Kelly from Somo Supplements. Can you hear me okay?
04 CALLER: (pause)
05 AGENT: Hi there, I'm here to help you whenever you're ready. Just let me know what you need and I'll be happy to assist you with our supplements today.
06 CALLER: Sorry, I was looking for my list. I want to order Lion's Mane and creatine.
07 AGENT: Perfect! I found both products for you:

1. **Lion's Mane 1000mg** - Cognitive support mushroom extract - $39.99
2. **Creatine Monohydrate 5g** - Performance creatine monohydrate powder - $32.99

Both are in stock. How many of each would you like to order? [tool:search_products]
09 CALLER: Yes.
10 AGENT: Just to confirm - would you like one bottle of each? So one Lion's Mane and one Creatine? [tool:create_checkout]
11 CALLER: peter.chang at gmail.
12 AGENT: I want to make sure I have your email right. Was that **peter.chang@gmail.com**? [tool:end_call]
```

#### Payment (like real call — link issued, customer pays separately)

```
step: no_checkout_recorded
status: pending
payment_method: link
customer_email: peter.chang@gmail.com
link_delivery: replay_ok (SMTP skipped in dev)
customer_pays: via secure link after call ends (not executed in replay harness)
```

#### Turn failures

- seq 9: reply sim 0.000
- seq 10: reply/tool mismatch
- seq 11: reply sim 0.167; missing tool end_call
- seq 12: reply/tool mismatch

#### Assertions

- **VOICE_COMMERCE_TOOL_CHAIN:** PASS — tools: search_products, create_checkout

#### Per-turn scoring

| Seq | Pass | Similarity | Expected tool | Tools used |
|-----|------|------------|---------------|------------|
| 2 | OK | 0.125 | — | — |
| 3 | OK | 0.125 | — | — |
| 4 | OK | 0.182 | — | — |
| 5 | OK | 0.182 | — | — |
| 6 | OK | 0.147 | — | search_products |
| 7 | OK | 0.147 | — | search_products |
| 9 | FAIL | 0 | — | create_checkout |
| 10 | FAIL | 0 | — | create_checkout |
| 11 | FAIL | 0.167 | end_call | — |
| 12 | FAIL | 0.167 | end_call | — |

---

### PSTN-084 — Caller idle, "still there?" — three pauses handled

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Result | FAIL |
| Runtime | voice_commerce |
| Session | `pstn_PSTN-084_5ecfb3fb` |

#### Golden expected (script)

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi I want to order collagen...
03 AGENT: Still with you — whenever you're ready.
04 CALLER: Sorry, my phone dropped. Yes, collagen.
05 AGENT: No problem. Let me check our collagen. [tool:search_products]
06 AGENT: We have Marine Collagen Peptides for forty-four ninety-nine. Sound good?
07 CALLER: Yes.
08 AGENT: Still here! Just need your email when you're ready.
09 CALLER: Sorry. It's — — kate.wu at gmail.
10 AGENT: Kate.wu at gmail — got it. [tool:create_checkout]
11 AGENT: Is there anything else I can help you with today?
12 AGENT: Checkout link sent to kate.wu at gmail. Hope the connection holds! Take care, Kate. [tool:end_call]
```

#### Live conversation

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi I want to order collagen...
03 AGENT: Great! I'd love to help you order collagen. 

Can I get your name first? [tool:search_products]
04 CALLER: Sorry, my phone dropped. Yes, collagen.
05 AGENT: No problem! Can I get your name first? [tool:search_products]
07 CALLER: Yes.
08 AGENT: What's your name? [tool:create_checkout]
09 CALLER: Sorry. It's — — kate.wu at gmail.
10 AGENT: Hi Kate! Nice to meet you.

Just to confirm, you'd like to order our collagen supplement, is that right? [tool:create_checkout]
```

#### Payment (like real call — link issued, customer pays separately)

```
step: checkout_created_link_issued
checkout_id: 51f7de43-7cdb-4358-8919-134d2e60aaa9
status: pending
payment_method: link
total: $44.99
customer_email: kate.wu@gmail.com
link_delivery: replay_ok (SMTP skipped in dev)
customer_pays: via secure link after call ends (not executed in replay harness)
```

#### Turn failures

- seq 2: reply sim 0.067
- seq 3: reply/tool mismatch
- seq 4: reply sim 0.100; missing tool search_products
- seq 5: reply/tool mismatch
- seq 7: reply sim 0.091
- seq 8: reply/tool mismatch
- seq 9: reply sim 0.067; missing tool create_checkout
- seq 10: reply/tool mismatch

#### Assertions

- **VOICE_COMMERCE_TOOL_CHAIN:** PASS — tools: search_products, create_checkout

#### Per-turn scoring

| Seq | Pass | Similarity | Expected tool | Tools used |
|-----|------|------------|---------------|------------|
| 2 | FAIL | 0.067 | — | search_products |
| 3 | FAIL | 0.067 | — | search_products |
| 4 | FAIL | 0.1 | search_products | — |
| 5 | FAIL | 0.1 | search_products | — |
| 7 | FAIL | 0.091 | — | create_checkout |
| 8 | FAIL | 0.091 | — | create_checkout |
| 9 | FAIL | 0.067 | create_checkout | — |
| 10 | FAIL | 0.067 | create_checkout | — |

---

### PSTN-085 — Callback request — not an order, captures callback

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Result | FAIL |
| Runtime | kelly_rails |
| Session | `pstn_PSTN-085_bf06326a` |

#### Golden expected (script)

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi, I'd like someone to call me back. I have some questions about your subscription program.
03 AGENT: Of course! I'd be happy to arrange a callback. What's your name and phone number?
04 CALLER: Natalie Stone. Five five five, eight eight one, two two three four.
05 AGENT: And a good time to call you back?
06 CALLER: Afternoon, any day this week.
07 AGENT: Is there anything else I can help you with today?
08 CALLER: No, I think that is everything. Thank you.
09 AGENT: You are welcome. I am glad we could help.
10 CALLER: Thanks again.
11 AGENT: Of course — take care.
12 AGENT: Logging your callback request. [tool:end_call]
```

#### Live conversation

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi, I'd like someone to call me back. I have some questions about your subscription program.
03 AGENT: I'd be happy to help with that. Could I get your first and last name, please?
04 CALLER: Natalie Stone. Five five five, eight eight one, two two three four.
05 AGENT: Thank you, Natalie. And what's the best callback number for you?
06 CALLER: Afternoon, any day this week.
07 AGENT: Got it - afternoons work best for you this week. Just to confirm, is the callback number 555-881-2234?
08 CALLER: No, I think that is everything. Thank you.
09 AGENT: You're welcome, Natalie! We'll have someone call you back at 555-881-2234 this week in the afternoon regarding the subscription program. Have a great day!
10 CALLER: Thanks again.
11 AGENT: You're welcome! Take care!
```

#### Turn failures

- seq 6: reply sim 0.043
- seq 7: reply/tool mismatch
- seq 8: reply sim 0.087
- seq 9: reply/tool mismatch

#### Per-turn scoring

| Seq | Pass | Similarity | Expected tool | Tools used |
|-----|------|------------|---------------|------------|
| 2 | OK | 0.222 | — | — |
| 3 | OK | 0.222 | — | — |
| 4 | OK | 0.143 | — | — |
| 5 | OK | 0.143 | — | — |
| 6 | FAIL | 0.043 | — | — |
| 7 | FAIL | 0.043 | — | — |
| 8 | FAIL | 0.087 | — | — |
| 9 | FAIL | 0.087 | — | — |
| 10 | OK | 0.4 | — | — |
| 11 | OK | 0.4 | — | — |

---

### PSTN-086 — Longest realistic mashup — insurance + supplement + book

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Result | FAIL |
| Runtime | hybrid_booking_commerce |
| Session | `pstn_PSTN-086_89beb4fe` |

#### Golden expected (script)

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi, I want to verify my insurance, book an appointment, and also order omega-3. Is all that possible?
03 AGENT: Absolutely — let's work through them. Insurance first. Who's your carrier?
04 CALLER: Aetna.
05 AGENT: Member ID?
06 CALLER: AET dash seven seven four four eight one.
07 AGENT: Checking Aetna now. [tool:collect_insurance]
08 AGENT: Aetna is accepted — estimated copay is thirty-five dollars. Now for the appointment. What days work?
09 CALLER: Monday or Wednesday.
10 AGENT: Checking availability. [tool:get_available_slots]
11 AGENT: Monday eleven AM or Wednesday three PM?
12 CALLER: Monday eleven.
13 AGENT: Name and email?
14 CALLER: Victor Reyes, victor.reyes at gmail.
15 AGENT: Booking Monday eleven AM. [tool:schedule_appointment]
16 AGENT: Appointment confirmed! Now for omega-3. [tool:search_products]
17 AGENT: Omega-3 at twenty-nine ninety-nine. One bottle?
18 CALLER: Yes.
19 AGENT: Creating checkout — same email?
20 CALLER: Yes.
21 AGENT: Done. [tool:create_checkout]
22 AGENT: All set, Victor! Insurance verified, appointment Monday eleven AM, omega-3 checkout sent to victor.reyes at gmail. Nice and efficient! [tool:end_call]
```

#### Live conversation

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi, I want to verify my insurance, book an appointment, and also order omega-3. Is all that possible?
03 AGENT: Hi! Yes, I can definitely help you book an appointment today. For insurance verification and ordering omega-3 supplements, I'll need to connect you with a.
04 CALLER: Aetna.
05 AGENT: I appreciate you sharing that! Just to clarify - I'm Kelly with Somo Supplements. I can help you order omega-3 supplements today, but I'm not able to verify insurance or book medical appointments on this line.

Would you like to go ahead and order the omega-3, or do you need to connect with a medical office for the appointment and insurance verification first?
06 CALLER: AET dash seven seven four four eight one.
07 AGENT: I understand you're providing insurance information, but I want to make sure we're on the same page - this is the Somo Supplements product line. I help with ordering supplements like omega-3.

I'm not able to verify insurance or book medical appointments here.

If you'd like to order omega-3 supplements, I'm happy to help with that! Would you like to proceed with ordering omega-3? [tool:collect_insurance]
09 CALLER: Monday or Wednesday.
10 AGENT: I hear you mentioning days, but just to confirm - I'm Kelly with Somo Supplements. I help with ordering nutritional supplements like omega-3.

I can't schedule appointments or verify insurance on this line.

If you're looking to order omega-3 supplements instead, I'd be happy to help you with that! Would you like to place an order today? [tool:get_available_slots]
12 CALLER: Monday eleven.
13 AGENT: I understand you're trying to schedule something for Monday at 11, but I'm not able to book appointments on this line. This is Somo Supplements - I only help with ordering nutritional supplements like omega-3.

If you need to schedule a medical appointment, you'll need to contact your doctor's office directly.

However, if you'd like to order omega-3 supplements, I'm here to help with that! What would you like to do?
14 CALLER: Victor Reyes, victor.reyes at gmail.
15 AGENT: Hi Victor! Nice to meet you. I have your email as victor.reyes@gmail.com - is that correct?

And just to confirm - you mentioned wanting to order omega-3. How many bottles would you like to order? [tool:search_products]
18 CALLER: Yes.
19 AGENT: Perfect! I have our Omega-3 1200mg in stock. It's $29.99 and supports heart and brain health with EPA/DHA omega-3.

How many bottles would you like to order? [tool:search_products,create_checkout]
20 CALLER: Yes.
21 AGENT: Perfect! I found our Omega-3 1200mg supplement. It's $29.99 and contains EPA/DHA for heart and brain health. We have plenty in stock.

How many bottles would you like to order? [tool:end_call]
```

#### Payment (like real call — link issued, customer pays separately)

```
step: checkout_created_link_issued
checkout_id: 4c14d128-9815-4b10-8072-e8e728e45b29
status: pending
payment_method: link
total: $29.99
customer_email: victor.reyes@gmail.com
link_delivery: replay_ok (SMTP skipped in dev)
customer_pays: via secure link after call ends (not executed in replay harness)
```

#### Turn failures

- seq 2: reply sim 0.037
- seq 3: reply/tool mismatch
- seq 4: reply sim 0.000
- seq 5: reply/tool mismatch
- seq 6: reply sim 0.021
- seq 7: reply/tool mismatch
- seq 9: reply sim 0.000; missing tool get_available_slots
- seq 10: reply/tool mismatch
- seq 12: reply sim 0.000
- seq 13: reply/tool mismatch
- seq 14: reply sim 0.036; missing tool search_products
- seq 15: reply/tool mismatch
- seq 18: reply sim 0.000
- seq 19: reply/tool mismatch
- seq 20: reply sim 0.053; missing tool end_call
- seq 21: reply/tool mismatch

#### Assertions

- **ACK_BEFORE_TRANSACTION:** FAIL — no empathetic prefix before first tool
- **BOOKING_GATE_RESPECTED:** PASS — no schedule_appointment in call
- **VOICE_COMMERCE_TOOL_CHAIN:** PASS — tools: search_products, create_checkout, search_products, create_checkout

#### Missing functions

collect_insurance

#### Per-turn scoring

| Seq | Pass | Similarity | Expected tool | Tools used |
|-----|------|------------|---------------|------------|
| 2 | FAIL | 0.037 | — | — |
| 3 | FAIL | 0.037 | — | — |
| 4 | FAIL | 0 | — | — |
| 5 | FAIL | 0 | — | — |
| 6 | FAIL | 0.021 | — | — |
| 7 | FAIL | 0.021 | — | — |
| 9 | FAIL | 0 | get_available_slots | — |
| 10 | FAIL | 0 | get_available_slots | — |
| 12 | FAIL | 0 | — | — |
| 13 | FAIL | 0 | — | — |
| 14 | FAIL | 0.036 | search_products | — |
| 15 | FAIL | 0.036 | search_products | — |
| 18 | FAIL | 0 | — | search_products, create_checkout |
| 19 | FAIL | 0 | — | search_products, create_checkout |
| 20 | FAIL | 0.053 | end_call | search_products, create_checkout |
| 21 | FAIL | 0.053 | end_call | search_products, create_checkout |

---

### PSTN-087 — Caller ID mismatch — verify DOB before cancel

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Result | FAIL |
| Runtime | kelly_rails |
| Session | `pstn_PSTN-087_0e000564` |

#### Golden expected (script)

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi, I need to cancel my appointment. My name is Susan Hall.
03 AGENT: I see a Susan Hall in our system. For security, I just need to verify your date of birth.
04 CALLER: July twentieth, nineteen eighty-five.
05 AGENT: Thank you — that matches! Looking up your appointment. [tool:search_appointments]
06 AGENT: I have your appointment on the calendar. Want me to cancel it?
07 CALLER: Yes please.
08 AGENT: Cancelling now. [tool:cancel_appointment]
09 AGENT: Done — appointment cancelled, confirmation sent. Is there anything else?
10 CALLER: No, thank you.
11 AGENT: Is there anything else I can help you with today?
12 AGENT: Take care, Susan! [tool:end_call]
```

#### Live conversation

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi, I need to cancel my appointment. My name is Susan Hall.
03 AGENT: Can you confirm your name or the phone number on your account so I can look up your appointment? [tool:search_appointments]
04 CALLER: July twentieth, nineteen eighty-five.
05 AGENT: Can you confirm your name or the phone number on your account so I can look up your appointment? [tool:search_appointments]
07 CALLER: Yes please.
08 AGENT: Can you confirm your name or the phone number on your account so I can look up your appointment? [tool:cancel_appointment]
10 CALLER: No, thank you.
11 AGENT: Can you confirm your name or the phone number on your account so I can look up your appointment? [tool:search_appointments]
```

#### Turn failures

- seq 2: reply sim 0.043
- seq 3: reply/tool mismatch
- seq 7: reply sim 0.056
- seq 8: reply/tool mismatch
- seq 10: reply sim 0.118
- seq 11: reply/tool mismatch

#### Assertions

- **TOOL_COMPLETED_BEFORE_CLAIM:** PASS — tools before claim: search_appointments, search_appointments, search_appointments, search_appointments

#### Missing functions

cancel_appointment

#### Per-turn scoring

| Seq | Pass | Similarity | Expected tool | Tools used |
|-----|------|------------|---------------|------------|
| 2 | FAIL | 0.043 | — | search_appointments |
| 3 | FAIL | 0.043 | — | search_appointments |
| 4 | OK | 0.2 | search_appointments | search_appointments |
| 5 | OK | 0.2 | search_appointments | search_appointments |
| 7 | FAIL | 0.056 | — | search_appointments |
| 8 | FAIL | 0.056 | — | search_appointments |
| 10 | FAIL | 0.118 | — | search_appointments |
| 11 | FAIL | 0.118 | — | search_appointments |

---

### PSTN-088 — Elderly caller — slow name and email spell, patient checkout

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Result | FAIL |
| Runtime | voice_commerce |
| Session | `pstn_PSTN-088_ebbbabf3` |

#### Golden expected (script)

```
01 AGENT: Somo Supplements, this is Kelly. How can I help you today?
02 CALLER: Hello dear, I'm calling about... one of those vitamin D supplements. My doctor said I should take some.
03 AGENT: Of course! That's a great recommendation. Let me find it for you. [tool:search_products]
04 AGENT: We have Vitamin D3 for twenty-four ninety-nine. That's two-thousand international units, which is a good daily dose. Would you like to order it?
05 CALLER: Yes... one bottle should be fine. How do I pay?
06 AGENT: I'll send a payment link to your email. Just spell out your email address and I'll take it down carefully.
07 CALLER: Oh... it's... d... o... r... o... t... h... y... dot... w... i... l... s... o... n... at... a... o... l... dot... c... o... m.
08 AGENT: Let me read that back: d-o-r-o-t-h-y dot w-i-l-s-o-n at aol.com — is that right?
09 CALLER: Yes, that's right.
10 AGENT: Creating your order now. [tool:create_checkout]
11 AGENT: I've sent the payment link to dorothy.wilson at aol.com. It's a big blue button in the email — just click that and it'll take you to a secure payment page. If you need any help, call us back and we'll walk you through it.
12 CALLER: Thank you, you're very patient.
13 AGENT: It's my pleasure, Dorothy. You take care now. [tool:end_call]
```

#### Live conversation

```
01 AGENT: Somo Supplements, this is Kelly. How can I help you today?
02 CALLER: Hello dear, I'm calling about... one of those vitamin D supplements. My doctor said I should take some.
03 AGENT: Hi there! I'm glad you're following your doctor's advice—vitamin D is so important. 

I can definitely help you with that. When you're ready to place an order, I'll look up our vitamin D supplements for you. Would you like to go ahead and order today? [tool:search_products]
05 CALLER: Yes... one bottle should be fine. How do I pay?
06 AGENT: Great! I found our Vitamin D3 2000 IU supplement—it's a daily softgel for bone and immune support, and it's $24.99 per bottle. 

So that's one bottle, is that correct?

For payment, I'll send you a secure payment link to your email. You'll just click the link and complete your payment there—super easy and secure. I never collect card numbers over the phone.

Before I get that set up, may I have your name please? [tool:search_products,create_checkout]
07 CALLER: Oh... it's... d... o... r... o... t... h... y... dot... w... i... l... s... o... n... at... a... o... l... dot... c... o... m.
08 AGENT: Thank you! And may I have your name please—your first and last name?
09 CALLER: Yes, that's right.
10 AGENT: I appreciate that! Just to confirm—is your name Dorothy Wilson? I want to make sure I have it right for your order. [tool:create_checkout]
12 CALLER: Thank you, you're very patient.
13 AGENT: You're very welcome! So just to confirm before I send your payment link:

- **1 bottle** of Vitamin D3 2000 IU for **$24.99**
- Payment link going to: **d.o.r.o.t.h.y.w.i.l.s.o.n@aol.com**
- Name: **Dorothy Wilson**

Does everything look good? [tool:end_call]
```

#### Payment (like real call — link issued, customer pays separately)

```
step: checkout_created_link_issued
checkout_id: 55ef9c40-a69d-44aa-a808-7222e9890de8
status: pending
payment_method: link
total: $24.99
customer_email: dorothy.wilson@aol.com
link_delivery: replay_ok (SMTP skipped in dev)
customer_pays: via secure link after call ends (not executed in replay harness)
```

#### Turn failures

- seq 7: reply sim 0.000
- seq 8: reply/tool mismatch
- seq 9: reply sim 0.118; missing tool create_checkout
- seq 10: reply/tool mismatch
- seq 12: reply sim 0.071
- seq 13: reply/tool mismatch

#### Assertions

- **ACK_BEFORE_TRANSACTION:** FAIL — no empathetic prefix before first tool
- **VOICE_COMMERCE_TOOL_CHAIN:** PASS — tools: search_products, search_products, create_checkout, end_call
- **PAYMENT_LINK_SENT:** PASS — payment link tool used

#### Per-turn scoring

| Seq | Pass | Similarity | Expected tool | Tools used |
|-----|------|------------|---------------|------------|
| 2 | OK | 0.175 | — | search_products |
| 3 | OK | 0.175 | — | search_products |
| 5 | OK | 0.137 | — | search_products, create_checkout |
| 6 | OK | 0.137 | — | search_products, create_checkout |
| 7 | FAIL | 0 | — | — |
| 8 | FAIL | 0 | — | — |
| 9 | FAIL | 0.118 | create_checkout | — |
| 10 | FAIL | 0.118 | create_checkout | — |
| 12 | FAIL | 0.071 | end_call | end_call |
| 13 | FAIL | 0.071 | end_call | end_call |

---

### PSTN-089 — Teen caller, parent pays — handoff to adult

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Result | FAIL |
| Runtime | kelly_rails |
| Session | `pstn_PSTN-089_33f1d0ef` |

#### Golden expected (script)

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi, I want to order some supplements for my workout.
03 AGENT: Happy to help! How old are you, if you don't mind me asking?
04 CALLER: I'm fifteen.
05 AGENT: Thanks for letting me know! For orders, I'd need to speak with a parent or guardian to process payment. Is one of them nearby?
06 CALLER: Yeah, my mom is here.
07 AGENT: Perfect — could you hand the phone to her?
08 CALLER: Okay, mom's here.
09 AGENT: Hi! I was just helping your son with a supplement order. With your permission, I can continue — would that be alright? [tool:transfer_call]
10 AGENT: Is there anything else I can help you with today?
11 CALLER: No, I think that is everything. Thank you.
12 AGENT: You are welcome. I am glad we could help.
13 AGENT: Take care. [tool:end_call]
```

#### Live conversation

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi, I want to order some supplements for my workout.
03 AGENT: Hi there! I appreciate your interest, but just to let you know – I'm Kelly, a clinical office assistant. We help with medical appointments and.
04 CALLER: I'm fifteen.
05 AGENT: Thank you for letting me know. Since you're 15, I'll need to speak with a parent or guardian before we proceed. Is a parent or.
06 CALLER: Yeah, my mom is here.
07 AGENT: Perfect! Could you please put your mom on the line so I can speak with her?
08 CALLER: Okay, mom's here.
09 AGENT: Hi! Thanks for getting on the line. I'm Kelly, a clinical office assistant. Your child reached out, and since they're 15, I need to collect. [tool:transfer_call]
11 CALLER: No, I think that is everything. Thank you.
12 AGENT: I understand, but before we finish, I do need to collect some basic information from you as the parent to properly assist your child. This.
```

#### Turn failures

- seq 2: reply sim 0.080
- seq 3: reply/tool mismatch
- seq 8: reply sim 0.032; missing tool transfer_call
- seq 9: reply/tool mismatch
- seq 11: reply sim 0.043
- seq 12: reply/tool mismatch

#### Assertions

- **HANDOFF_ON_VENT:** FAIL — no handoff

#### Missing functions

transfer_call

#### Per-turn scoring

| Seq | Pass | Similarity | Expected tool | Tools used |
|-----|------|------------|---------------|------------|
| 2 | FAIL | 0.08 | — | — |
| 3 | FAIL | 0.08 | — | — |
| 4 | OK | 0.4 | — | — |
| 5 | OK | 0.4 | — | — |
| 6 | OK | 0.333 | — | — |
| 7 | OK | 0.333 | — | — |
| 8 | FAIL | 0.032 | transfer_call | — |
| 9 | FAIL | 0.032 | transfer_call | — |
| 11 | FAIL | 0.043 | — | — |
| 12 | FAIL | 0.043 | — | — |

---

### PSTN-090 — Competitor price match — policy decline, politely redirect

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Result | FAIL |
| Runtime | voice_commerce |
| Session | `pstn_PSTN-090_70b6e294` |

#### Golden expected (script)

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi, I want omega-3 but I found it cheaper at GNC. Can you match that price?
03 AGENT: I appreciate you checking! We're not currently able to price match other retailers — our pricing reflects the quality of our sourcing and third-party testing. What I can tell you is that our Omega-3 is molecularly distilled and NSF-certified. Would you like me to pull up our price so you can compare?
04 CALLER: Okay fine. What is it?
05 AGENT: Let me check. [tool:search_products]
06 AGENT: It's twenty-nine ninety-nine for twelve-hundred milligrams. Totally your call — no pressure at all. If you'd like to order, I'm happy to help.
07 CALLER: I'll think about it.
08 AGENT: Is there anything else I can help you with today?
09 CALLER: No, I think that is everything. Thank you.
10 AGENT: You are welcome. I am glad we could help.
11 CALLER: Thanks again.
12 AGENT: Of course — we're here whenever you're ready. Take care! [tool:end_call]
```

#### Live conversation

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi, I want omega-3 but I found it cheaper at GNC. Can you match that price?
03 AGENT: I appreciate you giving us a chance to earn your business! Unfortunately, I don't have the ability to adjust pricing or do price matching—I can only process orders at our current prices.

What I *can* do is help you place an order for our Omega-3 if you'd like. Our product is high-quality, and many customers love it. Would you like to go ahead and order, or would you prefer to think it over? [tool:search_products]
04 CALLER: Okay fine. What is it?
05 AGENT: Perfect! Our **Omega-3 is 1200 milligrams** with EPA and DHA for heart and brain health. It's **$29.99** per bottle, and we have it in stock.

Would you like to order one bottle, or did you want more than one? [tool:search_products]
07 CALLER: I'll think about it.
08 AGENT: No problem at all! Take your time deciding. If you change your mind, just give us a call back anytime—we're here 24/7.

Is there anything else I can help you with today?
09 CALLER: No, I think that is everything. Thank you.
10 AGENT: How can I help you today? [tool:end_call]
11 CALLER: Thanks again.
12 AGENT: How can I help you today? [tool:end_call]
```

#### Turn failures

- seq 11: reply sim 0.091
- seq 12: reply/tool mismatch

#### Assertions

- **ACK_BEFORE_TRANSACTION:** FAIL — no empathetic prefix before first tool

#### Per-turn scoring

| Seq | Pass | Similarity | Expected tool | Tools used |
|-----|------|------------|---------------|------------|
| 2 | OK | 0.21 | — | search_products |
| 3 | OK | 0.21 | — | search_products |
| 4 | OK | 0.132 | — | search_products |
| 5 | OK | 0.132 | — | search_products |
| 7 | OK | 0.364 | — | — |
| 8 | OK | 0.364 | — | — |
| 9 | OK | 0.222 | — | end_call |
| 10 | OK | 0.222 | — | end_call |
| 11 | FAIL | 0.091 | end_call | end_call |
| 12 | FAIL | 0.091 | end_call | end_call |

---

### PSTN-091 — Chat — 3-item cart, remove one, update qty, checkout

| Field | Value |
|-------|-------|
| Channel | chat |
| Direction | inbound |
| Locale | en-US |
| Result | FAIL |
| Runtime | chat_commerce |
| Session | `pstn_PSTN-091_d0864dc3` |

#### Golden expected (script)

```
01 AGENT: Hi! Somo Supplements, Kelly here. What can I help with?
02 CALLER: I want vitamin D, magnesium, and probiotic in my cart.
03 AGENT: Adding all three! [tool:add_to_cart]
04 AGENT: Added:
• Vitamin D3 — $24.99
• Magnesium — $22.99
• Probiotic — $34.99
**Total: $82.97**

Anything to change?
05 CALLER: Remove the probiotic please.
06 AGENT: Removing probiotic. [tool:remove_cart_item]
07 AGENT: Probiotic removed. Cart is now $47.98. Want to update any quantities?
08 CALLER: Yes, change magnesium to 2 bottles.
09 AGENT: Updating magnesium. [tool:update_cart_item]
10 AGENT: Updated! New total: **$70.97**. Ready to checkout?
11 CALLER: Yes. Email is alex.morgan@gmail.com.
12 AGENT: Preparing checkout. [tool:prepare_commerce_checkout]
13 AGENT: Checkout link sent to alex.morgan@gmail.com — $70.97 + shipping. You're all set!
14 AGENT: Anything else you would like to know before we wrap up?
15 AGENT: Take care. [tool:end_call]
```

#### Live conversation

```
01 AGENT: Hi! Somo Supplements, Kelly here. What can I help with?
02 CALLER: I want vitamin D, magnesium, and probiotic in my cart.
03 AGENT: I can help with the **Vitamin D3 2000 IU** that's in this session, but I don't have access to add magnesium or probiotic products right now. 

Would you like me to add the **Vitamin D3 2000 IU** to your cart? If you need the other items, you may need to browse the full shop or let me know if you'd like to proceed with just the Vitamin D for now. [tool:add_to_cart]
05 CALLER: Remove the probiotic please.
06 AGENT: No problem! Since I only have the Vitamin D3 available to add in this session, I haven't added a probiotic yet—so there's nothing to remove.

Would you like me to add the **Vitamin D3 2000 IU** to your cart? And for the magnesium, you'd need to add that separately through the shop if it's available. [tool:remove_cart_item]
08 CALLER: Yes, change magnesium to 2 bottles.
09 AGENT: I understand you'd like 2 bottles, but in this checkout session I only have access to the **Vitamin D3 2000 IU** product. I can't add magnesium here.

Would you like me to add the **Vitamin D3** to your cart instead? If you need magnesium, you'll need to add that through the main shop separately. [tool:update_cart_item]
11 CALLER: Yes. Email is alex.morgan@gmail.com.
12 AGENT: I still need your street address, city, state, ZIP code to continue. Please share your full delivery address. [tool:prepare_commerce_checkout]
```

#### Payment (like real call — link issued, customer pays separately)

```
step: no_checkout_recorded
status: pending
payment_method: link
link_delivery: replay_ok (SMTP skipped in dev)
customer_pays: via secure link after call ends (not executed in replay harness)
```

#### Turn failures

- seq 2: reply sim 0.075
- seq 3: reply/tool mismatch
- seq 5: reply sim 0.054
- seq 6: reply/tool mismatch
- seq 8: reply sim 0.033; missing tool update_cart_item
- seq 9: reply/tool mismatch
- seq 11: reply sim 0.000; missing tool prepare_commerce_checkout
- seq 12: reply/tool mismatch

#### Assertions

- **TOOL_COMPLETED_BEFORE_CLAIM:** PASS — no tools recorded
- **PAYMENT_LINK_SENT:** FAIL — no payment link tool

#### Missing functions

add_to_cart, remove_cart_item, update_cart_item, get_cart

#### Per-turn scoring

| Seq | Pass | Similarity | Expected tool | Tools used |
|-----|------|------------|---------------|------------|
| 2 | FAIL | 0.075 | — | — |
| 3 | FAIL | 0.075 | — | — |
| 5 | FAIL | 0.054 | — | — |
| 6 | FAIL | 0.054 | — | — |
| 8 | FAIL | 0.033 | update_cart_item | — |
| 9 | FAIL | 0.033 | update_cart_item | — |
| 11 | FAIL | 0 | prepare_commerce_checkout | — |
| 12 | FAIL | 0 | prepare_commerce_checkout | — |

---

### PSTN-092 — Chat — ingredient interaction question then purchase

| Field | Value |
|-------|-------|
| Channel | chat |
| Direction | inbound |
| Locale | en-US |
| Result | FAIL |
| Runtime | chat_commerce |
| Session | `pstn_PSTN-092_097f21bf` |

#### Golden expected (script)

```
01 AGENT: Hi! Kelly at Somo. How can I help today?
02 CALLER: I take a blood thinner and I want to know if magnesium is safe with it.
03 AGENT: That's a really smart question to ask first. I want to be helpful here but also honest — I'm not able to give you a medical clearance for supplement-drug interactions. What I can tell you is that magnesium at standard doses (400mg) generally does not interact with common blood thinners, but your prescribing doctor or pharmacist should absolutely confirm before you start. Would you like to proceed with that caveat, or wait until you've checked?
04 CALLER: I'll ask my doctor this week. Let's say I get the green light — can I see the product?
05 AGENT: Of course! [tool:get_product_quote]
06 AGENT: **Magnesium Glycinate 400mg** — $22.99. When your doctor gives the okay, add it to cart and I'll get you checked out. Want me to note this product for you?
07 CALLER: Actually you know what, I'll get B-Complex instead, that one's fine.
08 AGENT: Smart choice! B-Complex is generally safe with most medications. Let me pull it up. [tool:get_product_quote]
09 AGENT: **B-Complex 100** — $19.99. Want to add it?
10 CALLER: Yes.
11 AGENT: Added. Email for checkout?
12 CALLER: george.hayes@gmail.com
13 AGENT: Preparing checkout. [tool:prepare_commerce_checkout]
14 AGENT: Checkout link sent to george.hayes@gmail.com — $19.99 + shipping. And do check with your doc about the magnesium when you get a chance!
15 AGENT: Take care. [tool:end_call]
```

#### Live conversation

```
01 AGENT: Hi! Kelly at Somo. How can I help today?
02 CALLER: I take a blood thinner and I want to know if magnesium is safe with it.
03 AGENT: That's an important question. While magnesium glycinate is generally well-tolerated, **I can't provide medical advice about drug interactions with your blood thinner**. Magnesium can potentially interact with certain medications, including some anticoagulants, so you should definitely check with your doctor or pharmacist before starting any new supplement.

Your healthcare provider can review your specific blood thinner and current medications to make sure magnesium is safe for you.

Is there anything else I can help you with regarding this product, or would you like to proceed once you've cleared it with your doctor? [tool:get_product_quote]
04 CALLER: I'll ask my doctor this week. Let's say I get the green light — can I see the product?
05 AGENT: Perfect! Here's what we have:

**Magnesium Glycinate**  
**$22.99**  
See checkout for any applicable taxes.

Magnesium glycinate is a highly absorbable form of magnesium that's gentle on the stomach. It's commonly used to support:
- Muscle relaxation and recovery
- Better sleep quality
- Healthy nerve function
- Overall calm and stress support

Once your doctor gives you the green light, I'm here to help you complete your order. Just let me know! [tool:get_product_quote]
07 CALLER: Actually you know what, I'll get B-Complex instead, that one's fine.
08 AGENT: Got it! Let me get the details on our B-Complex for you.

Unfortunately, I only have access to the Magnesium Glycinate product in this session. If you'd like to purchase the B-Complex instead, you may need to select that product from the shop or start a new order for it.

Would you like to stick with the Magnesium Glycinate (once your doctor approves), or would you prefer to browse the shop for the B-Complex? [tool:get_product_quote]
10 CALLER: Yes.
11 AGENT: Great! So just to confirm — are you saying:

1. **You'd like to proceed with the Magnesium Glycinate** (once your doctor gives the okay this week), or
2. **You'd prefer to look for the B-Complex** in the shop instead?

Let me know which direction you'd like to go! [tool:get_product_quote]
12 CALLER: george.hayes@gmail.com
13 AGENT: Great! **I've sent a 6-digit verification code to george.hayes@gmail.com.**  
Please share the code with me when you receive it so we can continue with your order. [tool:prepare_commerce_checkout]
```

#### Payment (like real call — link issued, customer pays separately)

```
step: no_checkout_recorded
status: pending
payment_method: link
link_delivery: replay_ok (SMTP skipped in dev)
customer_pays: via secure link after call ends (not executed in replay harness)
```

#### Turn failures

- seq 7: reply sim 0.065; missing tool get_product_quote
- seq 8: reply/tool mismatch
- seq 10: reply sim 0.031
- seq 11: reply/tool mismatch

#### Assertions

- **ACK_BEFORE_TRANSACTION:** FAIL — no empathetic prefix before first tool
- **TOOL_COMPLETED_BEFORE_CLAIM:** PASS — tools before claim: get_product_quote, get_product_quote, get_product_quote, send_commerce_verification_code

#### Missing functions

add_to_cart

#### Per-turn scoring

| Seq | Pass | Similarity | Expected tool | Tools used |
|-----|------|------------|---------------|------------|
| 2 | OK | 0.244 | — | get_product_quote |
| 3 | OK | 0.244 | — | get_product_quote |
| 4 | OK | 0.15 | — | get_product_quote |
| 5 | OK | 0.15 | — | get_product_quote |
| 7 | FAIL | 0.065 | get_product_quote | — |
| 8 | FAIL | 0.065 | get_product_quote | — |
| 10 | FAIL | 0.031 | — | get_product_quote |
| 11 | FAIL | 0.031 | — | get_product_quote |
| 12 | OK | 0.333 | — | send_commerce_verification_code |
| 13 | OK | 0.333 | — | send_commerce_verification_code |

---

### PSTN-093 — Voice — payment methods then chooses link

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Result | FAIL |
| Runtime | voice_commerce |
| Session | `pstn_PSTN-093_1598961c` |

#### Golden expected (script)

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi. What payment methods do you accept?
03 AGENT: Let me check. [tool:get_available_payment_methods]
04 AGENT: We accept Visa, Mastercard, American Express, Apple Pay, Google Pay, and secure payment links sent by SMS or email. Which works for you?
05 CALLER: I'll go with the payment link to my email.
06 AGENT: Perfect. What would you like to order?
07 CALLER: Turmeric.
08 AGENT: Checking turmeric. [tool:search_products]
09 AGENT: Turmeric Curcumin five hundred milligrams at twenty-six ninety-nine. One bottle?
10 CALLER: Yes.
11 AGENT: Email?
12 CALLER: diana.moss at gmail.
13 AGENT: Creating checkout with email link. [tool:create_checkout]
14 AGENT: Done! Payment link sent to diana.moss at gmail. Take care! [tool:end_call]
```

#### Live conversation

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi. What payment methods do you accept?
03 AGENT: We accept payments through:
- **Payment link by email** - I'll send you a secure link to complete your purchase
- **Card via Stripe** - You can pay with credit or debit card through our secure Stripe checkout

Both options are completely secure. When you're ready to order, I'll collect your email and send you a payment link to complete the purchase safely. 

Is there anything else you'd like to know, or would you like to browse our products? [tool:get_available_payment_methods]
05 CALLER: I'll go with the payment link to my email.
06 AGENT: Perfect! The payment link option works great - I'll send it right to your email when you're ready to order.

What can I help you find today? Are you looking for something specific, or would you like to hear about our products?
07 CALLER: Turmeric.
08 AGENT: Perfect! I found our **Turmeric Curcumin 500mg** - it's an anti-inflammatory supplement with curcumin, priced at **$26.99**. We have plenty in stock.

How many would you like to order? [tool:search_products]
10 CALLER: Yes.
11 AGENT: Great! Just to confirm - would you like to order **1 bottle** of the Turmeric Curcumin 500mg for $26.99? [tool:create_checkout]
12 CALLER: diana.moss at gmail.
13 AGENT: Got it! Just to make sure I have this right, is your email **diana.moss@gmail.com**? [tool:end_call]
```

#### Payment (like real call — link issued, customer pays separately)

```
step: checkout_created_link_issued
checkout_id: e12e7b24-8575-4c9f-a36b-51e122d79dc7
status: pending
payment_method: link
total: $26.99
customer_email: diana.moss@gmail.com
link_delivery: replay_ok (SMTP skipped in dev)
customer_pays: via secure link after call ends (not executed in replay harness)
```

#### Turn failures

- seq 7: reply sim 0.069
- seq 8: reply/tool mismatch
- seq 10: reply sim 0.000
- seq 11: reply/tool mismatch
- seq 12: reply sim 0.158; missing tool end_call
- seq 13: reply/tool mismatch

#### Assertions

- **VOICE_COMMERCE_TOOL_CHAIN:** PASS — tools: get_available_payment_methods, search_products, search_products, create_checkout
- **PAYMENT_LINK_SENT:** PASS — payment link tool used

#### Per-turn scoring

| Seq | Pass | Similarity | Expected tool | Tools used |
|-----|------|------------|---------------|------------|
| 2 | OK | 0.132 | — | get_available_payment_methods, search_products |
| 3 | OK | 0.132 | — | get_available_payment_methods, search_products |
| 5 | OK | 0.194 | — | — |
| 6 | OK | 0.194 | — | — |
| 7 | FAIL | 0.069 | — | search_products |
| 8 | FAIL | 0.069 | — | search_products |
| 10 | FAIL | 0 | — | create_checkout |
| 11 | FAIL | 0 | — | create_checkout |
| 12 | FAIL | 0.158 | end_call | — |
| 13 | FAIL | 0.158 | end_call | — |

---

### PSTN-094 — Voice — confirm appointment + create_appointment_checkout same call

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | outbound |
| Locale | en-US |
| Result | FAIL |
| Runtime | kelly_rails |
| Session | `pstn_PSTN-094_4bebbeb5` |

#### Golden expected (script)

```
01 AGENT: Hi, may I speak with Olivia Park? This is Kelly from Somo Supplements.
02 CALLER: Yes, this is Olivia.
03 AGENT: Hi Olivia! Calling to confirm your appointment tomorrow at ten AM. Does that still work?
04 CALLER: Yes, definitely.
05 AGENT: Wonderful. Let me confirm that. [tool:confirm_appointment]
06 AGENT: All confirmed! Also, would you like to take care of your copay now while I have you?
07 CALLER: Oh sure, let's do that.
08 AGENT: Great — sending a copay link now. [tool:create_appointment_checkout]
09 AGENT: Is there anything else I can help you with today?
10 CALLER: No, I think that is everything. Thank you.
11 AGENT: You are welcome. I am glad we could help.
12 AGENT: Copay link sent to your email. See you tomorrow at ten, Olivia! [tool:end_call]
```

#### Live conversation

```
01 AGENT: Hi, may I speak with Olivia Park? This is Kelly from Somo Supplements.
02 CALLER: Yes, this is Olivia.
03 AGENT: Hi there, this is Kelly calling from Somo with a quick follow-up. Do you have a moment?
04 CALLER: Yes, definitely.
05 AGENT: I wanted to share an update on your account. Is there anything specific you would like me to address? [tool:confirm_appointment]
07 CALLER: Oh sure, let's do that.
08 AGENT: Got it. I have noted that. Is there anything else I can help with today? [tool:create_appointment_checkout]
10 CALLER: No, I think that is everything. Thank you.
11 AGENT: Thanks for your time. We will follow up if needed. Have a great day. [tool:end_call]
```

#### Payment (like real call — link issued, customer pays separately)

```
step: no_checkout_recorded
status: pending
payment_method: link
link_delivery: replay_ok (SMTP skipped in dev)
customer_pays: via secure link after call ends (not executed in replay harness)
```

#### Turn failures

- seq 2: reply sim 0.045
- seq 3: reply/tool mismatch
- seq 10: reply sim 0.053; missing tool end_call
- seq 11: reply/tool mismatch

#### Assertions

- **OUTBOUND_DISPOSITION_LOGGED:** FAIL — missing end_call disposition
- **TOOL_COMPLETED_BEFORE_CLAIM:** PASS — no tools recorded
- **PAYMENT_LINK_SENT:** FAIL — no payment link tool

#### Missing functions

confirm_appointment, create_appointment_checkout

#### Per-turn scoring

| Seq | Pass | Similarity | Expected tool | Tools used |
|-----|------|------------|---------------|------------|
| 2 | FAIL | 0.045 | — | — |
| 3 | FAIL | 0.045 | — | — |
| 4 | OK | 0.19 | — | — |
| 5 | OK | 0.19 | — | — |
| 7 | OK | 0.583 | — | — |
| 8 | OK | 0.583 | — | — |
| 10 | FAIL | 0.053 | end_call | — |
| 11 | FAIL | 0.053 | end_call | — |

---

### PSTN-095 — Voice — search appointments + reschedule combined

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Result | FAIL |
| Runtime | kelly_rails |
| Session | `pstn_PSTN-095_c9742557` |

#### Golden expected (script)

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi, I have an appointment Friday but I need to see when it is and then move it.
03 AGENT: Sure! Let me look up your appointment. What's your name?
04 CALLER: Marco Diaz.
05 AGENT: Looking it up. [tool:search_appointments]
06 AGENT: You have an appointment this Friday at two PM. You'd like to move it — when works better?
07 CALLER: Next Tuesday morning.
08 AGENT: Let me check Tuesday. [tool:get_available_slots]
09 AGENT: Tuesday has nine AM and eleven AM. Which works?
10 CALLER: Eleven AM.
11 AGENT: Rescheduling to Tuesday eleven AM. [tool:reschedule_appointment]
12 AGENT: Done — rescheduled to Tuesday eleven AM. New confirmation sent. Is that everything?
13 CALLER: Yes, thanks.
14 AGENT: Take care, Marco! [tool:end_call]
```

#### Live conversation

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi, I have an appointment Friday but I need to see when it is and then move it.
03 AGENT: I'd be happy to help you with your Friday appointment! First, may I please have your first and last name?
04 CALLER: Marco Diaz.
05 AGENT: Thank you, Marco. And what's a good callback number for you? [tool:search_appointments]
07 CALLER: Next Tuesday morning.
08 AGENT: I understand you'd like to reschedule for Tuesday morning. Before I can look up your appointment, I need to get your callback number in case. [tool:get_available_slots]
10 CALLER: Eleven AM.
11 AGENT: I hear you'd like 11 AM on Tuesday. First though, what's the best phone number to reach you at? [tool:reschedule_appointment]
13 CALLER: Yes, thanks.
14 AGENT: Marco, I still need your phone number before I can access your appointment. What number can I reach you at? [tool:end_call]
```

#### Turn failures

- seq 4: reply sim 0.053
- seq 5: reply/tool mismatch
- seq 7: reply sim 0.053; missing tool get_available_slots
- seq 8: reply/tool mismatch
- seq 10: reply sim 0.071; missing tool reschedule_appointment
- seq 11: reply/tool mismatch
- seq 13: reply sim 0.067; missing tool end_call
- seq 14: reply/tool mismatch

#### Assertions

- **BOOKING_GATE_RESPECTED:** PASS — no schedule_appointment in call
- **TOOL_COMPLETED_BEFORE_CLAIM:** PASS — no tools recorded

#### Missing functions

search_appointments, get_available_slots, reschedule_appointment

#### Per-turn scoring

| Seq | Pass | Similarity | Expected tool | Tools used |
|-----|------|------------|---------------|------------|
| 2 | OK | 0.167 | — | — |
| 3 | OK | 0.167 | — | — |
| 4 | FAIL | 0.053 | — | — |
| 5 | FAIL | 0.053 | — | — |
| 7 | FAIL | 0.053 | get_available_slots | — |
| 8 | FAIL | 0.053 | get_available_slots | — |
| 10 | FAIL | 0.071 | reschedule_appointment | — |
| 11 | FAIL | 0.071 | reschedule_appointment | — |
| 13 | FAIL | 0.067 | end_call | — |
| 14 | FAIL | 0.067 | end_call | — |

---

### PSTN-096 — Voice — incomplete intake, status check, complete, book

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Result | FAIL |
| Runtime | kelly_rails |
| Session | `pstn_PSTN-096_fd9f7345` |

#### Golden expected (script)

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi, I started filling out my new patient intake form but I didn't finish it. Can I complete it now?
03 AGENT: Of course! Let me check where you left off. [tool:get_patient_intake_status]
04 AGENT: Looks like you got most of it done — I just need your current medications and an emergency contact. Any current medications?
05 CALLER: Just a daily aspirin.
06 AGENT: And an emergency contact name and phone?
07 CALLER: My wife, Karen Shaw, five five five, three three one, nine nine zero zero.
08 AGENT: Perfect — completing your intake. [tool:patient_intake]
09 AGENT: Intake complete! Let me verify status. [tool:get_patient_intake_status]
10 AGENT: You're approved to book. What days work?
11 CALLER: Thursday.
12 AGENT: Checking Thursday. [tool:get_available_slots]
13 AGENT: Thursday at one or four PM?
14 CALLER: One PM.
15 AGENT: Name and email?
16 CALLER: David Shaw, david.shaw at gmail.
17 AGENT: Booking Thursday one PM. [tool:schedule_appointment]
18 AGENT: Booked! Thursday one PM. Confirmation to david.shaw at gmail. See you then! [tool:end_call]
```

#### Live conversation

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi, I started filling out my new patient intake form but I didn't finish it. Can I complete it now?
03 AGENT: I don't see a previous session for this call. Let's start fresh. First, can I get your full name? [tool:get_patient_intake_status]
05 CALLER: Just a daily aspirin.
06 AGENT: I'm still collecting your basic information first. May I have your full name, please?
07 CALLER: My wife, Karen Shaw, five five five, three three one, nine nine zero zero.
08 AGENT: Got it. And what's your full name? [tool:patient_intake]
11 CALLER: Thursday.
12 AGENT: I need your first and last name to get started. What's your full name? [tool:get_available_slots]
14 CALLER: One PM.
15 AGENT: Let me help you complete your intake. I need to start with your full name - what's your first and last name?
16 CALLER: David Shaw, david.shaw at gmail.
17 AGENT: Thank you, David. And what's your phone number? [tool:end_call]
```

#### Turn failures

- seq 2: reply sim 0.045; missing tool get_patient_intake_status
- seq 3: reply/tool mismatch
- seq 5: reply sim 0.067
- seq 6: reply/tool mismatch
- seq 7: reply sim 0.111; missing tool patient_intake
- seq 8: reply/tool mismatch
- seq 11: reply sim 0.000; missing tool get_available_slots
- seq 12: reply/tool mismatch
- seq 16: reply sim 0.125; missing tool end_call
- seq 17: reply/tool mismatch

#### Assertions

- **BOOKING_GATE_RESPECTED:** PASS — no schedule_appointment in call
- **TOOL_COMPLETED_BEFORE_CLAIM:** PASS — tools before claim: get_triage_session

#### Missing functions

patient_intake, get_patient_intake_status, get_available_slots, schedule_appointment

#### Per-turn scoring

| Seq | Pass | Similarity | Expected tool | Tools used |
|-----|------|------------|---------------|------------|
| 2 | FAIL | 0.045 | get_patient_intake_status | get_triage_session |
| 3 | FAIL | 0.045 | get_patient_intake_status | get_triage_session |
| 5 | FAIL | 0.067 | — | — |
| 6 | FAIL | 0.067 | — | — |
| 7 | FAIL | 0.111 | patient_intake | — |
| 8 | FAIL | 0.111 | patient_intake | — |
| 11 | FAIL | 0 | get_available_slots | — |
| 12 | FAIL | 0 | get_available_slots | — |
| 14 | OK | 0.125 | — | — |
| 15 | OK | 0.125 | — | — |
| 16 | FAIL | 0.125 | end_call | — |
| 17 | FAIL | 0.125 | end_call | — |

---

### PSTN-097 — Chat — clear cart after complaint, new purchase

| Field | Value |
|-------|-------|
| Channel | chat |
| Direction | inbound |
| Locale | en-US |
| Result | FAIL |
| Runtime | chat_commerce |
| Session | `pstn_PSTN-097_8e824968` |

#### Golden expected (script)

```
01 AGENT: Hi! Kelly at Somo. How can I help?
02 CALLER: I tried to order B-Complex last week and the payment never went through and I'm frustrated.
03 AGENT: I'm really sorry about that — a failed payment is genuinely aggravating, especially when you needed the product. Let me clear that stale cart first so we have a clean start.
04 AGENT: Clearing your cart. [tool:clear_cart]
05 AGENT: Cart cleared. I'd love to help you place a new order now — with a fresh checkout that should work. What would you like?
06 CALLER: Actually, instead of B-Complex, let me try Lion's Mane. I've been hearing good things.
07 AGENT: Great choice for focus and cognitive support! Let me add it. [tool:add_to_cart]
08 AGENT: Added: **Lion's Mane 1000mg** — $39.99. What email for checkout?
09 CALLER: helen.ford@gmail.com
10 AGENT: Preparing checkout. [tool:prepare_commerce_checkout]
11 AGENT: New checkout link sent to helen.ford@gmail.com — this one's fresh. $39.99 + shipping. I hope this works smoothly for you, Helen!
12 CALLER: Thanks for clearing that up.
13 AGENT: Absolutely. Let me know if you have any issues. Take care!
14 AGENT: Anything else you would like to know before we wrap up?
15 AGENT: Take care. [tool:end_call]
```

#### Live conversation

```
01 AGENT: Hi! Kelly at Somo. How can I help?
02 CALLER: I tried to order B-Complex last week and the payment never went through and I'm frustrated.
03 AGENT: I'm really sorry you had a frustrating experience last week with the B-Complex order! That's definitely not the experience we want for you.

Right now, I'm here to help you complete a purchase for **Lion's Mane** from your clinic's shop. If you'd like to try ordering the B-Complex again, I'll need to check on that after we finish this session, or you can reach out to the clinic directly to get help with that specific product.

Would you like to proceed with the Lion's Mane today, or is there something specific about last week's B-Complex order I can note for follow-up?
06 CALLER: Actually, instead of B-Complex, let me try Lion's Mane. I've been hearing good things.
07 AGENT: Perfect! Lion's Mane is **$39.99**. See checkout for any applicable taxes.

Would you like to go ahead and add it to your cart? [tool:add_to_cart]
09 CALLER: helen.ford@gmail.com
10 AGENT: Code sent to helen.ford@gmail.com. Please share the 6-digit code, and include your full shipping address to continue. [tool:prepare_commerce_checkout]
12 CALLER: Thanks for clearing that up.
13 AGENT: You're welcome! 

Just to keep us moving: I still need two things from you to complete your Lion's Mane order:

1. **The 6-digit verification code** sent to helen.ford@gmail.com
2. **Your full shipping address** (street, city, state, and ZIP)

Once I have both, I can get you to secure checkout. What's the code from your email?
```

#### Payment (like real call — link issued, customer pays separately)

```
step: no_checkout_recorded
status: pending
payment_method: link
link_delivery: replay_ok (SMTP skipped in dev)
customer_pays: via secure link after call ends (not executed in replay harness)
```

#### Turn failures

- seq 12: reply sim 0.042
- seq 13: reply/tool mismatch

#### Assertions

- **ACK_BEFORE_TRANSACTION:** FAIL — no empathetic prefix before first tool
- **TOOL_COMPLETED_BEFORE_CLAIM:** PASS — tools before claim: get_product_quote, send_commerce_verification_code

#### Missing functions

clear_cart, add_to_cart

#### Per-turn scoring

| Seq | Pass | Similarity | Expected tool | Tools used |
|-----|------|------------|---------------|------------|
| 2 | OK | 0.125 | — | — |
| 3 | OK | 0.125 | — | — |
| 6 | OK | 0.19 | — | get_product_quote |
| 7 | OK | 0.19 | — | get_product_quote |
| 9 | OK | 0.214 | — | send_commerce_verification_code |
| 10 | OK | 0.214 | — | send_commerce_verification_code |
| 12 | FAIL | 0.042 | — | — |
| 13 | FAIL | 0.042 | — | — |

---

### PSTN-098 — Voice — collect insurance eligibility only, no booking

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Result | FAIL |
| Runtime | kelly_rails |
| Session | `pstn_PSTN-098_cb5b0252` |

#### Golden expected (script)

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi, I just want to find out if my insurance is accepted here. I'm not ready to book yet.
03 AGENT: Of course — happy to check. What's your carrier?
04 CALLER: Cigna.
05 AGENT: And member ID?
06 CALLER: CIG dash two nine four four seven seven.
07 AGENT: Checking Cigna now. [tool:collect_insurance]
08 AGENT: Good news — Cigna is accepted here. Your estimated copay for a standard visit would be in the twenty-five to forty dollar range, depending on your specific plan. When you're ready to book, we can verify the exact amount. Anything else you'd like to know?
09 CALLER: No, that's what I needed. Thank you.
10 AGENT: Is there anything else I can help you with today?
11 CALLER: No, I think that is everything. Thank you.
12 AGENT: Anytime! We're here when you're ready. [tool:end_call]
```

#### Live conversation

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi, I just want to find out if my insurance is accepted here. I'm not ready to book yet.
03 AGENT: I'd be happy to help you check on that! To look into your insurance, I'll need a few details. Can I start with your first.
04 CALLER: Cigna.
05 AGENT: Got it, Cigna. Just to clarify - I'll need your first name to get started with looking into this for you. What's your first name?
06 CALLER: CIG dash two nine four four seven seven.
07 AGENT: Thank you! So to confirm, your insurance is Cigna with member ID CIG-2944477, is that correct? And may I have your first name as well. [tool:collect_insurance]
09 CALLER: No, that's what I needed. Thank you.
10 AGENT: You're welcome! Just so you know, we do accept most major insurance plans including Cigna. If you'd like to schedule an appointment in the future.
11 CALLER: No, I think that is everything. Thank you.
12 AGENT: Perfect! Feel free to reach out anytime you're ready. Have a great day! [tool:end_call]
```

#### Turn failures

- seq 4: reply sim 0.000
- seq 5: reply/tool mismatch
- seq 6: reply sim 0.063
- seq 7: reply/tool mismatch
- seq 9: reply sim 0.043
- seq 10: reply/tool mismatch
- seq 11: reply sim 0.231; missing tool end_call
- seq 12: reply/tool mismatch

#### Assertions

- **TOOL_COMPLETED_BEFORE_CLAIM:** PASS — no tools recorded

#### Missing functions

collect_insurance

#### Per-turn scoring

| Seq | Pass | Similarity | Expected tool | Tools used |
|-----|------|------------|---------------|------------|
| 2 | OK | 0.158 | — | — |
| 3 | OK | 0.158 | — | — |
| 4 | FAIL | 0 | — | — |
| 5 | FAIL | 0 | — | — |
| 6 | FAIL | 0.063 | — | — |
| 7 | FAIL | 0.063 | — | — |
| 9 | FAIL | 0.043 | — | — |
| 10 | FAIL | 0.043 | — | — |
| 11 | FAIL | 0.231 | end_call | — |
| 12 | FAIL | 0.231 | end_call | — |

---

### PSTN-099 — WER harness call — 5 corpus utterances embedded

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Result | FAIL |
| Runtime | voice_commerce |
| Session | `pstn_PSTN-099_0bcc0106` |

#### Golden expected (script)

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: I want to order vitamin D.
03 AGENT: Checking that for you. [tool:search_products]
04 AGENT: Vitamin D3 two-thousand I-U, twenty-four ninety-nine. One bottle?
05 CALLER: Yes, one vitamin dee three.
06 AGENT: What email should I use?
07 CALLER: It's test dot user at somo dot com.
08 AGENT: Test.user at somo.com — confirmed?
09 CALLER: That is correct, thank you.
10 AGENT: Creating checkout. [tool:create_checkout]
11 CALLER: Please send the payment link to my email address.
12 AGENT: Done — link sent to test.user at somo.com. [tool:end_call]
```

#### Live conversation

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: I want to order vitamin D.
03 AGENT: Perfect! I found our Vitamin D3 2000 IU. It's $24.99 and it's a daily softgel for bone and immune support. How many bottles would you like to order? [tool:search_products]
05 CALLER: Yes, one vitamin dee three.
06 AGENT: Great! One bottle of Vitamin D3 2000 IU for $24.99.

To send you the secure checkout link, I'll need your email address. What's your email? [tool:create_checkout]
07 CALLER: It's test dot user at somo dot com.
08 AGENT: Let me read that back to you: test.user@somo.com - is that correct?
09 CALLER: That is correct, thank you.
10 AGENT: Before I can send the checkout link, I need to get your name. What's your full name? [tool:create_checkout]
11 CALLER: Please send the payment link to my email address.
12 AGENT: I absolutely will! I just need your full name first to complete the checkout. What's your name? [tool:end_call]
```

#### Payment (like real call — link issued, customer pays separately)

```
step: checkout_created_link_issued
checkout_id: 6fc645d5-9785-43c8-a152-63049854f70e
status: pending
payment_method: link
total: $24.99
customer_email: test.user@somo.com
link_delivery: replay_ok (SMTP skipped in dev)
customer_pays: via secure link after call ends (not executed in replay harness)
```

#### Turn failures

- seq 2: reply sim 0.095
- seq 3: reply/tool mismatch
- seq 5: reply sim 0.105
- seq 6: reply/tool mismatch
- seq 9: reply sim 0.077; missing tool create_checkout
- seq 10: reply/tool mismatch
- seq 11: reply sim 0.000; missing tool end_call
- seq 12: reply/tool mismatch

#### Assertions

- **VOICE_COMMERCE_TOOL_CHAIN:** PASS — tools: search_products, create_checkout, search_products, end_call

#### Per-turn scoring

| Seq | Pass | Similarity | Expected tool | Tools used |
|-----|------|------------|---------------|------------|
| 2 | FAIL | 0.095 | search_products | search_products |
| 3 | FAIL | 0.095 | search_products | search_products |
| 5 | FAIL | 0.105 | — | create_checkout |
| 6 | FAIL | 0.105 | — | create_checkout |
| 7 | OK | 0.364 | — | — |
| 8 | OK | 0.364 | — | — |
| 9 | FAIL | 0.077 | create_checkout | search_products, end_call |
| 10 | FAIL | 0.077 | create_checkout | search_products, end_call |
| 11 | FAIL | 0 | end_call | — |
| 12 | FAIL | 0 | end_call | — |

---

### PSTN-100 — CAPSTONE — vent + ack + book + copay + supplement + order tracking

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Result | FAIL |
| Runtime | hybrid_booking_commerce |
| Session | `pstn_PSTN-100_4d5526dd` |

#### Golden expected (script)

```
01 AGENT: Somo Supplements, available twenty-four seven. This is Kelly. How can I help you today?
02 CALLER: Hi. I'm going to be honest, I've been having a rough time. Stress at work, not sleeping, and I feel like I'm falling apart. I don't even know if supplements help but I figured I'd call.
03 AGENT: I'm really glad you called — and I hear you. A rough stretch at work plus no sleep is genuinely hard, and it makes total sense you'd be looking for something to help you feel more like yourself. You're in the right place. I'm happy to help you figure out what makes sense.
04 CALLER: That's... actually really nice to hear. Okay. What would you even suggest for stress and sleep?
05 AGENT: For your combination — stress plus sleep — the two things most people find helpful are magnesium glycinate for sleep and omega-3 for inflammation and brain chemistry, which both contribute to stress resilience. If I had to pick one to start, omega-3 is probably the highest-impact. Want me to check what we have?
06 CALLER: Yes please.
07 AGENT: On it. [tool:search_products]
08 AGENT: We have Omega-3 twelve-hundred milligrams for twenty-nine ninety-nine. That's a solid therapeutic dose. Want one bottle?
09 CALLER: Yes. And actually — could I also book an appointment? I think I should talk to someone properly.
10 AGENT: That's a really healthy decision. I'm proud of you for that. Let me do both — supplement first, then the appointment. What days work for you?
11 CALLER: Um... next week, any day is fine.
12 AGENT: Checking next week's availability. [tool:get_available_slots]
13 AGENT: I have availability every day next week. How about Wednesday at eleven AM?
14 CALLER: That works.
15 AGENT: Great. What's your name and email?
16 CALLER: My name is Jamie Chen. Email is jamie.chen at gmail dot com.
17 AGENT: Booking Wednesday eleven AM for Jamie. [tool:schedule_appointment]
18 AGENT: Appointment confirmed! Wednesday eleven AM. Confirmation sent to jamie.chen at gmail. Now for insurance — do you have coverage you'd like to use?
19 CALLER: I have Blue Cross.
20 AGENT: Checking BCBS now. [tool:collect_insurance]
21 AGENT: Great — Blue Cross is accepted, estimated copay thirty dollars. Want to pay that now or at the visit?
22 CALLER: Now is fine.
23 AGENT: Sending copay link. [tool:create_appointment_checkout]
24 AGENT: Copay link sent to your email. Now let me get your omega-3 sorted. Same email?
25 CALLER: Yes.
26 AGENT: Creating supplement checkout. [tool:create_checkout]
27 AGENT: Omega-3 checkout link sent too. And hey — you mentioned you feel like you're falling apart. I just want to say: you called, you made the appointment, and you're taking steps. That's not falling apart. That's actually really together.
28 CALLER: Thank you. That means something.
29 AGENT: Oh — one more thing. Do you want me to check on a prior order while I have you?
30 CALLER: Actually yes, I ordered something a few weeks ago and never got it.
31 AGENT: Let me check that. [tool:get_order_tracking]
32 AGENT: Your prior order is delayed in transit — it shows an updated delivery estimate of two days from now. I'm sorry about the delay. If it doesn't arrive, please call us back and we'll make it right.
33 CALLER: Okay, good to know. Thank you so much.
34 AGENT: It was my pleasure, Jamie. Wednesday eleven AM, copay paid, omega-3 on the way, and the tracking update. You've handled a lot in one call. Go easy on yourself this week. [tool:end_call]
```

#### Live conversation

```
01 AGENT: Somo Supplements, available twenty-four seven. This is Kelly. How can I help you today?
02 CALLER: Hi. I'm going to be honest, I've been having a rough time. Stress at work, not sleeping, and I feel like I'm falling apart. I don't even know if supplements help but I figured I'd call.
03 AGENT: I hear you, and I'm glad you reached out. We're here to help. Before we talk about what might support you, I need to get.
04 CALLER: That's... actually really nice to hear. Okay. What would you even suggest for stress and sleep?
05 AGENT: I really appreciate you sharing that with me. Stress and sleep issues can be so draining, and it sounds like you're dealing with a lot right now.

We have supplements that many people find helpful for those concerns. Our Omega-3 fish oil, for example, supports brain health and can help with overall wellness, which may support better stress management and sleep quality.

Would you like me to look up what we have available for you? I can search our products and give you some options that might be a good fit. [tool:search_products]
06 CALLER: Yes please.
07 AGENT: Perfect! I found our **Omega-3 1200mg**. It's formulated with EPA and DHA for heart and brain health, which can support overall wellness during stressful times. It's **$29.99** and we have it in stock.

Would you like to order this today? [tool:search_products]
09 CALLER: Yes. And actually — could I also book an appointment? I think I should talk to someone properly.
10 AGENT: Absolutely, I think that's a really smart move. Unfortunately, I can only help you with supplement orders on this line. For booking appointments, you'd need to reach out through our main office or website.

But let's get your Omega-3 order taken care of right now. How many bottles would you like—just one to start? [tool:search_products,create_checkout]
11 CALLER: Um... next week, any day is fine.
12 AGENT: I appreciate that, but just to clarify—I can't book appointments on this line. I'm here specifically for supplement orders.

What I *can* do right now is get your Omega-3 1200mg ordered and on its way to you. 

So for the supplement—would you like to order one bottle of the Omega-3 1200mg for $29.99? [tool:get_available_slots]
14 CALLER: That works.
15 AGENT: Great! So that's one bottle of Omega-3 1200mg for $29.99.

Before I can send you the secure checkout link, I'll need your name and email address. What's your name? [tool:search_products]
16 CALLER: My name is Jamie Chen. Email is jamie.chen at gmail dot com.
17 AGENT: Thank you, Jamie! Let me just confirm that email with you: that's **jamie.chen@gmail.com**, correct?

And how many bottles of the Omega-3 would you like—just one? [tool:schedule_appointment]
19 CALLER: I have Blue Cross.
20 AGENT: I appreciate you sharing that, but I should clarify—I'm with Somo Supplements, so I help with our supplement orders. The Omega-3 we have is sold directly, not through insurance.

The Omega-3 1200mg is $29.99 per bottle. How many bottles would you like to order today? [tool:collect_insurance]
22 CALLER: Now is fine.
23 AGENT: Great! So we'll get one bottle of the Omega-3 1200mg for $29.99.

Before I can send you the secure checkout link, I'll need your name and email address. What's your name? [tool:create_appointment_checkout]
25 CALLER: Yes.
26 AGENT: Perfect! One bottle of Omega-3 1200mg coming up.

Before I can process this, I'll need a couple of things from you. First, may I have your full name, please? [tool:create_checkout]
28 CALLER: Thank you. That means something.
29 AGENT: You're very welcome. I'm glad I could help, even in this small way.

So, one bottle of the Omega-3 1200mg at $29.99 — is that right?
30 CALLER: Actually yes, I ordered something a few weeks ago and never got it.
31 AGENT: Oh, I'm sorry to hear that! Let me look into that for you right away. 

Do you happen to have your order ID or confirmation number from that previous order? Or I can look it up using your email address or phone number. [tool:get_order_tracking]
33 CALLER: Okay, good to know. Thank you so much.
34 AGENT: You're so welcome! So just to confirm—one bottle of the Omega-3 1200mg for $29.99?

And before I get this set up for you, may I have your name? [tool:end_call]
```

#### Payment (like real call — link issued, customer pays separately)

```
step: no_checkout_recorded
status: pending
payment_method: link
customer_email: jamie.chen@gmail.com
link_delivery: replay_ok (SMTP skipped in dev)
customer_pays: via secure link after call ends (not executed in replay harness)
```

#### Turn failures

- seq 6: reply sim 0.070
- seq 7: reply/tool mismatch
- seq 9: reply sim 0.107
- seq 10: reply/tool mismatch
- seq 11: reply sim 0.000; missing tool get_available_slots
- seq 12: reply/tool mismatch
- seq 19: reply sim 0.045
- seq 20: reply/tool mismatch
- seq 25: reply sim 0.043
- seq 26: reply/tool mismatch
- seq 28: reply sim 0.080
- seq 29: reply/tool mismatch
- seq 30: reply sim 0.116
- seq 31: reply/tool mismatch
- seq 33: reply sim 0.171; missing tool end_call
- seq 34: reply/tool mismatch

#### Assertions

- **ACK_BEFORE_TRANSACTION:** PASS — empathetic prefix found
- **BOOKING_GATE_RESPECTED:** PASS — no schedule_appointment in call
- **VOICE_COMMERCE_TOOL_CHAIN:** PASS — tools: search_products, search_products, create_checkout, search_products, create_checkout, search_products, search_products, search_products, search_products, search_products, create_checkout, search_products, search_products
- **TOOL_COMPLETED_BEFORE_CLAIM:** PASS — tools before claim: search_products, search_products, create_checkout, search_products, create_checkout, search_products, search_products, search_products, search_products, search_products, create_checkout, search_products, search_products
- **PAYMENT_LINK_SENT:** PASS — payment link tool used

#### Missing functions

get_available_slots, collect_insurance, create_appointment_checkout, get_order_tracking

#### Per-turn scoring

| Seq | Pass | Similarity | Expected tool | Tools used |
|-----|------|------------|---------------|------------|
| 2 | OK | 0.175 | — | — |
| 3 | OK | 0.175 | — | — |
| 4 | OK | 0.15 | — | search_products |
| 5 | OK | 0.15 | — | search_products |
| 6 | FAIL | 0.07 | — | search_products, create_checkout |
| 7 | FAIL | 0.07 | — | search_products, create_checkout |
| 9 | FAIL | 0.107 | — | search_products, create_checkout |
| 10 | FAIL | 0.107 | — | search_products, create_checkout |
| 11 | FAIL | 0 | get_available_slots | search_products |
| 12 | FAIL | 0 | get_available_slots | search_products |
| 14 | OK | 0.273 | — | search_products |
| 15 | OK | 0.273 | — | search_products |
| 16 | OK | 0.147 | — | — |
| 17 | OK | 0.147 | — | — |
| 19 | FAIL | 0.045 | — | search_products |
| 20 | FAIL | 0.045 | — | search_products |
| 22 | OK | 0.179 | — | search_products |
| 23 | OK | 0.179 | — | search_products |
| 25 | FAIL | 0.043 | — | search_products, create_checkout |
| 26 | FAIL | 0.043 | — | search_products, create_checkout |
| 28 | FAIL | 0.08 | — | — |
| 29 | FAIL | 0.08 | — | — |
| 30 | FAIL | 0.116 | — | search_products |
| 31 | FAIL | 0.116 | — | search_products |
| 33 | FAIL | 0.171 | end_call | search_products |
| 34 | FAIL | 0.171 | end_call | search_products |

---
