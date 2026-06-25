# Commerce PSTN Replay 100 — Transcript Book

> Generated from `commerce-pstn-replay-100.json` at 2026-06-24T14:43:06.458Z

**100 calls** — 81 voice, 19 chat

Human-readable QA sign-off artifact. Replay harness feeds **caller** lines sequentially; agent lines are golden expected outputs.

---

## Block 1: Voice supplement purchase

### PSTN-001 — Inbound — run-down caller buys Vitamin D, SMS checkout

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | search_products, create_checkout, end_call |
| Turns | 15 |

**Assertions:** ACK_BEFORE_TRANSACTION, VOICE_COMMERCE_TOOL_CHAIN, TOOL_COMPLETED_BEFORE_CLAIM, PAYMENT_LINK_SENT

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

### PSTN-002 — Energy caller — compares multivitamin vs iron, buys multivitamin

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | search_products, create_checkout, end_call |
| Turns | 13 |

**Assertions:** ACK_BEFORE_TRANSACTION, VOICE_COMMERCE_TOOL_CHAIN, PAYMENT_LINK_SENT

```
01 AGENT: Somo Supplements, this is Kelly. How can I help?
02 CALLER: Hey I need more energy. I was thinking either a multivitamin or iron supplements. Not sure which.
03 AGENT: Good question — both can help but for different reasons. If your diet is generally balanced, a daily multivitamin covers the full spectrum including B vitamins which are big for energy. Iron is more targeted and really only helps if you're actually deficient. Unless a doctor told you your iron is low, I'd usually start with a multivitamin. Want me to pull up what we have?
04 CALLER: Yeah let's go with the multivitamin.
05 AGENT: Great choice. Checking now. [tool:search_products]
06 AGENT: We have our Daily Multivitamin for twenty-seven ninety-nine. It's got your full A through Z plus a B-complex boost. Sound good?
07 CALLER: Yeah that works.
08 AGENT: What email should I send the payment link to?
09 CALLER: Marcus dot james at hotmail dot com.
10 AGENT: Marcus.james at hotmail.com — got it. Creating your checkout now. [tool:create_checkout]
11 AGENT: Payment link is on its way to your email. Anything else today?
12 CALLER: Nope, that's it.
13 AGENT: Perfect. Hope you get your energy back soon, Marcus. Goodbye. [tool:end_call]
```

### PSTN-003 — Two-SKU browse — omega-3 + probiotic, qty 2 omega

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | search_products, create_checkout, end_call |
| Turns | 15 |

**Assertions:** VOICE_COMMERCE_TOOL_CHAIN, TOOL_COMPLETED_BEFORE_CLAIM, PAYMENT_LINK_SENT

```
01 AGENT: Somo Supplements, Kelly here. What can I do for you?
02 CALLER: Hi, I want to order omega-3 and also a probiotic.
03 AGENT: Love that combination — great for inflammation and gut health together. Let me look both up. [tool:search_products]
04 AGENT: We have Omega-3 twelve-hundred milligrams at twenty-nine ninety-nine, and our Probiotic fifty-billion CFU at thirty-four ninety-nine. How many of each were you thinking?
05 CALLER: Two bottles of the omega and one probiotic.
06 AGENT: Two omega-3 and one probiotic — that's ninety-four ninety-seven total. Sound right?
07 CALLER: Yeah that's fine.
08 AGENT: What email for the payment link?
09 CALLER: It's d-e-v-o-n dot price at yahoo dot com.
10 AGENT: Devon.price at yahoo.com — confirmed?
11 CALLER: Yes.
12 AGENT: Perfect. Setting that up for you now. [tool:create_checkout]
13 AGENT: Done — secure link is headed to your email. Both items ship together. Anything else?
14 CALLER: No I'm good, thank you.
15 AGENT: Great, take care Devon. [tool:end_call]
```

### PSTN-004 — After-hours — orders magnesium, no "we are closed" message

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | search_products, create_checkout, end_call |
| Turns | 13 |

**Assertions:** VOICE_COMMERCE_TOOL_CHAIN, PAYMENT_LINK_SENT

```
01 AGENT: Somo Supplements, Kelly here — we're available twenty-four seven. How can I help you tonight?
02 CALLER: Oh good, I wasn't sure if anyone would answer. I need magnesium. I've been having trouble sleeping.
03 AGENT: You're in the right place — we never close. Magnesium glycinate is actually one of the best forms for sleep. Let me check stock for you. [tool:search_products]
04 AGENT: We have Magnesium Glycinate four-hundred milligrams for twenty-two ninety-nine. It's the gentle form, easy on the stomach. Want to order one bottle?
05 CALLER: Yes please.
06 AGENT: What email for the checkout link?
07 CALLER: Priya dot sharma at gmail.
08 AGENT: Priya.sharma at gmail.com?
09 CALLER: Yes that's right.
10 AGENT: Creating your checkout now. [tool:create_checkout]
11 AGENT: Link is on its way to your email. Hope you get some great sleep soon, Priya!
12 CALLER: Thank you! I appreciate it being available so late.
13 AGENT: That's what we're here for — anytime. Take care. [tool:end_call]
```

### PSTN-005 — Low stock — caller wants 5 B-Complex, only 2 left

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | search_products, create_checkout, end_call |
| Turns | 13 |

**Assertions:** VOICE_COMMERCE_TOOL_CHAIN, TOOL_COMPLETED_BEFORE_CLAIM

```
01 AGENT: Somo Supplements, this is Kelly. How can I help?
02 CALLER: Hi I want to order five bottles of B-Complex.
03 AGENT: Let me check our current inventory on that. [tool:search_products]
04 AGENT: I want to be upfront with you — we actually only have two bottles of B-Complex in stock right now. I'd hate to say five and then have to disappoint you. Would two bottles work for now? We'd also have more arriving soon.
05 CALLER: Hmm. Two is better than nothing I guess. Okay.
06 AGENT: Totally understand, and I appreciate your flexibility. Two bottles at nineteen ninety-nine each comes to thirty-nine ninety-eight. What email for the payment link?
07 CALLER: Carter dot webb at outlook dot com.
08 AGENT: Carter.webb at outlook.com — is that right?
09 CALLER: Yeah.
10 AGENT: Processing your order for two bottles now. [tool:create_checkout]
11 AGENT: Great — link sent to your email. And if you'd like to be notified when we're restocked, just call back and we can add you to the list. Anything else?
12 CALLER: No that's good, thanks.
13 AGENT: Thanks Carter, have a good one. [tool:end_call]
```

### PSTN-006 — Payment methods inquiry — Mastercard on file, confirm then checkout

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | get_available_payment_methods, search_products, create_checkout, end_call |
| Turns | 16 |

**Assertions:** VOICE_COMMERCE_TOOL_CHAIN, PAYMENT_LINK_SENT

```
01 AGENT: Somo Supplements, Kelly here. How can I help you today?
02 CALLER: Hi, I want to order omega-3 but first can you tell me what payment methods you accept?
03 AGENT: Of course! Let me pull that up for you. [tool:get_available_payment_methods]
04 AGENT: We accept all major credit and debit cards — Visa, Mastercard, American Express — as well as Apple Pay and Google Pay. Payment is handled through a secure link I send to your email or phone. Does Mastercard work for you?
05 CALLER: Yeah Mastercard is fine.
06 AGENT: Perfect. Let me look up the omega-3. [tool:search_products]
07 AGENT: We have Omega-3 twelve-hundred milligrams for twenty-nine ninety-nine. Sound good?
08 CALLER: Yes, one bottle please.
09 AGENT: What email should I send the payment link to?
10 CALLER: Jordan at brightlife dot co.
11 AGENT: Jordan at brightlife.co — confirmed?
12 CALLER: Yes.
13 AGENT: Creating your secure checkout now. [tool:create_checkout]
14 AGENT: Link sent to your email. You'll be charged once you click through and confirm. Anything else?
15 CALLER: No, that's all. Thanks.
16 AGENT: Thanks Jordan. Take care. [tool:end_call]
```

### PSTN-007 — Wrong email code once — reprompt, correct code, checkout completes

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | search_products, create_checkout, verify_checkout_code, end_call |
| Turns | 16 |

