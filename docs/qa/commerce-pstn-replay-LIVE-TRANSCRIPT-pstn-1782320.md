# Commerce PSTN Replay 100 — Live Transcript Book

> Run `pstn-1782320940002-0c8928` at 2026-06-24T17:09:00.007Z

**3 calls executed** — conversation then payment, as in production PSTN flow.

Each call: live agent replies after golden caller lines, then payment/checkout outcome.

---

### PSTN-041 — Confirm appointment — day-before confirmation call (outbound)

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | outbound |
| Locale | en-US |
| Result | FAIL |
| Runtime | kelly_rails |
| Session | `pstn_PSTN-041_37738eea` |

#### Golden expected (script)

```
01 AGENT: Hi, may I speak with Sandra Lee? This is Kelly calling from Somo Supplements.
02 CALLER: Yes, this is Sandra.
03 AGENT: Hi Sandra! I'm calling to confirm your supplement consult appointment tomorrow at ten AM. Does that still work for you?
04 CALLER: Yes, I'll be there.
05 AGENT: Wonderful. We'll see you tomorrow at ten. If anything changes, please call us back. Have a great night! [tool:confirm_appointment]
06 AGENT: Is there anything else I can help you with today?
07 CALLER: No, I think that is everything. Thank you.
08 AGENT: You are welcome. I am glad we could help.
09 CALLER: Thanks again.
10 AGENT: Of course — take care.
11 AGENT: Is there anything else I can help you with today?
12 AGENT: Goodbye! [tool:end_call]
```

#### Live conversation

```
01 AGENT: Hi, may I speak with Sandra Lee? This is Kelly calling from Somo Supplements.
02 CALLER: Yes, this is Sandra.
03 AGENT: Hi there, this is Kelly calling from Somo with a quick follow-up. Do you have a moment?
04 CALLER: Yes, I'll be there.
05 AGENT: I wanted to share an update on your account. Is there anything specific you would like me to address? [tool:confirm_appointment]
07 CALLER: No, I think that is everything. Thank you.
08 AGENT: Thanks for your time. We will follow up if needed. Have a great day.
09 CALLER: Thanks again.
10 AGENT: If you would prefer to speak with someone on our team, I can arrange a callback. Would that help?
```

#### Turn failures

- seq 2: reply sim 0.080
- seq 3: reply/tool mismatch
- seq 7: reply sim 0.000
- seq 8: reply/tool mismatch

### PSTN-042 — Mid-booking symptom change — returns to triage, re-OPQRST, books

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Result | FAIL |
| Runtime | kelly_rails |
| Session | `pstn_PSTN-042_6754b721` |

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
03 AGENT: No problem! I can help you add that new symptom to your intake. What symptom would you like to mention?
04 CALLER: I've had a headache every day this week and I also feel dizzy sometimes.
05 AGENT: When did this start?
06 CALLER: Sure.
07 AGENT: I'm asking when the headache and dizziness started – was it earlier this week, or did it begin before that? [tool:store_triage_opqrst]
08 CALLER: About a week.
09 AGENT: Got it. Can you describe what the headache feels like? For example, is it throbbing, sharp, dull, or pressure-like.
10 CALLER: Mostly the back of my head.
11 AGENT: Thanks. And what does it feel like – is it throbbing, sharp, dull, pressure, or something else? [tool:store_triage_opqrst]
12 CALLER: No nausea. Vision seems fine.
13 AGENT: I appreciate that information. I still need to know what the headache feels like – is it a dull ache, sharp pain, throbbing, pressure, or.
14 CALLER: Honestly... probably not.
15 AGENT: No problem. Let me ask a different way – on a scale of 1 to 10, with 10 being the worst pain imaginable, how would. [tool:run_triage_rag]
17 CALLER: Yes please.
18 AGENT: I'd like to help you book an appointment. Before I look up available slots, I need a bit more information: 1. What type of appointment.
19 CALLER: Thursday.
20 AGENT: Perfect! Let me check what appointment slots we have available on Thursday for you. To look up the available times, I need to know: 1. [tool:get_available_slots]
22 CALLER: Eleven AM.
23 AGENT: Great! Let me search for appointments available around 11 AM on Thursday. Just to confirm – are you looking for a general visit, or is.
24 CALLER: Nina Patel, nina.patel at gmail.
25 AGENT: Thank you, Nina. To find the right appointment slots for you on Thursday around 11 AM, I need to know what type of visit you. [tool:end_call]
```

#### Turn failures

- seq 2: reply sim 0.048
- seq 3: reply/tool mismatch
- seq 4: reply sim 0.000
- seq 5: reply/tool mismatch
- seq 6: reply sim 0.048; missing tool store_triage_opqrst
- seq 7: reply/tool mismatch
- seq 8: reply sim 0.042
- seq 9: reply/tool mismatch
- seq 10: reply sim 0.000; missing tool store_triage_opqrst
- seq 11: reply/tool mismatch
- seq 12: reply sim 0.042
- seq 13: reply/tool mismatch
- seq 14: reply sim 0.065
- seq 15: reply/tool mismatch
- seq 17: reply sim 0.059
- seq 18: reply/tool mismatch
- seq 19: reply sim 0.059; missing tool get_available_slots
- seq 20: reply/tool mismatch
- seq 22: reply sim 0.000
- seq 23: reply/tool mismatch
- seq 24: reply sim 0.065; missing tool end_call
- seq 25: reply/tool mismatch

### PSTN-043 — Document upload link — rash photo before async telehealth visit

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Result | FAIL |
| Runtime | kelly_rails |
| Session | `pstn_PSTN-043_22a601d7` |

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
05 AGENT: Thank you, Dana. I have your email as dana.reeves@gmail.com. Since we're gathering your clinical information today, can you tell me what brings you in? What's. [tool:send_document_upload_link]
07 CALLER: No that's all I needed. Thank you.
08 AGENT: You're very welcome, Dana! If you need anything else, feel free to reach out. Have a great day!
09 CALLER: No, I think that is everything. Thank you.
10 AGENT: My pleasure, Dana! Take care and have a wonderful day!
11 CALLER: Thanks again.
12 AGENT: Anytime, Dana! Bye now! [tool:end_call]
```

#### Turn failures

- seq 9: reply sim 0.000
- seq 10: reply/tool mismatch
- seq 11: reply sim 0.100; missing tool end_call
- seq 12: reply/tool mismatch
