# Deployment Checklist - Language Detection Fix

## Changes Made

1. **Code Changes:**
   - `middleware-platform/services/retell-service.js` - Updated default prompt to include automatic language detection

2. **Prompt File Changes:**
   - `docs/voice-agent/prompts/kelly-voice-agent-prompt.md` - Updated to require automatic language detection

## ⚠️ Critical Issue Found

**The deployment script excludes `*.md` files!**

Looking at `scripts/deploy-to-azure.sh` line 75:
```bash
-x "*.md" \
```

This means the prompt file `docs/voice-agent/prompts/kelly-voice-agent-prompt.md` **will NOT be deployed** to Azure.

## Impact

1. **New agents created after deployment:**
   - Will fail to load the prompt file (file won't exist on Azure)
   - Will fall back to `getDefaultPrompt()` which has the updated language detection instructions
   - ✅ **This will work** - the fallback prompt includes the fix

2. **Existing agents:**
   - Already have the old prompt stored in Retell's system
   - Need to be updated via Retell API to get the new prompt
   - Or can be updated manually via Retell dashboard

## Deployment Steps

### Option 1: Deploy Code Only (Recommended - Quick Fix)

The code changes will work because:
- New agents will use `getDefaultPrompt()` which includes the language detection fix
- The fallback prompt has the updated instructions

**Steps:**
1. Deploy code changes:
   ```bash
   ./scripts/deploy-to-azure.sh
   ```

2. Update existing agents via Retell API or dashboard:
   - Use `updateAgent()` method or Retell dashboard
   - Update the `general_prompt` with the new language detection instructions

### Option 2: Fix Deployment Script + Deploy Everything (Better Long-term)

**Fix the deployment script to include prompt files:**

Edit `scripts/deploy-to-azure.sh` line 75:
```bash
# Change from:
-x "*.md" \

# To:
-x "*.md" \
! -path "docs/voice-agent/*.md" \
```

Or better yet, explicitly include the docs folder:
```bash
# Remove the blanket *.md exclusion and be more specific
-x "README.md" \
-x "CHANGELOG.md" \
# But keep docs/voice-agent/*.md
```

**Then deploy:**
```bash
./scripts/deploy-to-azure.sh
```

## What Needs to Happen

### Immediate (Required):
1. ✅ **Deploy code changes** - The `retell-service.js` changes need to be on Azure
   - Run: `./scripts/deploy-to-azure.sh`

### For Existing Agents (Optional but Recommended):
2. **Update existing Retell agents** to use the new prompt:
   - Option A: Use Retell dashboard to manually update the prompt
   - Option B: Create a script to call `updateAgent()` for all existing agents
   - Option C: Wait for agents to be recreated (they'll get the new prompt automatically)

### Long-term (Recommended):
3. **Fix deployment script** to include prompt files for future deployments

## Testing After Deployment

1. **Test new agent creation:**
   - Create a new clinic/agent
   - Verify it uses the updated prompt (check Retell dashboard)

2. **Test language detection:**
   - Call the agent and speak in Russian
   - Verify it automatically detects and responds in Russian

3. **Test existing agents:**
   - If you updated existing agents, test them too
   - If not, they'll continue using the old prompt until updated

## Summary

**YES, you need to deploy to Azure:**
- ✅ Code changes in `retell-service.js` must be deployed
- ⚠️ Prompt file won't be deployed (excluded by script), but fallback prompt has the fix
- ✅ New agents will work with the fix (via fallback prompt)
- ⚠️ Existing agents need manual update via Retell API/dashboard

**Quick action:** Just deploy the code - it will work for new agents. Update existing agents separately if needed.