**Assertions:** VOICE_COMMERCE_TOOL_CHAIN, TOOL_COMPLETED_BEFORE_CLAIM

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: I want to order Vitamin D.
03 AGENT: Absolutely! Let me check that for you. [tool:search_products]
04 AGENT: Vitamin D3 two-thousand I-U for twenty-four ninety-nine. Want one bottle?
05 CALLER: Yes.
06 AGENT: What email for the link?
07 CALLER: Alex dot burns at gmail dot com.
08 AGENT: Alex.burns at gmail.com — got it. [tool:create_checkout]
09 AGENT: I've sent a six-digit verification code to your email. Go ahead and read it to me when you're ready.
10 CALLER: Um... is it three three seven?
11 AGENT: Hmm, that doesn't match what I'm seeing — it's six digits. Do you want me to resend the code?
12 CALLER: Oh wait, I see it now. It's four four one nine two seven.
13 AGENT: Let me verify that. [tool:verify_checkout_code]
14 AGENT: That's correct! Your order is confirmed. You'll get an email receipt shortly. Anything else?
15 CALLER: No, thank you.
16 AGENT: Take care, Alex. [tool:end_call]
```

### PSTN-008 — Spanish-locale caller — full dialogue in Spanish, buys Vitamin D

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | es-US |
| Functions | search_products, create_checkout, end_call |
| Turns | 13 |

**Assertions:** SPANISH_LOCALE_RESPECTED, VOICE_COMMERCE_TOOL_CHAIN, PAYMENT_LINK_SENT

```
01 AGENT: Gracias por llamar a Somo Suplementos, disponibles las veinticuatro horas. Soy Kelly. ¿En qué le puedo ayudar hoy?
02 CALLER: Hola, quiero comprar vitamina D. ¿Tienen?
03 AGENT: ¡Por supuesto! Déjeme verificar nuestro inventario ahora mismo. [tool:search_products]
04 AGENT: Sí, tenemos Vitamina D3 dos mil unidades internacionales por veinticuatro con noventa y nueve dólares. ¿Le mando un enlace de pago?
05 CALLER: Sí, por favor.
06 AGENT: ¿A qué correo electrónico le envío el enlace?
07 CALLER: Es carmen punto vargas en hotmail punto com.
08 AGENT: Carmen.vargas en hotmail.com — ¿correcto?
09 CALLER: Sí, correcto.
10 AGENT: Perfecto. Creando su pedido ahora. [tool:create_checkout]
11 AGENT: ¡Listo! Le envié el enlace de pago seguro a su correo. ¿Hay algo más en lo que pueda ayudarle?
12 CALLER: No, muchas gracias.
13 AGENT: Con gusto, Carmen. ¡Que tenga un excelente día! [tool:end_call]
```

### PSTN-009 — Homophone confusion — "ion" misheard as iron, clarified to Iron Chelate

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | search_products, create_checkout, end_call |
| Turns | 13 |

**Assertions:** VOICE_COMMERCE_TOOL_CHAIN

```
01 AGENT: Somo Supplements, Kelly here. What can I help you with?
02 CALLER: Hi I want to order some ion supplements.
03 AGENT: Did you say iron — as in iron supplements for blood and energy?
04 CALLER: Yes, iron, sorry. I need it for my iron levels.
05 AGENT: No worries at all! Iron supplements — let me check what we have. [tool:search_products]
06 AGENT: So I want to be honest — our current catalog doesn't have a standalone iron supplement at the moment. The closest we have is our B-Complex which includes some iron as part of the blend. That said, for specific iron deficiency a standalone iron chelate is usually better. Would you like the B-Complex, or would you prefer I note a request for iron to our team?
07 CALLER: Oh. Yeah the B-Complex could work for now.
08 AGENT: Sounds good. B-Complex one hundred for nineteen ninety-nine. What email?
09 CALLER: Tony dot reeves at gmail dot com.
10 AGENT: Tony.reeves at gmail.com. [tool:create_checkout]
11 AGENT: Link is on its way. And I'll pass along your interest in a standalone iron supplement to our team. Anything else?
12 CALLER: No thanks.
13 AGENT: Take care Tony. [tool:end_call]
```

### PSTN-010 — Noisy line — "omega three" clarified through ASR noise, checkout

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | search_products, create_checkout, end_call |
| Turns | 13 |

**Assertions:** VOICE_COMMERCE_TOOL_CHAIN

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Yeah hi I want to order — — three supplements.
03 AGENT: I'm sorry, the line is a bit fuzzy. Did you say omega-three supplements?
04 CALLER: Yes! Omega-three. Sorry, bad signal.
05 AGENT: No problem at all. Let me look that up. [tool:search_products]
06 AGENT: We have Omega-3 twelve-hundred milligrams for twenty-nine ninety-nine. Want to order one?
07 CALLER: Yeah, one bottle please.
08 AGENT: What email for the payment link? Take your time so I catch it right.
09 CALLER: Kim dot nguyen at — — yahoo dot com.
10 AGENT: I caught kim.nguyen but lost the domain — was that yahoo.com?
11 CALLER: Yes, yahoo dot com.
12 AGENT: Perfect. Kim.nguyen at yahoo.com. One moment. [tool:create_checkout]
13 AGENT: Link sent to your email. Thanks for your patience with the connection, Kim. Take care. [tool:end_call]
```

### PSTN-011 — Barge-in during email spell — corrected mid-utterance

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | search_products, create_checkout, end_call |
| Turns | 15 |

**Assertions:** VOICE_COMMERCE_TOOL_CHAIN, PAYMENT_LINK_SENT

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi I'd like to order vitamin D please.
03 AGENT: Of course! Let me check our stock. [tool:search_products]
04 AGENT: Vitamin D3 two-thousand I-U for twenty-four ninety-nine. One bottle?
05 CALLER: Yes.
06 AGENT: Great. What email should I use?
07 CALLER: It's j-a-n-e two at — wait, no — that's wrong.
08 AGENT: No worries — take your time. What's the correct address?
09 CALLER: Sorry, it's j-a-n-e dot s-m-i-t-h at gmail dot com.
10 AGENT: Jane.smith at gmail.com — got it this time. Confirmed?
11 CALLER: Yes that's right.
12 AGENT: Creating your checkout now. [tool:create_checkout]
13 AGENT: Done — link is on its way to Jane.smith at gmail. Anything else?
14 CALLER: No, thank you.
15 AGENT: Have a great day! [tool:end_call]
```

### PSTN-012 — Order tracking — prior order status check

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | get_order_tracking, end_call |
| Turns | 12 |

**Assertions:** TOOL_COMPLETED_BEFORE_CLAIM

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi, I ordered omega-3 a few days ago and I'm trying to figure out where it is.
03 AGENT: I can help you track that. Can you give me the email address used for the order?
04 CALLER: It's devon.price at yahoo dot com.
05 AGENT: Devon.price at yahoo.com — let me check that for you. [tool:get_order_tracking]
06 AGENT: Good news — your order shipped two days ago and is estimated to arrive tomorrow. You should receive a tracking email if you haven't already. Is there anything else I can help with?
07 CALLER: Oh great, that's perfect. No, I'm good.
08 AGENT: Is there anything else I can help you with today?
09 CALLER: No, I think that is everything. Thank you.
10 AGENT: You are welcome. I am glad we could help.
11 CALLER: Thanks again.
12 AGENT: Wonderful. Enjoy the omega-3, Devon! [tool:end_call]
```

### PSTN-013 — Browse only — "what do you sell?" caller hangs up politely

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | search_products, end_call |
| Turns | 12 |

**Assertions:** ACK_BEFORE_TRANSACTION

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi, what kinds of supplements do you carry?
03 AGENT: Great question! We carry a pretty wide range. Our top categories are: vitamins — like D3, B-Complex, and multivitamins; omega-3 fish oil; minerals like magnesium; gut health like probiotics; nootropics like Lion's Mane; and performance supplements like creatine. Is any of those catching your eye? [tool:search_products]
04 CALLER: Interesting. I'm just browsing for now, getting a feel.
05 AGENT: Totally fine — no pressure. We're here whenever you're ready to order, any time of day. Anything specific you'd like to know more about?
06 CALLER: No, I think I'm good for now. Thank you.
07 AGENT: Is there anything else I can help you with today?
08 CALLER: No, I think that is everything. Thank you.
09 AGENT: You are welcome. I am glad we could help.
10 CALLER: Thanks again.
11 AGENT: Of course — take care.
12 AGENT: Of course. Have a great day! [tool:end_call]
```

### PSTN-014 — Stressed caller — agent acknowledges stress before searching product

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | search_products, create_checkout, end_call |
| Turns | 13 |

**Assertions:** ACK_BEFORE_TRANSACTION, VOICE_COMMERCE_TOOL_CHAIN, PAYMENT_LINK_SENT

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi. I've been having a really rough week. I'm exhausted all the time and someone suggested vitamin D might help.
03 AGENT: I'm sorry to hear it's been a rough one — exhaustion like that is really draining. Vitamin D is actually a great first thing to look at, especially if you're not getting much sunshine or your diet is light on it. Let me see what we have in stock for you. [tool:search_products]
04 AGENT: We have Vitamin D3 two-thousand I-U for twenty-four ninety-nine. It's one of our most popular. Would you like to order a bottle?
05 CALLER: Yes please, that sounds good.
06 AGENT: What email for the payment link?
07 CALLER: Mia dot chen at gmail dot com.
08 AGENT: Mia.chen at gmail.com?
09 CALLER: That's right.
10 AGENT: Perfect. [tool:create_checkout]
11 AGENT: Link is heading to your email now. I hope you start feeling better soon — and get some rest if you can, Mia.
12 CALLER: Thank you, I appreciate that.
13 AGENT: Of course. Take good care. [tool:end_call]
```

### PSTN-015 — Cross-intent — books consult then buys multivitamin same call

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | get_available_slots, schedule_appointment, search_products, create_checkout, end_call |
| Turns | 23 |

