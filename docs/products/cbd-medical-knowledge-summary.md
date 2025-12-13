# CBD Medical Knowledge Summary for Voice Agent

## 🎯 Purpose
Enable the voice agent to provide informed recommendations about CBD products based on customer needs (sleep, pain, activity, anxiety).

---

## 📊 Research Findings

### 1. Product Types & Medical Uses

#### **CBD Oils & Tinctures**
- **Best For**: Sleep, Anxiety, General Pain Relief
- **Onset**: 15-30 minutes (fast)
- **Duration**: 4-6 hours
- **Medical Uses**:
  - Sleep disorders (insomnia)
  - Anxiety and stress
  - Chronic pain management
  - General wellness

#### **Edibles (Gummies, Capsules)**
- **Best For**: Sleep, Sustained Pain Relief, Anxiety
- **Onset**: 30-90 minutes (slow)
- **Duration**: 4-8 hours (long-lasting)
- **Medical Uses**:
  - Sleep support (long-lasting effects)
  - Chronic pain (sustained relief)
  - Anxiety management throughout the day
  - Discreet consumption

#### **Vapes & Pre-Rolls**
- **Best For**: Quick Pain Relief, Acute Anxiety, Activity/Energy
- **Onset**: Minutes (fastest)
- **Duration**: 1-2 hours (short)
- **Medical Uses**:
  - Breakthrough pain
  - Acute anxiety episodes
  - Quick relief needed
  - **Note**: Sativa-dominant strains can be energizing

#### **Topicals (Creams, Balms)**
- **Best For**: Localized Pain, Inflammation, Skin Issues
- **Onset**: 15-30 minutes
- **Duration**: 2-4 hours
- **Medical Uses**:
  - Joint pain (arthritis)
  - Muscle soreness
  - Localized inflammation
  - Skin conditions
  - **Note**: Does NOT enter bloodstream significantly

#### **Capsules**
- **Best For**: Sleep, Consistent Dosing, Daily Wellness
- **Onset**: 30-90 minutes
- **Duration**: 4-6 hours
- **Medical Uses**:
  - Sleep disorders
  - Consistent daily supplementation
  - Precise dosing

---

### 2. Strain Types & Effects

#### **Indica-Dominant**
- **Effects**: Relaxing, sedating, body-focused
- **Best For**: Sleep, Pain Relief, Relaxation
- **Medical Uses**:
  - Insomnia
  - Chronic pain
  - Muscle spasms
  - Anxiety (calming)
- **When to Recommend**: Evening use, sleep issues, body pain

#### **Sativa-Dominant**
- **Effects**: Energizing, uplifting, mind-focused
- **Best For**: Activity, Energy, Focus, Daytime Use
- **Medical Uses**:
  - Depression
  - Fatigue
  - Focus/concentration
  - Mood elevation
- **When to Recommend**: Daytime use, activity, energy needs
- **⚠️ NOT recommended for sleep**

#### **Hybrid**
- **Effects**: Balanced, combination of indica/sativa
- **Best For**: Versatile use
- **Medical Uses**: Depends on ratio (indica/sativa balance)

---

### 3. CBD Spectrum Types

#### **Full-Spectrum CBD**
- Contains CBD + other cannabinoids + trace THC (<0.3%)
- **Best For**: Comprehensive benefits, "entourage effect"
- **Medical Uses**: All conditions (most comprehensive)

#### **Broad-Spectrum CBD**
- Contains CBD + other cannabinoids, NO THC
- **Best For**: Benefits without THC exposure
- **Medical Uses**: All conditions (for THC-sensitive users)

#### **CBD Isolate**
- Pure CBD only
- **Best For**: Drug testing concerns, THC sensitivity
- **Medical Uses**: All conditions (most limited effects)

---

## 🎯 Medical Use Categories

### **SLEEP**
**Best Products**:
- Indica-dominant strains (pre-rolls, flower)
- CBD tinctures/oils (full-spectrum)
- CBD edibles (gummies, capsules) - long-lasting
- CBD capsules

**Why**: 
- Indica provides sedating, relaxing effects
- Edibles provide long-lasting effects (4-8 hours)
- Full-spectrum may enhance sleep quality

