# Real-Time Language Switching During Calls

## Your Scenario:
1. Agent starts in English
2. User says: "I don't speak English"
3. User says: "I can speak Russian"
4. Agent switches to Russian mid-call

---

## The Challenge: **Language vs Voice** 🔴

### **Two Separate Components:**

1. **LLM Response Language** (Text → Text)
   - The AI's response text language
   - Can switch dynamically
   - Controlled by system prompt and conversation context

2. **TTS Voice Language** (Text → Speech)
   - The voice synthesis language/accent
   - Set when agent is created (`language: 'en-US'`)
   - **This is harder to change mid-call**

---

## How It Would Work: **3 Possible Approaches**

### **Approach 1: LLM-Only Language Switching** (Easiest ✅)

**What happens:**

```
1. Agent created with: language: 'en-US', voice_id: '11labs-Adrian'

2. User calls, agent greets in English
   Agent: "Hello, I'm Kelly. How can I help you?"

3. User says: "I don't speak English. I speak Russian."

4. LLM (via WebSocket) processes this:
   - Detects language preference
   - Updates internal context
   - Starts responding in Russian text

5. Agent responds in Russian:
   Agent: "Привет! Я Келли. Чем могу помочь?" (in Russian text)

6. Retell TTS reads Russian text:
   - BUT: English voice (Adrian) tries to pronounce Russian
   - Result: Russian words with English accent (accented but understandable)
```

**Pros:**
- ✅ Works immediately (no code changes needed)
- ✅ LLM can switch languages dynamically
- ✅ Agent understands and responds correctly

**Cons:**
- ⚠️ Voice still uses English TTS (accented pronunciation)
- ⚠️ Might mispronounce Russian words
- ⚠️ Not ideal for clarity

**Feasibility:** ⭐⭐⭐⭐⭐ Very Easy - Already works!

---

### **Approach 2: Dynamic Agent Update** (Moderate ⚠️)

**What happens:**

```
1. Agent created with: language: 'en-US', voice_id: '11labs-Adrian'

2. User says: "I don't speak English. I speak Russian."

3. WebSocket handler detects language preference:
   - Analyzes transcript
   - Detects "Russian" mentioned
   - Triggers agent update

4. Call Retell API: updateAgent(agentId, {
     language: 'ru-RU',
     voice_id: '11labs-Ivan'  // Russian voice
   })

5. Agent configuration changes:
   - Language: en-US → ru-RU
   - Voice: Adrian → Ivan

6. Next agent response uses Russian voice
```

**Pros:**
- ✅ Proper Russian voice pronunciation
- ✅ Professional multilingual experience
- ✅ Clear communication

**Cons:**
- ⚠️ Takes 1-2 seconds to update (API call delay)
- ⚠️ Might interrupt conversation flow
- ⚠️ Need to check if Retell supports mid-call updates
- ⚠️ More complex implementation

**Feasibility:** ⭐⭐⭐ Moderate - Need to verify Retell supports this

---

### **Approach 3: Pre-configured Multilingual Agent** (Most Reliable 🎯)

**What happens:**

```
1. Agent created with MULTIPLE language support:
   language: 'en-US',  // Primary
   voice_id: '11labs-Adrian',  // Primary voice
   system_prompt: "You are Kelly. You speak English and Russian fluently..."

2. System prompt includes instructions:
   "If user indicates they don't speak English and mention another language,
    immediately switch to that language. Continue the conversation entirely
    in that language."

3. User says: "I don't speak English. I speak Russian."

4. LLM processes and switches context:
   - Responds in Russian text
   - Mentions language switch explicitly

5. BUT: Still uses English voice for TTS
   - Russian text with English accent
   - LLM responds: "Конечно! Я переключаюсь на русский язык..."
     (in Russian text, spoken with English voice)
```

**Pros:**
- ✅ Works reliably (no API updates needed)
- ✅ Fast (no delays)
- ✅ LLM handles language detection

**Cons:**
- ⚠️ Voice pronunciation still not perfect
- ⚠️ Can be improved with Approach 2

**Feasibility:** ⭐⭐⭐⭐⭐ Very Easy - Just prompt engineering

---

## **My Recommendation: Hybrid Approach** 🎯

### **Phase 1: Start with Approach 3** (Quick Win)