**Assertions:** ACK_BEFORE_TRANSACTION, VOICE_COMMERCE_TOOL_CHAIN, BOOKING_GATE_RESPECTED, PAYMENT_LINK_SENT

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi, I'd like to book a supplement consultation but also buy a multivitamin today if that's possible.
03 AGENT: Absolutely, we can do both! Let me start with the appointment and then we'll get your multivitamin sorted. What days work best for you?
04 CALLER: Sometime next week, Tuesday or Wednesday.
05 AGENT: Let me check availability. [tool:get_available_slots]
06 AGENT: Great — I have Tuesday at ten AM, Tuesday at two PM, or Wednesday at eleven AM. Any of those work?
07 CALLER: Tuesday at two works.
08 AGENT: Perfect. Let me get a few quick details. What's your name?
09 CALLER: Ryan Torres.
10 AGENT: And a good email for your confirmation?
11 CALLER: Ryan dot torres at gmail dot com.
12 AGENT: Got it. Booking Tuesday at two PM for Ryan Torres. [tool:schedule_appointment]
13 AGENT: Done — you're booked for Tuesday at two. You'll get an email confirmation. Now for the multivitamin — want me to search what we have?
14 CALLER: Yes please.
15 AGENT: Looking that up now. [tool:search_products]
16 AGENT: We have our Daily Multivitamin for twenty-seven ninety-nine. One bottle?
17 CALLER: Yes, one.
18 AGENT: Using the same email — ryan.torres at gmail.com?
19 CALLER: Yes.
20 AGENT: Creating your checkout now. [tool:create_checkout]
21 AGENT: Payment link is headed to your email. So you're all set — appointment Tuesday at two and your multivitamin on the way. Anything else, Ryan?
22 CALLER: No, that's perfect. Thank you!
23 AGENT: My pleasure. See you Tuesday! [tool:end_call]
```

## Block 2: Chat supplement purchase

### PSTN-016 — Chat — education then quote, verify, ship, checkout

| Field | Value |
|-------|-------|
| Channel | chat |
| Direction | inbound |
| Locale | en-US |
| Functions | get_product_quote, send_commerce_verification_code, verify_commerce_code, save_shipping_address, prepare_commerce_checkout, end_call |
| Turns | 21 |

**Assertions:** ACK_BEFORE_TRANSACTION, TOOL_COMPLETED_BEFORE_CLAIM, PAYMENT_LINK_SENT

```
01 AGENT: Hi! Welcome to Somo Supplements — available 24/7. I'm Kelly. What can I help you with today?
02 CALLER: Hi, I'm curious about vitamin D. What's it good for exactly?
03 AGENT: Great question! Vitamin D3 is one of those foundational nutrients people don't think about until they're deficient. It supports bone density, immune function, and mood regulation — and studies show it plays a role in reducing fatigue. Most adults in northern climates are low without realizing it. Typical supplementation is 1000–2000 IU daily. Want me to pull up our product and price?
04 CALLER: Yes please.
05 AGENT: Here you go. [tool:get_product_quote]
06 AGENT: **Vitamin D3 2000 IU** — $24.99 per bottle. Ships in 2–3 business days. Ready to add to cart?
07 CALLER: Yes, add one please.
08 AGENT: Added! Can I get your email to send a verification code before checkout?
09 CALLER: lisa.park@icloud.com
10 AGENT: Sending verification code now. [tool:send_commerce_verification_code]
11 AGENT: Code sent to lisa.park@icloud.com. What's the code?
12 CALLER: It's 881432.
13 AGENT: Verifying. [tool:verify_commerce_code]
14 AGENT: Verified! What's your shipping address?
15 CALLER: 42 Oak Street, Portland, Oregon, 97201.
16 AGENT: Saving that. [tool:save_shipping_address]
17 AGENT: Saved. Preparing your checkout now. [tool:prepare_commerce_checkout]
18 AGENT: Your order is all set — payment link sent to your email. Total: $24.99 + shipping. Anything else?
19 CALLER: No, that's great. Thank you!
20 AGENT: Enjoy your vitamin D, Lisa! 🌟
21 AGENT: Take care. [tool:end_call]
```

### PSTN-017 — Chat — add magnesium + omega, view cart, checkout

| Field | Value |
|-------|-------|
| Channel | chat |
| Direction | inbound |
| Locale | en-US |
| Functions | add_to_cart, get_cart, prepare_commerce_checkout, end_call |
| Turns | 15 |

**Assertions:** VOICE_COMMERCE_TOOL_CHAIN, PAYMENT_LINK_SENT

```
01 AGENT: Welcome to Somo Supplements! I'm Kelly. What can I get for you?
02 CALLER: I want to add magnesium and omega-3 to my cart.
03 AGENT: On it! Adding both now. [tool:add_to_cart]
04 AGENT: Added: **Magnesium Glycinate 400mg** ($22.99) and **Omega-3 1200mg** ($29.99). Want to see your full cart?
05 CALLER: Yes please.
06 AGENT: Pulling that up. [tool:get_cart]
07 AGENT: Your cart:
• Magnesium Glycinate — $22.99
• Omega-3 1200mg — $29.99
**Total: $52.98**

Anything else to add, or ready to check out?
08 CALLER: That's everything. Ready to checkout.
09 AGENT: Great. What email for your order?
10 CALLER: omar.hassan@gmail.com
11 AGENT: Preparing your checkout. [tool:prepare_commerce_checkout]
12 AGENT: Checkout link sent to omar.hassan@gmail.com. Total $52.98 + shipping. Any questions?
13 CALLER: Nope, looks good!
14 AGENT: Awesome. Your order is on its way, Omar!
15 AGENT: Take care. [tool:end_call]
```

### PSTN-018 — Chat — qty 2 omega-3, quote confirms total, checkout

| Field | Value |
|-------|-------|
| Channel | chat |
| Direction | inbound |
| Locale | en-US |
| Functions | get_product_quote, add_to_cart, prepare_commerce_checkout, end_call |
| Turns | 15 |

**Assertions:** TOOL_COMPLETED_BEFORE_CLAIM, PAYMENT_LINK_SENT

```
01 AGENT: Hi! Somo Supplements here, I'm Kelly. What can I help with?
02 CALLER: I want two bottles of omega-3. Can you quote me first?
03 AGENT: Of course! [tool:get_product_quote]
04 AGENT: **Two bottles of Omega-3 1200mg** = $59.98 total. Shipping is calculated at checkout. Want to proceed?
05 CALLER: Yes, that matches what I expected. Let's go.
06 AGENT: Adding two omega-3 to cart. [tool:add_to_cart]
07 AGENT: Added! What email for the checkout link?
08 CALLER: bella.morgan@icloud.com
09 AGENT: Preparing checkout for Bella. [tool:prepare_commerce_checkout]
10 AGENT: Checkout link sent to bella.morgan@icloud.com — $59.98 + shipping. Any questions?
11 CALLER: Nope, perfect. Thanks.
12 AGENT: Enjoy the omega-3, Bella! Let us know if you need anything. 💙
13 AGENT: Anything else you would like to know before we wrap up?
14 CALLER: No, that is all for now.
15 AGENT: Take care. [tool:end_call]
```

### PSTN-019 — Chat — switches product: add Vit D, clear cart, new probiotic quote

| Field | Value |
|-------|-------|
| Channel | chat |
| Direction | inbound |
| Locale | en-US |
| Functions | add_to_cart, clear_cart, get_product_quote, prepare_commerce_checkout, end_call |
| Turns | 15 |

**Assertions:** VOICE_COMMERCE_TOOL_CHAIN

```
01 AGENT: Welcome to Somo! I'm Kelly. What are you looking for today?
02 CALLER: Add vitamin D please.
03 AGENT: Added Vitamin D3 to your cart. [tool:add_to_cart]
04 CALLER: Actually, wait — I want to start over. I'd rather get probiotics.
05 AGENT: No problem at all! Let me clear your cart. [tool:clear_cart]
06 AGENT: Cart's cleared. Let me pull up the probiotic for you. [tool:get_product_quote]
07 AGENT: **Probiotic 50B CFU** — $34.99 per bottle. Great for gut health and immune support. Want to add it?
08 CALLER: Yes please.
09 AGENT: Added probiotic to cart. What email for checkout?
10 CALLER: diana.ross at outlook dot com.
11 AGENT: Preparing checkout for Diana. [tool:prepare_commerce_checkout]
12 AGENT: Payment link sent to diana.ross@outlook.com. $34.99 + shipping. All good?
13 CALLER: Perfect, thank you.
14 AGENT: You're welcome, Diana! Enjoy. 😊
15 AGENT: Take care. [tool:end_call]
```

### PSTN-020 — Chat — update cart qty 1→2, confirm, checkout

| Field | Value |
|-------|-------|
| Channel | chat |
| Direction | inbound |
| Locale | en-US |
| Functions | update_cart_item, get_cart, prepare_commerce_checkout, end_call |
| Turns | 15 |

**Assertions:** TOOL_COMPLETED_BEFORE_CLAIM, PAYMENT_LINK_SENT

```
01 AGENT: Hi again! Kelly here. What can I help with?
02 CALLER: I have magnesium in my cart but I want to change it to two bottles.
03 AGENT: Sure thing — updating now. [tool:update_cart_item]
04 AGENT: Updated! You now have **2x Magnesium Glycinate** — $45.98 total. Want to see your cart to confirm?
05 CALLER: Yes please.
06 AGENT: Here's your cart. [tool:get_cart]
07 AGENT: **Cart:**
• Magnesium Glycinate x2 — $45.98