**Agent Guidance**:
- "For sleep support, I'd recommend our indica-dominant products or CBD edibles, which provide long-lasting effects throughout the night."
- "CBD tinctures taken before bed can help with sleep onset."

---

### **PAIN RELIEF**
**Best Products**:
- CBD topicals (localized pain)
- CBD tinctures/oils (systemic pain)
- CBD edibles (chronic pain - long-lasting)
- Indica-dominant strains (body pain)

**Why**:
- Topicals target specific areas
- Tinctures provide systemic relief
- Edibles offer sustained relief
- Indica helps with body pain

**Agent Guidance**:
- "For localized pain, our CBD topicals are excellent - they target the specific area without affecting your whole body."
- "For chronic pain, CBD edibles provide sustained relief throughout the day."
- "CBD tinctures offer quick relief for systemic pain."

---

### **ACTIVITY/ENERGY**
**Best Products**:
- Sativa-dominant strains (pre-rolls, flower)
- CBD vapes (quick energy boost)
- Broad-spectrum CBD (no drowsiness)

**Why**:
- Sativa provides energizing effects
- Vapes offer quick onset
- Avoid indica (sedating) for activity

**Agent Guidance**:
- "For daytime use and activity, I'd recommend our sativa-dominant products - they provide energizing, uplifting effects."
- "CBD vapes offer quick energy boosts when you need them."
- "Avoid indica-dominant products for activity - they're more relaxing and better for evening use."

---

### **ANXIETY**
**Best Products**:
- CBD tinctures/oils (quick relief)
- CBD edibles (sustained relief)
- Indica-dominant (calming)
- Full-spectrum or broad-spectrum

**Why**:
- Tinctures provide fast relief
- Edibles offer sustained anxiety management
- Indica has calming properties

**Agent Guidance**:
- "For anxiety, CBD tinctures provide quick relief when you need it."
- "CBD edibles offer sustained anxiety management throughout the day."
- "Indica-dominant products have calming properties that can help with anxiety."

---

## 📋 Agent Response Templates

### When Customer Asks About Sleep:
"I can help you find products for sleep support. Our indica-dominant products and CBD edibles are excellent for sleep - they provide relaxing, long-lasting effects that can help you get a good night's rest. Would you like to hear about our sleep-support products?"

### When Customer Asks About Pain:
"For pain relief, we have several options. If you have localized pain in a specific area, our CBD topicals are great - they target the area directly. For chronic or systemic pain, CBD tinctures or edibles provide longer-lasting relief. What type of pain are you experiencing?"

### When Customer Asks About Activity/Energy:
"For daytime use and activity, I'd recommend our sativa-dominant products - they provide energizing, uplifting effects perfect for staying active. CBD vapes also offer quick energy boosts. These are great for daytime use, but I'd avoid them before bed."

### When Customer Asks About Anxiety:
"For anxiety, CBD tinctures provide quick relief when you need it, while CBD edibles offer sustained anxiety management throughout the day. Our indica-dominant products also have calming properties. Would you like to explore these options?"

---

## ⚠️ Important Disclaimers

**Agent MUST Always Include**:
1. "CBD products are not FDA-approved for medical use"
2. "Individual experiences may vary"
3. "Consult with a healthcare professional before starting any CBD regimen, especially if you have existing health conditions or are taking medications"
4. "Start with a low dose and gradually increase as needed"
5. "Look for third-party tested products to ensure quality"

---

## 🔍 Product Matching Logic

### How to Match Products to Customer Needs:

1. **Extract Customer Need**:
   - "I need help with sleep" → SLEEP category
   - "I have pain" → PAIN category
   - "I want something for daytime" → ACTIVITY category
   - "I'm anxious" → ANXIETY category

2. **Match Product Type**:
   - Check product category (pre-roll, tincture, edible, topical, etc.)
   - Check product name for strain indicators (indica, sativa, hybrid)
   - Check description for medical use keywords

3. **Recommend Based on Match**:
   - Present products that match the need
   - Explain why they're good for that need
   - Mention onset time and duration
   - Include appropriate disclaimers

---

## 📚 Sources
- CBD Source Online: CBD Essentials Guide
- Healthline: CBD Product Reviews
- Medical News Today: CBD Research
- ConsumerLab: CBD Testing & Reviews
- Various medical and wellness sources

