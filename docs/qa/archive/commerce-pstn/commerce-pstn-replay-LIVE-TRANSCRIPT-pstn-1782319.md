# Commerce PSTN Replay 100 — Live Transcript Book

> Run `pstn-1782319841829-620d32` at 2026-06-24T16:50:41.832Z

**1 calls executed** — conversation then payment, as in production PSTN flow.

Each call: live agent replies after golden caller lines, then payment/checkout outcome.

---

### PSTN-001 — Inbound — run-down caller buys Vitamin D, SMS checkout

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Result | FAIL |
| Runtime | voice_commerce |
| Session | `pstn_PSTN-001_960acf8f` |

#### Golden expected (script)

```
01 AGENT: Thank you for calling Somo Supplements, twenty-four seven. This is Kelly. How can I help you today?
02 CALLER: Hi, um, I've been really run down lately and someone told me vitamin D might help?
03 AGENT: That makes total sense — a lot of people find vitamin D makes a real difference for energy and mood, especially if you're not getting much sun. I can help you order some right now. Are you looking to order today?
04 CALLER: Yeah, I'd like to order if that's okay.
05 AGENT: Absolutely. Let me check what we have in stock for you. [tool:search_products]
06 AGENT: Great news — we have Vitamin D3 two-thousand I-U for twenty-four ninety-nine. That's a solid everyday dose. Would you like one bottle?
07 CALLER: Yes, one bottle please.
08 AGENT: Perfect. What's the best email address for your receipt and payment link?
09 CALLER: It's sarah dot miller at gmail dot com.
10 AGENT: Let me read that back: s-a-r-a-h dot m-i-l-l-e-r at gmail dot com — is that right?
11 CALLER: Yes, that's correct.
12 AGENT: One moment while I set that up for you. [tool:create_checkout]
13 AGENT: Done! I've sent a secure payment link to your email and a text to the number you're calling from. The link is good for twenty-four hours. Is there anything else I can help you with today?
14 CALLER: No, that's great. Thank you so much.
15 AGENT: You're very welcome, Sarah. Take care and feel better soon. [tool:end_call]
```

#### Live conversation

```
01 AGENT: Thank you for calling Somo Supplements, twenty-four seven. This is Kelly. How can I help you today?
02 CALLER: Hi, um, I've been really run down lately and someone told me vitamin D might help?
03 AGENT: Hi there! I'm sorry to hear you've been feeling run down—that can be really tough. Vitamin D can definitely make a difference, especially if you're not getting much sun exposure. A lot of people find it helps with energy levels and overall well-being.

Whenever you're ready to order, I'd be happy to help you get that set up. Would you like to go ahead and place an order for vitamin D today? [tool:search_products]
04 CALLER: Yeah, I'd like to order if that's okay.
05 AGENT: Perfect! I found our Vitamin D3 2000 IU supplement. It's a daily softgel that supports bone and immune health, and it's $24.99. We have it in stock.

How many bottles would you like to order? [tool:search_products]
07 CALLER: Yes, one bottle please.
08 AGENT: Great! One bottle of Vitamin D3 2000 IU it is.

Before I process your order, may I have your full name, please?
09 CALLER: It's sarah dot miller at gmail dot com.
10 AGENT: I appreciate that! I'll need your full name first, and then I'll collect your email address. 

What's your full name?
11 CALLER: Yes, that's correct.
12 AGENT: I want to make sure I get your name right. Could you please tell me your first and last name? [tool:create_checkout]
14 CALLER: No, that's great. Thank you so much.
15 AGENT: Perfect! So I have one bottle of Vitamin D3 2000 IU for you at $24.99.

To complete your order, I'll need your email address so I can send you a secure payment link. What's your email address? [tool:end_call]
```

#### Payment (like real call — link issued, customer pays separately)

```
step: checkout_created_link_issued
checkout_id: 51e8bb45-a302-48ef-99d2-521dfabba276
status: pending
payment_method: link
total: $24.99
customer_email: sarah.miller@gmail.com
link_delivery: replay_ok (SMTP skipped in dev)
customer_pays: via secure link after call ends (not executed in replay harness)
```

#### Turn failures

- seq 7: reply sim 0.040
- seq 8: reply/tool mismatch
- seq 9: reply sim 0.050
- seq 10: reply/tool mismatch
- seq 11: reply sim 0.081
- seq 12: reply/tool mismatch
- seq 14: reply sim 0.034
- seq 15: reply/tool mismatch