Looks good?
08 CALLER: Perfect. Let's checkout.
09 AGENT: What email?
10 CALLER: victor.bell@yahoo.com
11 AGENT: Processing checkout for Victor. [tool:prepare_commerce_checkout]
12 AGENT: Checkout link sent! $45.98 + shipping. Anything else?
13 CALLER: Nope, all good.
14 AGENT: Great. Thanks Victor!
15 AGENT: Take care. [tool:end_call]
```

### PSTN-021 — Chat — remove one of two cart items, checkout single SKU

| Field | Value |
|-------|-------|
| Channel | chat |
| Direction | inbound |
| Locale | en-US |
| Functions | remove_cart_item, get_cart, prepare_commerce_checkout, end_call |
| Turns | 15 |

**Assertions:** TOOL_COMPLETED_BEFORE_CLAIM, PAYMENT_LINK_SENT

```
01 AGENT: Hi! Kelly here at Somo. What can I help with?
02 CALLER: I have magnesium and probiotic in my cart but I want to remove the probiotic.
03 AGENT: On it — removing the probiotic now. [tool:remove_cart_item]
04 AGENT: Probiotic removed! Your cart now has just **Magnesium Glycinate** at $22.99. Want to checkout?
05 CALLER: Yes please.
06 AGENT: Let me pull up your cart to confirm. [tool:get_cart]
07 AGENT: **Cart:** Magnesium Glycinate x1 — $22.99. What email?
08 CALLER: nina.foster@gmail.com
09 AGENT: Preparing checkout. [tool:prepare_commerce_checkout]
10 AGENT: Checkout link sent to nina.foster@gmail.com — $22.99 + shipping. 😊
11 CALLER: Perfect, thanks.
12 AGENT: You're welcome Nina!
13 AGENT: Anything else you would like to know before we wrap up?
14 CALLER: No, that is all for now.
15 AGENT: Take care. [tool:end_call]
```

### PSTN-022 — Chat — wrong verification code, resend, verify, checkout

| Field | Value |
|-------|-------|
| Channel | chat |
| Direction | inbound |
| Locale | en-US |
| Functions | send_commerce_verification_code, verify_commerce_code, prepare_commerce_checkout, end_call |
| Turns | 16 |

**Assertions:** TOOL_COMPLETED_BEFORE_CLAIM, PAYMENT_LINK_SENT

```
01 AGENT: Hi! Somo Supplements, Kelly speaking. How can I help?
02 CALLER: I want to order Lion's Mane. I've added it to cart already.
03 AGENT: Awesome choice — great for focus. What email for verification?
04 CALLER: ethan.clark@gmail.com
05 AGENT: Sending code. [tool:send_commerce_verification_code]
06 AGENT: Code sent! What's the code from your email?
07 CALLER: Hmm... 345?
08 AGENT: That doesn't look right — codes are six digits. Want me to resend?
09 CALLER: Yes please, I couldn't find the email.
10 AGENT: Resending now. [tool:send_commerce_verification_code]
11 AGENT: New code sent. Take your time.
12 CALLER: Got it — 729514.
13 AGENT: Verifying. [tool:verify_commerce_code]
14 AGENT: Verified! Preparing your checkout. [tool:prepare_commerce_checkout]
15 AGENT: Payment link sent — Lion's Mane 1000mg, $39.99 + shipping. You're all set, Ethan!
16 AGENT: Take care. [tool:end_call]
```

### PSTN-023 — Chat — full address read-back, save, checkout

| Field | Value |
|-------|-------|
| Channel | chat |
| Direction | inbound |
| Locale | en-US |
| Functions | save_shipping_address, get_product_quote, prepare_commerce_checkout, end_call |
| Turns | 15 |

**Assertions:** TOOL_COMPLETED_BEFORE_CLAIM, PAYMENT_LINK_SENT

```
01 AGENT: Hey! Somo here, I'm Kelly. What can I help with?
02 CALLER: I want creatine. Can I give you my shipping address?
03 AGENT: Of course! Go ahead.
04 CALLER: It's 88 Maple Avenue, Apartment 4B, Chicago, Illinois, 60601.
05 AGENT: Let me read that back: 88 Maple Avenue, Apartment 4B, Chicago, IL 60601 — is that right?
06 CALLER: Yes, perfect.
07 AGENT: Saving that. [tool:save_shipping_address]
08 AGENT: Address saved. Let me pull up the creatine. [tool:get_product_quote]
09 AGENT: **Creatine Monohydrate 5g** — $32.99/bag. Want to order one?
10 CALLER: Yes, and my email is james.wu@gmail.com.
11 AGENT: Preparing checkout for James. [tool:prepare_commerce_checkout]
12 AGENT: Checkout link on its way to james.wu@gmail.com. Shipping to Maple Ave. 💪
13 CALLER: Perfect, thanks!
14 AGENT: Anytime. Get those gains, James!
15 AGENT: Take care. [tool:end_call]
```

### PSTN-024 — Chat — payment poll, confirmed

| Field | Value |
|-------|-------|
| Channel | chat |
| Direction | inbound |
| Locale | en-US |
| Functions | prepare_commerce_checkout, get_checkout_payment_status, end_call |
| Turns | 15 |

**Assertions:** TOOL_COMPLETED_BEFORE_CLAIM

```
01 AGENT: Hi! Kelly at Somo. How can I help?
02 CALLER: I finished checkout I think but I'm not sure if the payment went through.
03 AGENT: Let me check on that for you. [tool:prepare_commerce_checkout]
04 AGENT: Let me check the payment status. [tool:get_checkout_payment_status]
05 AGENT: Great news — your payment went through successfully! Your order is confirmed and will ship in 2–3 business days. 🎉
06 CALLER: Oh perfect, thank you!
07 AGENT: Of course! You'll get a shipment confirmation email when it's on its way.
08 AGENT: Anything else you would like to know before we wrap up?
09 CALLER: No, that is all for now.
10 AGENT: Happy to help anytime.
11 CALLER: Great, thanks.
12 AGENT: You are all set on my end.
13 AGENT: Anything else you would like to know before we wrap up?
14 CALLER: No, that is all for now.
15 AGENT: Take care. [tool:end_call]
```

### PSTN-025 — Chat — stale quote 409 error, agent explains, fresh quote, retry

| Field | Value |
|-------|-------|
| Channel | chat |
| Direction | inbound |
| Locale | en-US |
| Functions | prepare_commerce_checkout, get_product_quote, end_call |
| Turns | 15 |

**Assertions:** TOOL_COMPLETED_BEFORE_CLAIM

```
01 AGENT: Hi! Somo Supplements, Kelly here.
02 CALLER: I have omega-3 in my cart with a quote from earlier — can I checkout?
03 AGENT: Let me prepare that. [tool:prepare_commerce_checkout]
04 AGENT: Hmm — I ran into a small snag. Your price quote expired since it was generated more than 30 minutes ago. The price is the same, it just needs a refresh for security. Give me one second.
05 AGENT: Refreshing the quote now. [tool:get_product_quote]
06 AGENT: Got a fresh quote — still $29.99. Preparing checkout now. [tool:prepare_commerce_checkout]
07 AGENT: You're all set! Checkout link sent. Same price, just a fresh quote. Anything else?
08 CALLER: No, thanks for explaining that.
09 AGENT: Of course — sorry for the slight bump!
10 AGENT: Anything else you would like to know before we wrap up?
11 CALLER: No, that is all for now.
12 AGENT: Happy to help anytime.
13 CALLER: Great, thanks.
14 AGENT: You are all set on my end.
15 AGENT: Take care. [tool:end_call]
```

### PSTN-026 — Chat — returning session, cart restored, finishes checkout

| Field | Value |
|-------|-------|
| Channel | chat |
| Direction | inbound |
| Locale | en-US |
| Functions | get_cart, prepare_commerce_checkout, end_call |
| Turns | 15 |

**Assertions:** TOOL_COMPLETED_BEFORE_CLAIM, PAYMENT_LINK_SENT

```
01 AGENT: Welcome back to Somo! I'm Kelly. How can I help?
02 CALLER: Hi, I started an order earlier for vitamin D but didn't finish it.
03 AGENT: I've got your cart right here — let me pull it up. [tool:get_cart]
04 AGENT: Found it! Your cart has **Vitamin D3 2000 IU** — $24.99. Ready to finish checkout?
05 CALLER: Yes please.
06 AGENT: What email for the payment link?
07 CALLER: grace.lee@gmail.com
08 AGENT: Preparing checkout. [tool:prepare_commerce_checkout]
09 AGENT: Payment link sent to grace.lee@gmail.com. $24.99 + shipping. You're all set, Grace!
10 CALLER: Great, thanks!
11 AGENT: Happy to help. Have a wonderful day! 😊
12 AGENT: Anything else you would like to know before we wrap up?
13 CALLER: No, that is all for now.
14 AGENT: Happy to help anytime.
15 AGENT: Take care. [tool:end_call]
```

### PSTN-027 — Chat — stressed parent, agent acknowledges, gentle suggest, buys magnesium

| Field | Value |
|-------|-------|
| Channel | chat |
| Direction | inbound |
| Locale | en-US |
| Functions | get_product_quote, add_to_cart, prepare_commerce_checkout, end_call |
| Turns | 16 |

**Assertions:** ACK_BEFORE_TRANSACTION, TOOL_COMPLETED_BEFORE_CLAIM, PAYMENT_LINK_SENT

```
01 AGENT: Hi! Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi. I'm a mom of three and I am completely depleted. I barely sleep.
03 AGENT: That sounds genuinely exhausting — running on empty with three kids is no joke. Sleep deprivation takes a real toll. I don't want to jump straight into selling you something, but if you're open to it, magnesium glycinate is one of the supplements most associated with better sleep quality and it's very gentle. No pressure though — happy to just chat if you want.
04 CALLER: No actually that sounds interesting. Tell me more.
05 AGENT: Magnesium glycinate is a highly absorbable form — it calms the nervous system, helps with muscle tension, and research shows it can improve sleep onset and quality. It's gentle on the stomach, unlike some other forms. Many people notice a difference within a week or two.
06 CALLER: Okay, I'm interested. What's the price?
07 AGENT: Let me check. [tool:get_product_quote]
08 AGENT: **Magnesium Glycinate 400mg** — $22.99 per bottle. That's about 75 cents a night. Want to try one bottle?
09 CALLER: Yes, why not.
10 AGENT: Added to cart. What email for checkout?
11 CALLER: sarah.kowalski@icloud.com
12 AGENT: Preparing checkout. [tool:prepare_commerce_checkout]
13 AGENT: Link sent to sarah.kowalski@icloud.com. $22.99 + shipping. And genuinely — I hope you get some rest, Sarah. You deserve it.
14 CALLER: Thank you, that was really sweet.
15 AGENT: Of course. Take care of yourself! 💜
16 AGENT: Take care. [tool:end_call]
```

### PSTN-028 — Chat — compare omega vs multivitamin, buys omega

| Field | Value |
|-------|-------|
| Channel | chat |
| Direction | inbound |
| Locale | en-US |
| Functions | get_product_quote, add_to_cart, prepare_commerce_checkout, end_call |
| Turns | 15 |

**Assertions:** ACK_BEFORE_TRANSACTION, TOOL_COMPLETED_BEFORE_CLAIM

```
01 AGENT: Hey! Kelly at Somo. What can I help with?
02 CALLER: I'm torn between omega-3 and a multivitamin. Which is better?
03 AGENT: Great question — they do different things. A multivitamin is broad coverage, filling nutritional gaps across vitamins A, C, D, B-group, etc. Omega-3 is targeted — it's anti-inflammatory, supports heart and brain health, and is one nutrient most people genuinely don't get enough of from food alone. If your diet is decent and you want targeted impact, omega-3 is the power move. If you eat pretty erratically, multivitamin first. What sounds like your situation?
04 CALLER: My diet is okay, so I guess omega-3 makes sense.
05 AGENT: That's my instinct too. Let me pull up the price. [tool:get_product_quote]
06 AGENT: **Omega-3 1200mg** — $29.99. Want to add it?
07 CALLER: Yes, one bottle.
08 AGENT: Added. Email for checkout?
09 CALLER: tom.nguyen@gmail.com
10 AGENT: Preparing checkout. [tool:prepare_commerce_checkout]
11 AGENT: Checkout link sent to tom.nguyen@gmail.com. $29.99 + shipping. Good choice, Tom!
12 CALLER: Thanks for the advice.
13 AGENT: Anytime. Take care! 🐟
14 AGENT: Anything else you would like to know before we wrap up?
15 AGENT: Take care. [tool:end_call]
```

### PSTN-029 — Chat — abandon at code_sent, returns 30 min later, full redo

| Field | Value |
|-------|-------|
| Channel | chat |
| Direction | inbound |
| Locale | en-US |
| Functions | clear_cart, get_product_quote, send_commerce_verification_code, verify_commerce_code, prepare_commerce_checkout, end_call |
| Turns | 15 |

**Assertions:** TOOL_COMPLETED_BEFORE_CLAIM, PAYMENT_LINK_SENT

```
01 AGENT: Welcome back to Somo! Picking up where we left off?
02 CALLER: Yes, sorry I had to step away. I was ordering turmeric.
03 AGENT: No worries at all! Your session expired due to inactivity but I'll get you sorted quickly. Let me start fresh. [tool:clear_cart]
04 AGENT: Cart cleared. Let me pull up the turmeric. [tool:get_product_quote]
05 AGENT: **Turmeric Curcumin 500mg** — $26.99. Add one?
06 CALLER: Yes.
07 AGENT: Added. Email for verification?
08 CALLER: rachel.green@gmail.com
09 AGENT: Sending verification code. [tool:send_commerce_verification_code]
10 AGENT: Code sent to rachel.green@gmail.com. What's the code?
11 CALLER: 881024
12 AGENT: Verifying. [tool:verify_commerce_code]
13 AGENT: Verified! Preparing checkout. [tool:prepare_commerce_checkout]
14 AGENT: Payment link sent to rachel.green@gmail.com. $26.99 + shipping. Worth the wait, Rachel! 💛
15 AGENT: Take care. [tool:end_call]
```

### PSTN-030 — Chat — invalid merchant, no payment surface (negative path)

| Field | Value |
|-------|-------|
| Channel | chat |
| Direction | inbound |
| Locale | en-US |
| Functions | get_product_quote, end_call |
| Turns | 15 |

**Assertions:** TOOL_COMPLETED_BEFORE_CLAIM

```
01 AGENT: Hi! Somo here, Kelly speaking. How can I help?
02 CALLER: I want to order some supplements.
03 AGENT: I'd love to help! Let me pull up available products. [tool:get_product_quote]
04 AGENT: I'm sorry — I'm running into a configuration issue on my end that's preventing me from processing orders right now. This isn't something you did wrong. I'd recommend trying our website directly at somo-supplements.com, or calling back in a few minutes. I'm sorry for the inconvenience.
05 CALLER: Oh okay. Will do.
06 AGENT: Thank you for your patience. I'm sorry we couldn't complete this today.
07 AGENT: Anything else you would like to know before we wrap up?
08 CALLER: No, that is all for now.
09 AGENT: Happy to help anytime.
10 CALLER: Great, thanks.
11 AGENT: You are all set on my end.
12 AGENT: Anything else you would like to know before we wrap up?
13 CALLER: No, that is all for now.
14 AGENT: Happy to help anytime.
15 AGENT: Take care. [tool:end_call]
```

## Block 3: Voice appointment booking

### PSTN-031 — Routine supplement consult — slots, name/email/phone, schedule

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | get_available_slots, schedule_appointment, end_call |
| Turns | 17 |

**Assertions:** BOOKING_GATE_RESPECTED, TOOL_COMPLETED_BEFORE_CLAIM

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi, I'd like to book a consultation with a nutritionist.
03 AGENT: Absolutely! Let me check available times. What days work best for you this week?
04 CALLER: I'm flexible — maybe Thursday or Friday.
05 AGENT: Let me check what's open. [tool:get_available_slots]
06 AGENT: I have Thursday at eleven AM, Thursday at three PM, Friday at ten AM, or Friday at two PM. Any of those work?
07 CALLER: Thursday at three please.
08 AGENT: Great! I'll need a couple of details. What's your name?
09 CALLER: Patricia Owens.
10 AGENT: And a good email for your confirmation?
11 CALLER: Patricia dot owens at gmail dot com.
12 AGENT: And a phone number in case we need to reach you?
13 CALLER: Seven one three, five five five, four four two one.
14 AGENT: Booking Thursday at three PM for Patricia Owens. [tool:schedule_appointment]
15 AGENT: You're booked! Thursday at three PM. A confirmation email is on its way to patricia.owens at gmail. Anything else I can help with?
16 CALLER: No, that's everything. Thank you.
17 AGENT: Wonderful. See you Thursday, Patricia! [tool:end_call]
```

