# Automated Retell Agent Creation

## Problem

Currently, creating a Retell agent requires:
1. Manual login to Retell dashboard
2. Manual agent creation
3. Manual configuration (prompt, functions, webhook)
4. Manual copying of agent ID

This doesn't scale for multi-tenant.

---

## Solution: Retell API for Agent Creation

Retell provides an API to create agents programmatically. We can automate this when a clinic signs up.

---

## Retell API Endpoints

### Create Agent
```
POST https://api.retellai.com/create-agent
```

### Update Agent
```
PATCH https://api.retellai.com/update-agent/{agent_id}
```

### Get Agent
```
GET https://api.retellai.com/get-agent/{agent_id}
```

---

## Automated Flow

### When Clinic Signs Up

1. **Clinic registers** on DocLittle
   - Provides: Name, phone number, etc.

2. **Backend automatically:**
   ```javascript
   // Step 1: Create Retell agent via API
   const agentResponse = await axios.post(
     'https://api.retellai.com/create-agent',
     {
       agent_name: `${clinicName} Voice Assistant`,
       llm_websocket_url: 'wss://doclittle.site/retell-llm',
       voice_id: '11labs-Adrian', // or clinic's preferred voice
       language: 'en-US',
       enable_transcription: true,
       enable_recording: true,
       // Use base prompt template, customize with clinic name
       system_prompt: generateClinicPrompt(clinicName, clinicInfo),
       // Same functions for all clinics
       functions: loadRetellFunctions()
     },
     {
       headers: {
         'Authorization': `Bearer ${process.env.RETELL_API_KEY}`,
         'Content-Type': 'application/json'
       }
     }
   );
   
   const agentId = agentResponse.data.agent_id;
   
   // Step 2: Store agent ID in database
   db.createClinic({
     clinic_id: clinicId,
     name: clinicName,
     retell_agent_id: agentId,  // Store the auto-created agent ID
     phone_number: phoneNumber,
     ...
   });
   ```

3. **Result:**
   - Agent created automatically
   - Agent ID stored in database
   - No manual steps required

---

## Prompt Template System

### Base Prompt Template

Create a template that gets customized per clinic:

```markdown
# Base Template (docs/voice-agent/base-prompt-template.md)

You are Kelly, the receptionist for {{CLINIC_NAME}}.

## About {{CLINIC_NAME}}
{{CLINIC_DESCRIPTION}}

## Business Hours
{{BUSINESS_HOURS}}

## Services Offered
{{SERVICES}}

## Contact Information
Phone: {{PHONE_NUMBER}}
Address: {{ADDRESS}}
```

### Customization Function

```javascript
function generateClinicPrompt(clinic) {
  const template = fs.readFileSync('docs/voice-agent/base-prompt-template.md', 'utf8');
  
  return template
    .replace(/{{CLINIC_NAME}}/g, clinic.name)
    .replace(/{{CLINIC_DESCRIPTION}}/g, clinic.description || 'a healthcare practice')
    .replace(/{{BUSINESS_HOURS}}/g, clinic.business_hours || 'Monday-Friday, 9 AM - 5 PM')
    .replace(/{{SERVICES}}/g, clinic.services || 'General healthcare services')
    .replace(/{{PHONE_NUMBER}}/g, clinic.phone_number)
    .replace(/{{ADDRESS}}/g, clinic.address || '');
}
```

---

## Complete Automated Setup Flow

### Clinic Signup Process

1. **Clinic fills signup form:**
   - Clinic name
   - Phone number
   - Business hours
   - Services
   - Address
   - etc.