**Update system prompt:**
```
"You are Kelly, a multilingual medical assistant. 
You speak English and Russian fluently.

IMPORTANT LANGUAGE SWITCHING RULES:
- If a caller says they don't speak English or prefer another language, 
  immediately acknowledge and switch to that language.
- Continue the ENTIRE conversation in their preferred language.
- If they say 'I speak Russian' or 'Russian please', respond in Russian.
- Use professional medical terminology in their language.

Example:
User: "I don't speak English. I speak Russian."
You: "Конечно! Я Келли, ваш медицинский ассистент. Чем могу помочь?" 
     (Certainly! I'm Kelly, your medical assistant. How can I help you?)
```

**Result:**
- ✅ LLM responds in Russian immediately
- ✅ No code changes needed
- ✅ Works right away
- ⚠️ Voice uses English accent (understandable but not perfect)

### **Phase 2: Add Voice Switching** (If Needed)

**If accent is a problem:**
- Implement Approach 2 (dynamic agent update)
- Update voice_id when language preference detected
- Requires API call mid-call (slight delay)

---

## **Technical Flow (Approach 3 - Recommended)**

```
┌─────────────────────────────────────────────────┐
│  Call Starts (Agent in English)                │
│  language: 'en-US', voice_id: '11labs-Adrian'  │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│  Agent: "Hello, I'm Kelly. How can I help?"    │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│  User: "I don't speak English. I speak Russian"│
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│  WebSocket Handler receives transcript         │
│  - Detects language preference                 │
│  - Updates conversation context                │
│  - LLM processes: "User prefers Russian"       │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│  LLM Response (Russian text):                  │
│  "Конечно! Я Келли. Чем могу помочь?"          │
│  (Certainly! I'm Kelly. How can I help you?)   │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│  Retell TTS converts text to speech            │
│  - Reads Russian text                          │
│  - Uses English voice (Adrian)                 │
│  - Pronounces with English accent              │
│  - Understandable but accented                 │
└─────────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│  Conversation continues in Russian              │
│  - LLM responds in Russian                     │
│  - TTS uses English voice                      │
│  - Both parties understand each other          │
└─────────────────────────────────────────────────┘
```

---

## **What You Need:**

### **1. Updated System Prompt** (5 minutes)
Add language switching instructions to prompt template.

### **2. Language Detection Logic** (Optional - 1 hour)
In WebSocket handler:
- Monitor transcript for language preferences
- Store detected language in connection object
- Could enhance with Azure Text Analytics language detection

### **3. Dynamic Agent Update** (Optional - 4-6 hours)
If you want perfect voice pronunciation:
- Detect language preference
- Call `updateAgent()` API
- Update `voice_id` to Russian voice
- Continue conversation with Russian voice

---

## **Complexity Rating:**

### **Approach 3 (LLM-Only):** ⭐ Easy
- **Time:** 30 minutes (just prompt update)
- **Risk:** Low
- **Result:** Russian responses with English accent

### **Approach 2 (Dynamic Update):** ⭐⭐⭐ Moderate
- **Time:** 4-6 hours
- **Risk:** Medium (need to verify Retell supports mid-call updates)
- **Result:** Perfect Russian voice

### **Approach 1 + 2 (Hybrid):** ⭐⭐ Easy-Moderate
- **Time:** 30 min + 4-6 hours (if needed)
- **Risk:** Low (can start with Approach 1, add 2 later)
- **Result:** Works immediately, can improve later

---

## **Answer to Your Question:**

**"I tell the agent I don't speak English and tell it I can speak Russian, and we speak Russian"**

### **How it works (Approach 3 - Easiest):**

1. **You say:** "I don't speak English. I speak Russian."

2. **LLM detects:** Language preference = Russian

3. **LLM responds in Russian:**
   - Text response: "Конечно! Я переключаюсь на русский язык. Как я могу помочь?"
   - (Certainly! I'm switching to Russian. How can I help you?)

4. **TTS speaks:**
   - English voice reads Russian text
   - Accented but understandable

5. **Conversation continues:**
   - You speak Russian
   - Agent responds in Russian (text)
   - TTS uses English voice (accented Russian)

### **To get perfect Russian voice:**

1. System detects Russian preference
2. Calls Retell API: `updateAgent()` with `voice_id: '11labs-Ivan'`
3. Next response uses Russian voice
4. Clear Russian pronunciation

---

## **Bottom Line:**

**Easiest way (works immediately):**
- Update system prompt to detect language preferences
- LLM switches to Russian automatically
- Voice uses English accent (understandable)

**Best way (requires implementation):**
- Detect language preference
- Update agent mid-call with Russian voice
- Perfect Russian pronunciation

**Start with easiest, upgrade if needed!**