### PSTN-032 — Rash on arm — full OPQRST, triage RAG, books derm

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | store_triage_opqrst, run_triage_rag, get_triage_session, get_available_slots, schedule_appointment, end_call |
| Turns | 30 |

**Assertions:** ACK_BEFORE_TRANSACTION, BOOKING_GATE_RESPECTED, TOOL_COMPLETED_BEFORE_CLAIM

```
01 AGENT: Somo Supplements, Kelly here. How can I help you today?
02 CALLER: Hi, I have this rash on my arm and I'm not sure what it is. I wanted to see a doctor.
03 AGENT: Of course, I can help you book the right appointment. Before I do that, let me ask a few quick questions so we get you to the right provider. Is that okay?
04 CALLER: Yeah, sure.
05 AGENT: Where on your arm is the rash, and how would you describe it? [tool:store_triage_opqrst]
06 CALLER: It's on my forearm, on the inside. It's red and kind of bumpy.
07 AGENT: When did it first appear?
08 CALLER: About three days ago.
09 AGENT: On a scale of one to ten, how itchy or uncomfortable is it? [tool:store_triage_opqrst]
10 CALLER: Maybe a five or six — it's pretty itchy.
11 AGENT: Does anything make it better or worse — like lotions, heat, or fabric?
12 CALLER: It seems worse after I shower.
13 AGENT: Any other symptoms — fever, swelling, spreading to other areas? [tool:store_triage_opqrst]
14 CALLER: No fever. It might be spreading a little.
15 AGENT: Have you changed soaps, detergents, or worn any new jewelry recently?
16 CALLER: Actually yes — I tried a new laundry detergent about a week ago.
17 AGENT: That's really helpful information. [tool:store_triage_opqrst]
18 AGENT: Let me pull up your triage session. [tool:get_triage_session]
19 AGENT: Running that through our clinical reference. [tool:run_triage_rag]
20 AGENT: Based on what you've shared, this sounds like it could be contact dermatitis — a reaction to the new detergent. Not an emergency, but definitely worth a dermatology appointment. Should I book you with a derm?
21 CALLER: Yes please.
22 AGENT: What days work this week?
23 CALLER: Thursday or Friday.
24 AGENT: Checking derm availability. [tool:get_available_slots]
25 AGENT: I have Thursday at one PM or Friday at three PM.
26 CALLER: Thursday at one.
27 AGENT: What's your name and email?
28 CALLER: Marcus Webb, marcus.webb at gmail.
29 AGENT: Booking Thursday one PM for Marcus. [tool:schedule_appointment]
30 AGENT: Done! Derm appointment Thursday at one PM. Confirmation sent to marcus.webb at gmail. In the meantime, try switching back to your old detergent and avoid hot showers if you can. [tool:end_call]
```