2. **Backend processes signup:**
   ```javascript
   async function createClinic(clinicData) {
     // Step 1: Generate unique clinic ID
     const clinicId = `clinic-${uuidv4()}`;
     
     // Step 2: Create Retell agent automatically
     const agentId = await createRetellAgent(clinicData);
     
     // Step 3: Purchase/assign Twilio phone number
     const phoneNumber = await assignTwilioNumber(clinicId);
     
     // Step 4: Create clinic record
     db.createClinic({
       clinic_id: clinicId,
       name: clinicData.name,
       retell_agent_id: agentId,
       phone_number: phoneNumber,
       merchant_id: generateMerchantId(clinicId),
       ...
     });
     
     // Step 5: Link phone number to clinic
     db.createClinicPhoneNumber({
       phone_number: phoneNumber,
       clinic_id: clinicId
     });
     
     return { clinicId, agentId, phoneNumber };
   }
   ```

3. **Result:**
   - ✅ Retell agent created
   - ✅ Twilio number assigned
   - ✅ Database records created
   - ✅ Everything ready to use

---

## Retell API Implementation

### Create Agent Function

```javascript
async function createRetellAgent(clinicData) {
  const prompt = generateClinicPrompt(clinicData);
  const functions = loadRetellFunctions();
  
  try {
    const response = await axios.post(
      'https://api.retellai.com/create-agent',
      {
        agent_name: `${clinicData.name} Voice Assistant`,
        llm_websocket_url: process.env.RETELL_LLM_WEBSOCKET_URL || 'wss://doclittle.site/retell-llm',
        voice_id: clinicData.voice_id || '11labs-Adrian',
        language: 'en-US',
        enable_transcription: true,
        enable_recording: true,
        system_prompt: prompt,
        functions: functions,
        // Optional: clinic-specific settings
        response_delay: 400,
        interruption_threshold: 500,
        enable_backchannel: true
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.RETELL_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    return response.data.agent_id;
  } catch (error) {
    console.error('Failed to create Retell agent:', error);
    throw new Error('Failed to create voice agent');
  }
}
```

---

## Benefits of Automation

### Before (Manual)
- ❌ 15-20 minutes per clinic
- ❌ Human error risk
- ❌ Inconsistent configuration
- ❌ Can't scale

### After (Automated)
- ✅ 5 seconds per clinic
- ✅ Zero human error
- ✅ Consistent configuration
- ✅ Unlimited scale

---

## Error Handling

### What if Retell API fails?

```javascript
async function createClinic(clinicData) {
  try {
    const agentId = await createRetellAgent(clinicData);
    // Continue with clinic creation
  } catch (retellError) {
    // Option 1: Fail clinic creation (strict)
    throw new Error('Failed to create voice agent. Please try again.');
    
    // Option 2: Create clinic without agent, admin can add later
    console.warn('Retell agent creation failed, creating clinic without agent');
    // Continue with clinic creation, mark agent as pending
    db.createClinic({
      ...clinicData,
      retell_agent_id: null,
      retell_agent_status: 'pending'
    });
    
    // Queue for retry or manual creation
    queueAgentCreation(clinicData);
  }
}
```

---

## Updating Agents

### When Clinic Updates Info

If clinic changes name, hours, etc., update the agent:

```javascript
async function updateClinicAgent(clinicId, updates) {
  const clinic = db.getClinic(clinicId);
  const updatedPrompt = generateClinicPrompt({ ...clinic, ...updates });
  
  await axios.patch(
    `https://api.retellai.com/update-agent/${clinic.retell_agent_id}`,
    {
      system_prompt: updatedPrompt
    },
    {
      headers: {
        'Authorization': `Bearer ${process.env.RETELL_API_KEY}`
      }
    }
  );
}
```

---

## Summary

**Automated Agent Creation:**
1. Clinic signs up → Backend calls Retell API
2. Agent created with clinic-specific prompt
3. Agent ID stored in database
4. Zero manual steps

**Benefits:**
- Instant setup
- Consistent configuration
- Scalable to unlimited clinics
- No human error

**Implementation:**
- Use Retell API `create-agent` endpoint
- Template-based prompt generation
- Automatic error handling
- Update agents when clinic info changes