### PSTN-033 — Stated time "Tuesday 3pm" — no slots API, schedule stated-time path

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | get_available_slots, schedule_appointment, end_call |
| Turns | 12 |

**Assertions:** BOOKING_GATE_RESPECTED

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi I want to book an appointment for a wellness consult on Tuesday at three PM.
03 AGENT: Let me check if Tuesday at three is available. [tool:get_available_slots]
04 AGENT: I'm having a little trouble accessing our live schedule right now. What I can do is put in a stated-time request for Tuesday at three PM and our team will confirm within a few hours. Does that work?
05 CALLER: Yeah that's fine.
06 AGENT: What's your name and email?
07 CALLER: Linda Foster, linda.foster at yahoo.
08 AGENT: Booking stated-time for Tuesday three PM. [tool:schedule_appointment]
09 AGENT: Done! Your appointment request for Tuesday at three is submitted. You'll get a confirmation email once it's confirmed. Is there anything else?
10 CALLER: No, that's great.
11 AGENT: Is there anything else I can help you with today?
12 AGENT: Thanks Linda. Have a great day! [tool:end_call]
```

### PSTN-034 — Provider mismatch — "Dr. Santos" unavailable, offers alt slot

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | get_available_slots, schedule_appointment, end_call |
| Turns | 14 |

**Assertions:** BOOKING_GATE_RESPECTED, TOOL_COMPLETED_BEFORE_CLAIM

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: I need to see Dr. Santos for a supplement review. Are they available this week?
03 AGENT: Let me check Dr. Santos's availability. [tool:get_available_slots]
04 AGENT: Dr. Santos is fully booked for this week unfortunately. Their next opening is next Monday at ten AM. Would that work, or would you like to see another available provider sooner?
05 CALLER: Hmm. Is there someone else available this week who does supplement reviews?
06 AGENT: Let me check. [tool:get_available_slots]
07 AGENT: I have Dr. Patel available Thursday at two PM, or Dr. Kim on Friday at eleven AM. Both do supplement reviews. Any preference?
08 CALLER: Let's go with Dr. Patel, Thursday at two.
09 AGENT: What's your name and email?
10 CALLER: Kevin Ramirez, kevin.ramirez at gmail.
11 AGENT: Booking Thursday two PM with Dr. Patel. [tool:schedule_appointment]
12 AGENT: You're set! Thursday at two with Dr. Patel. Confirmation heading to your email. Anything else?
13 CALLER: No, thanks.
14 AGENT: Take care Kevin! [tool:end_call]
```

### PSTN-035 — Saturday no slots — offers alternate date, caller books

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | get_available_slots, schedule_appointment, end_call |
| Turns | 12 |

**Assertions:** BOOKING_GATE_RESPECTED

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Do you have anything available on Saturday?
03 AGENT: Let me check Saturday's schedule. [tool:get_available_slots]
04 AGENT: Unfortunately we don't have any openings this Saturday. Our next available Saturday is two weeks out. I do have openings Monday through Friday though — would any of those work?
05 CALLER: Yeah, Monday morning could work.
06 AGENT: Checking Monday. [tool:get_available_slots]
07 AGENT: Monday at nine AM or eleven AM — which works better?
08 CALLER: Nine AM.
09 AGENT: What's your name and email?
10 CALLER: Diane Carter, diane.carter at outlook.
11 AGENT: Booking Monday nine AM. [tool:schedule_appointment]
12 AGENT: Done! Monday at nine. Confirmation sent. See you then, Diane! [tool:end_call]
```

### PSTN-036 — Spanish booking — full ES dialogue through schedule

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | es-US |
| Functions | get_available_slots, schedule_appointment, end_call |
| Turns | 17 |

**Assertions:** SPANISH_LOCALE_RESPECTED, BOOKING_GATE_RESPECTED

```
01 AGENT: Gracias por llamar a Somo Suplementos. Soy Kelly. ¿En qué le puedo ayudar hoy?
02 CALLER: Hola, quisiera hacer una cita para una consulta de nutrición.
03 AGENT: Con mucho gusto. ¿Qué días le quedan bien esta semana?
04 CALLER: El miércoles o el jueves.
05 AGENT: Déjeme revisar la disponibilidad. [tool:get_available_slots]
06 AGENT: Tengo disponible el miércoles a las diez de la mañana o el jueves a las dos de la tarde. ¿Cuál le funciona mejor?
07 CALLER: El miércoles a las diez, por favor.
08 AGENT: Perfecto. ¿Me podría dar su nombre completo?
09 CALLER: Me llamo Roberto Flores.
10 AGENT: Y su correo electrónico, por favor.
11 CALLER: roberto punto flores en gmail punto com.
12 AGENT: Roberto.flores en gmail.com, ¿correcto?
13 CALLER: Sí, correcto.
14 AGENT: Reservando su cita para el miércoles a las diez. [tool:schedule_appointment]
15 AGENT: ¡Listo! Su cita está confirmada para el miércoles a las diez de la mañana. Le envié la confirmación a su correo. ¿Hay algo más en lo que pueda ayudarle?
16 CALLER: No, muchas gracias.
17 AGENT: ¡Con gusto, Roberto! Hasta el miércoles. [tool:end_call]
```

### PSTN-037 — Premature booking attempt — caller says "book it" before slots fetched

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | get_available_slots, schedule_appointment, end_call |
| Turns | 12 |

**Assertions:** BOOKING_GATE_RESPECTED

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: I want to book a consult. Just book me in for Thursday.
03 AGENT: I'd love to book you for Thursday — let me just confirm there's actually a slot open first so I don't accidentally confirm something that isn't available. One moment. [tool:get_available_slots]
04 AGENT: Good news — Thursday has two PM and four PM open. Which would you prefer?
05 CALLER: Two PM.
06 AGENT: And your name and email?
07 CALLER: Tyler Brooks, tyler.brooks at gmail.
08 AGENT: Booking Thursday two PM. [tool:schedule_appointment]
09 AGENT: Is there anything else I can help you with today?
10 CALLER: No, I think that is everything. Thank you.
11 AGENT: You are welcome. I am glad we could help.
12 AGENT: Done! Thursday two PM confirmed. Confirmation sent to tyler.brooks at gmail. [tool:end_call]
```

### PSTN-038 — Insurance first — collect insurance then slots then schedule

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | collect_insurance, get_available_slots, schedule_appointment, end_call |
| Turns | 16 |

**Assertions:** BOOKING_GATE_RESPECTED, TOOL_COMPLETED_BEFORE_CLAIM

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi I want to book a visit but I need to know if my insurance is accepted first.
03 AGENT: Absolutely, let's check that first. Who is your insurance carrier?
04 CALLER: Blue Cross Blue Shield.
05 AGENT: And your member ID?
06 CALLER: BCS dash four four seven two nine one.
07 AGENT: Got it. Let me verify that. [tool:collect_insurance]
08 AGENT: Great news — Blue Cross Blue Shield is accepted. Your estimated copay for a standard visit is twenty-five dollars. Want to book now?
09 CALLER: Yes, what's available next week?
10 AGENT: Checking next week. [tool:get_available_slots]
11 AGENT: Next week I have Monday at ten, Tuesday at two, or Wednesday at eleven AM. Any preference?
12 CALLER: Tuesday at two.
13 AGENT: Your name and email?
14 CALLER: Frank Miller, frank.miller at gmail.
15 AGENT: Booking Tuesday two PM. [tool:schedule_appointment]
16 AGENT: All set! Tuesday at two PM. Confirmation and copay details heading to frank.miller at gmail. [tool:end_call]
```

### PSTN-039 — Patient intake new patient — intake form, status, book

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | patient_intake, get_patient_intake_status, get_available_slots, schedule_appointment, end_call |
| Turns | 19 |

**Assertions:** BOOKING_GATE_RESPECTED, TOOL_COMPLETED_BEFORE_CLAIM

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi, I'm a new patient and want to book a wellness appointment.
03 AGENT: Welcome! Since you're new, I'll start a quick intake form — just a few questions. What's your full name?
04 CALLER: Anna Kim.
05 AGENT: Date of birth?
06 CALLER: March fifteenth nineteen eighty-eight.
07 AGENT: And any known allergies?
08 CALLER: Penicillin.
09 AGENT: Noted. Any current medications?
10 CALLER: Just a birth control pill.
11 AGENT: Got it. Saving your intake now. [tool:patient_intake]
12 AGENT: Intake submitted! Let me check the status. [tool:get_patient_intake_status]
13 AGENT: Your intake is complete — you're all set to book. What days work for you?
14 CALLER: Wednesday.
15 AGENT: Checking Wednesday. [tool:get_available_slots]
16 AGENT: Wednesday at ten AM or one PM — which works?
17 CALLER: Ten AM.
18 AGENT: Booking Wednesday ten AM for Anna. [tool:schedule_appointment]
19 AGENT: Done, Anna! Wednesday ten AM. Confirmation on its way. [tool:end_call]
```

### PSTN-040 — Search appointments — "when is my visit?"

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | search_appointments, end_call |
| Turns | 12 |

**Assertions:** TOOL_COMPLETED_BEFORE_CLAIM

```
01 AGENT: Somo Supplements, Kelly here. How can I help?
02 CALLER: Hi, I booked an appointment last week but I can't remember when it is.
03 AGENT: I can look that up. What's your name and date of birth?
04 CALLER: Chris Davis, born June second nineteen ninety.
05 AGENT: Looking up your appointment. [tool:search_appointments]
06 AGENT: Found it! You have a supplement consult with Dr. Patel this Friday at three PM. Does that sound right?
07 CALLER: Yes! That's the one. Thanks.
08 AGENT: Is there anything else I can help you with today?
09 CALLER: No, I think that is everything. Thank you.
10 AGENT: You are welcome. I am glad we could help.
11 CALLER: Thanks again.
12 AGENT: Of course. See you Friday, Chris! [tool:end_call]
```

### PSTN-041 — Confirm appointment — day-before confirmation call (outbound)

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | outbound |
| Locale | en-US |
| Functions | confirm_appointment, end_call |
| Turns | 12 |

**Assertions:** OUTBOUND_DISPOSITION_LOGGED

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

### PSTN-042 — Mid-booking symptom change — returns to triage, re-OPQRST, books

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | store_triage_opqrst, run_triage_rag, get_available_slots, schedule_appointment, end_call |
| Turns | 26 |

**Assertions:** ACK_BEFORE_TRANSACTION, BOOKING_GATE_RESPECTED, TOOL_COMPLETED_BEFORE_CLAIM

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

### PSTN-043 — Document upload link — rash photo before async telehealth visit

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | send_document_upload_link, end_call |
| Turns | 12 |

**Assertions:** TOOL_COMPLETED_BEFORE_CLAIM

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

### PSTN-044 — Emergency chest pain — 911 script, no scheduling tools used

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | end_call |
| Turns | 12 |

**Assertions:** ACK_BEFORE_TRANSACTION

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

### PSTN-045 — Video supplement consult — book with visit_mode:video

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | get_available_slots, schedule_appointment, end_call |
| Turns | 12 |

**Assertions:** BOOKING_GATE_RESPECTED

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

### PSTN-046 — Copay question before booking — agent explains then books

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | collect_insurance, get_available_slots, schedule_appointment, end_call |
| Turns | 16 |

**Assertions:** ACK_BEFORE_TRANSACTION, BOOKING_GATE_RESPECTED

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

### PSTN-047 — Double-book attempt — conflict detected, recovery

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | get_available_slots, end_call |
| Turns | 12 |

**Assertions:** BOOKING_GATE_RESPECTED

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

### PSTN-048 — Wrong number — caller wants pizza place

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | end_call |
| Turns | 12 |

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

## Block 4: Cancel / reschedule / outbound

### PSTN-049 — Cancel by name+date — verify, cancel, confirm cancelled

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | search_appointments, cancel_appointment, end_call |
| Turns | 12 |

**Assertions:** TOOL_COMPLETED_BEFORE_CLAIM

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

### PSTN-050 — Reschedule Friday to Thursday

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | get_available_slots, reschedule_appointment, end_call |
| Turns | 12 |

**Assertions:** TOOL_COMPLETED_BEFORE_CLAIM

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

### PSTN-051 — Same-day cancel and rebook — full intent drain single call

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | search_appointments, cancel_appointment, get_available_slots, schedule_appointment, end_call |
| Turns | 15 |

**Assertions:** BOOKING_GATE_RESPECTED, TOOL_COMPLETED_BEFORE_CLAIM

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

### PSTN-052 — Cancel fails — cancel_failed copy, handoff offer

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | search_appointments, transfer_call, end_call |
| Turns | 12 |

**Assertions:** HANDOFF_ON_VENT

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

### PSTN-053 — Reschedule fails — reschedule_failed, handoff

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | search_appointments, transfer_call, end_call |
| Turns | 12 |

**Assertions:** HANDOFF_ON_VENT

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

### PSTN-054 — Outbound reminder — patient cancels

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | outbound |
| Locale | en-US |
| Functions | cancel_appointment, end_call |
| Turns | 12 |

**Assertions:** OUTBOUND_DISPOSITION_LOGGED

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

### PSTN-055 — Outbound reminder — patient reschedules

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | outbound |
| Locale | en-US |
| Functions | get_available_slots, reschedule_appointment, end_call |
| Turns | 12 |

**Assertions:** OUTBOUND_DISPOSITION_LOGGED

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

### PSTN-056 — Outbound reminder — voicemail disposition

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | outbound |
| Locale | en-US |
| Functions | end_call |
| Turns | 12 |

**Assertions:** OUTBOUND_DISPOSITION_LOGGED

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

### PSTN-057 — Outbound — opt-out "stop calling"

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | outbound |
| Locale | en-US |
| Functions | end_call |
| Turns | 12 |

**Assertions:** OUTBOUND_DISPOSITION_LOGGED

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

### PSTN-058 — Outbound refill pitch — caller buys Vitamin D (documents F-05 risk)

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | outbound |
| Locale | en-US |
| Functions | search_products, create_checkout, end_call |
| Turns | 12 |

**Assertions:** OUTBOUND_DISPOSITION_LOGGED, VOICE_COMMERCE_TOOL_CHAIN

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

### PSTN-059 — Outbound — live answer, wants human, transfer_call

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | outbound |
| Locale | en-US |
| Functions | transfer_call, end_call |
| Turns | 12 |

**Assertions:** HANDOFF_ON_VENT, OUTBOUND_DISPOSITION_LOGGED

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

### PSTN-060 — RCM outbound — billing question, request_patient_payment

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | outbound |
| Locale | en-US |
| Functions | request_patient_payment, end_call |
| Turns | 12 |

**Assertions:** OUTBOUND_DISPOSITION_LOGGED, PAYMENT_LINK_SENT

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

## Block 5: Appointment payments

### PSTN-061 — Post-booking copay — create_appointment_checkout, link sent

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | create_appointment_checkout, end_call |
| Turns | 12 |

**Assertions:** TOOL_COMPLETED_BEFORE_CLAIM, PAYMENT_LINK_SENT

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

### PSTN-062 — Verify checkout code — success first try

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | verify_checkout_code, end_call |
| Turns | 12 |

**Assertions:** TOOL_COMPLETED_BEFORE_CLAIM

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

### PSTN-063 — Wrong code twice — reprompt twice, then handoff

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | verify_checkout_code, transfer_call, end_call |
| Turns | 12 |

**Assertions:** HANDOFF_ON_VENT

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

### PSTN-064 — SMS payment link fails — graceful notification_failed handling

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | create_appointment_checkout, end_call |
| Turns | 12 |

**Assertions:** TOOL_COMPLETED_BEFORE_CLAIM

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

### PSTN-065 — "How much is my copay?" — explain quote

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | create_appointment_checkout, end_call |
| Turns | 12 |

**Assertions:** ACK_BEFORE_TRANSACTION

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

### PSTN-066 — Book + copay + supplement upsell — full same-call arc

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | get_available_slots, schedule_appointment, create_appointment_checkout, search_products, create_checkout, end_call |
| Turns | 22 |

**Assertions:** ACK_BEFORE_TRANSACTION, BOOKING_GATE_RESPECTED, VOICE_COMMERCE_TOOL_CHAIN, PAYMENT_LINK_SENT

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

### PSTN-067 — Patient claims status question

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | get_patient_claims, end_call |
| Turns | 12 |

**Assertions:** TOOL_COMPLETED_BEFORE_CLAIM

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

### PSTN-068 — Request patient payment — standalone balance

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | request_patient_payment, end_call |
| Turns | 12 |

**Assertions:** TOOL_COMPLETED_BEFORE_CLAIM, PAYMENT_LINK_SENT

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

## Block 6: Complaints / vent / handoff

### PSTN-069 — Cancel supplement order — policy, transfer (no cancel_order tool)

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | transfer_call, end_call |
| Turns | 12 |

**Assertions:** HANDOFF_ON_VENT

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

### PSTN-070 — Double charge anger — acknowledge, no refund promise, transfer

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | transfer_call, end_call |
| Turns | 12 |

**Assertions:** ACK_BEFORE_TRANSACTION, HANDOFF_ON_VENT

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

### PSTN-071 — Wrong product shipped — empathy, transfer

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | transfer_call, end_call |
| Turns | 12 |

**Assertions:** ACK_BEFORE_TRANSACTION, HANDOFF_ON_VENT

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

### PSTN-072 — Return probiotics — policy, transfer

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | transfer_call, end_call |
| Turns | 12 |

**Assertions:** HANDOFF_ON_VENT

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

### PSTN-073 — Product caused rash — acknowledge, not medical advice, transfer

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | transfer_call, end_call |
| Turns | 12 |

**Assertions:** ACK_BEFORE_TRANSACTION, HANDOFF_ON_VENT

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

### PSTN-074 — Rough week — three vent turns, handoff before any product

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | transfer_call, end_call |
| Turns | 12 |

**Assertions:** ACK_BEFORE_TRANSACTION, HANDOFF_ON_VENT

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

### PSTN-075 — "I just need someone to listen" — immediate handoff offer

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | transfer_call, end_call |
| Turns | 12 |

**Assertions:** ACK_BEFORE_TRANSACTION, HANDOFF_ON_VENT

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

### PSTN-076 — Grief loss — acknowledge, handoff within 2 agent turns

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | transfer_call, end_call |
| Turns | 12 |

**Assertions:** ACK_BEFORE_TRANSACTION, HANDOFF_ON_VENT

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

### PSTN-077 — Profanity — de-escalate, handoff

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | transfer_call, end_call |
| Turns | 12 |

**Assertions:** ACK_BEFORE_TRANSACTION, HANDOFF_ON_VENT

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

### PSTN-078 — Transfer fails twice — handoff_exhausted

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | transfer_call, end_call |
| Turns | 12 |

**Assertions:** HANDOFF_ON_VENT

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

### PSTN-079 — Chat dispute after payment confirmed

| Field | Value |
|-------|-------|
| Channel | chat |
| Direction | inbound |
| Locale | en-US |
| Functions | get_checkout_payment_status, transfer_call, end_call |
| Turns | 15 |

**Assertions:** ACK_BEFORE_TRANSACTION, TOOL_COMPLETED_BEFORE_CLAIM

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

### PSTN-080 — Praise then "should I quit my job?" — scope guard, handoff

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | end_call |
| Turns | 12 |

**Assertions:** ACK_BEFORE_TRANSACTION

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

## Block 7: Multi-intent / edge / capstone

### PSTN-081 — Triple intent — book + order + pay bill, disambiguate order

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | get_available_slots, schedule_appointment, search_products, create_checkout, request_patient_payment, end_call |
| Turns | 20 |

**Assertions:** ACK_BEFORE_TRANSACTION, BOOKING_GATE_RESPECTED, VOICE_COMMERCE_TOOL_CHAIN, PAYMENT_LINK_SENT

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

### PSTN-082 — Fast talker multi-intent — agent slows down, confirms one at a time

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | get_available_slots, schedule_appointment, search_products, create_checkout, end_call |
| Turns | 15 |

**Assertions:** BOOKING_GATE_RESPECTED, VOICE_COMMERCE_TOOL_CHAIN

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

### PSTN-083 — Long silence — agent prompts reminder

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | search_products, create_checkout, end_call |
| Turns | 13 |

**Assertions:** VOICE_COMMERCE_TOOL_CHAIN

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

### PSTN-084 — Caller idle, "still there?" — three pauses handled

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | search_products, create_checkout, end_call |
| Turns | 12 |

**Assertions:** VOICE_COMMERCE_TOOL_CHAIN

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

### PSTN-085 — Callback request — not an order, captures callback

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | end_call |
| Turns | 12 |

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

### PSTN-086 — Longest realistic mashup — insurance + supplement + book

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | collect_insurance, get_available_slots, schedule_appointment, search_products, create_checkout, end_call |
| Turns | 22 |

**Assertions:** ACK_BEFORE_TRANSACTION, BOOKING_GATE_RESPECTED, VOICE_COMMERCE_TOOL_CHAIN

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

### PSTN-087 — Caller ID mismatch — verify DOB before cancel

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | search_appointments, cancel_appointment, end_call |
| Turns | 12 |

**Assertions:** TOOL_COMPLETED_BEFORE_CLAIM

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

### PSTN-088 — Elderly caller — slow name and email spell, patient checkout

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | search_products, create_checkout, end_call |
| Turns | 13 |

**Assertions:** ACK_BEFORE_TRANSACTION, VOICE_COMMERCE_TOOL_CHAIN, PAYMENT_LINK_SENT

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

### PSTN-089 — Teen caller, parent pays — handoff to adult

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | transfer_call, end_call |
| Turns | 13 |

**Assertions:** HANDOFF_ON_VENT

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

### PSTN-090 — Competitor price match — policy decline, politely redirect

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | search_products, end_call |
| Turns | 12 |

**Assertions:** ACK_BEFORE_TRANSACTION

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

### PSTN-091 — Chat — 3-item cart, remove one, update qty, checkout

| Field | Value |
|-------|-------|
| Channel | chat |
| Direction | inbound |
| Locale | en-US |
| Functions | add_to_cart, remove_cart_item, update_cart_item, get_cart, prepare_commerce_checkout, end_call |
| Turns | 15 |

**Assertions:** TOOL_COMPLETED_BEFORE_CLAIM, PAYMENT_LINK_SENT

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

### PSTN-092 — Chat — ingredient interaction question then purchase

| Field | Value |
|-------|-------|
| Channel | chat |
| Direction | inbound |
| Locale | en-US |
| Functions | get_product_quote, add_to_cart, prepare_commerce_checkout, end_call |
| Turns | 15 |

**Assertions:** ACK_BEFORE_TRANSACTION, TOOL_COMPLETED_BEFORE_CLAIM

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

### PSTN-093 — Voice — payment methods then chooses link

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | get_available_payment_methods, search_products, create_checkout, end_call |
| Turns | 14 |

**Assertions:** VOICE_COMMERCE_TOOL_CHAIN, PAYMENT_LINK_SENT

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

### PSTN-094 — Voice — confirm appointment + create_appointment_checkout same call

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | outbound |
| Locale | en-US |
| Functions | confirm_appointment, create_appointment_checkout, end_call |
| Turns | 12 |

**Assertions:** OUTBOUND_DISPOSITION_LOGGED, TOOL_COMPLETED_BEFORE_CLAIM, PAYMENT_LINK_SENT

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

### PSTN-095 — Voice — search appointments + reschedule combined

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | search_appointments, get_available_slots, reschedule_appointment, end_call |
| Turns | 14 |

**Assertions:** BOOKING_GATE_RESPECTED, TOOL_COMPLETED_BEFORE_CLAIM

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

### PSTN-096 — Voice — incomplete intake, status check, complete, book

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | patient_intake, get_patient_intake_status, get_available_slots, schedule_appointment, end_call |
| Turns | 18 |

**Assertions:** BOOKING_GATE_RESPECTED, TOOL_COMPLETED_BEFORE_CLAIM

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

### PSTN-097 — Chat — clear cart after complaint, new purchase

| Field | Value |
|-------|-------|
| Channel | chat |
| Direction | inbound |
| Locale | en-US |
| Functions | clear_cart, add_to_cart, prepare_commerce_checkout, end_call |
| Turns | 15 |

**Assertions:** ACK_BEFORE_TRANSACTION, TOOL_COMPLETED_BEFORE_CLAIM

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

### PSTN-098 — Voice — collect insurance eligibility only, no booking

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | collect_insurance, end_call |
| Turns | 12 |

**Assertions:** TOOL_COMPLETED_BEFORE_CLAIM

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

### PSTN-099 — WER harness call — 5 corpus utterances embedded

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | search_products, create_checkout, end_call |
| Turns | 12 |

**Assertions:** VOICE_COMMERCE_TOOL_CHAIN

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

### PSTN-100 — CAPSTONE — vent + ack + book + copay + supplement + order tracking

| Field | Value |
|-------|-------|
| Channel | voice |
| Direction | inbound |
| Locale | en-US |
| Functions | search_products, get_available_slots, schedule_appointment, collect_insurance, create_appointment_checkout, create_checkout, get_order_tracking, end_call |
| Turns | 34 |

**Assertions:** ACK_BEFORE_TRANSACTION, BOOKING_GATE_RESPECTED, VOICE_COMMERCE_TOOL_CHAIN, TOOL_COMPLETED_BEFORE_CLAIM, PAYMENT_LINK_SENT

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
