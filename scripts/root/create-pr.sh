#!/bin/bash

# Create GitHub Pull Request
# Repository: richiejeremiah/doclittle-platform
# Branch: feature/knowledge-base-improvements-and-bug-fixes

REPO="richiejeremiah/doclittle-platform"
BRANCH="feature/knowledge-base-improvements-and-bug-fixes"
BASE="main"

TITLE="feat: Enhanced knowledge base, fixed medical coding API, improved UX"

BODY="## 🎯 Summary
This PR includes major improvements to the knowledge base, critical bug fixes, and UX enhancements.

## 📊 Key Changes

### Knowledge Base Enhancements ⭐
- **ICD-10 Reference**: Expanded from 10 to 271 codes (27x increase) across 24 categories
- **CPT Codes**: Imported 1,291 CPT codes into database from official CMS file
- **Coding Rules**: Expanded from 3 to 55 rules (18x increase)
- Covers primary care, chronic disease, specialties, preventive care, and mental health

### Critical Bug Fixes ⭐
- Fixed Groq API token limit errors (increased max_tokens 600→2000)
- Fixed Scan button navigation (opens in modal instead of new page)
- Fixed broken dashboard links (dashboard.html → business-dashboard.html)
- Fixed /login.html 404 error

### New Features ⭐
- Outbound call support for voice agent (Retell API)
- Automatic string conversion for dynamic variables
- Test script for outbound calls

### Code Quality
- Removed 20+ test files from root/scripts directories
- Reorganized 60+ documentation files into structured docs/ folder
- Cleaner codebase structure

## 📈 Statistics
- **165 files changed**
- **24,605 insertions**, **4,321 deletions**
- Net: +20,284 lines (includes new documentation structure)

## 🧪 Testing Checklist
- [ ] Test medical coding with new rules
- [ ] Verify CPT codes are accessible in database
- [ ] Test outbound call functionality
- [ ] Verify dashboard navigation fixes
- [ ] Test Scan button modal functionality

## 📝 Notes
- See \`DEPLOYMENT_SUMMARY.md\` for complete details
- All changes are backward compatible
- No breaking changes
- Database changes are additive only (CPT codes table)

## 🔍 Files Changed
- Knowledge base files (ICD-10, CPT, rules)
- Medical coding service (API fixes)
- Retell service (outbound calls)
- Business dashboard (UX improvements)
- Server routes (navigation fixes)
- Documentation reorganization

---

**Ready for review and testing with CodeRabbit** 🤖"

# Check if GitHub token is available
if [ -z "$GITHUB_TOKEN" ]; then
  echo "⚠️  GITHUB_TOKEN not found in environment"
  echo ""
  echo "To create PR, you can either:"
  echo "1. Set GITHUB_TOKEN environment variable:"
  echo "   export GITHUB_TOKEN=your_token_here"
  echo "   ./scripts/root/create-pr.sh"
  echo ""
  echo "2. Or create PR manually via GitHub web:"
  echo "   https://github.com/$REPO/pull/new/$BRANCH"
  echo ""
  echo "3. Or use GitHub CLI (if installed):"
  echo "   gh pr create --title \"$TITLE\" --body \"$BODY\""
  exit 1
fi

# Create PR using GitHub API
echo "🚀 Creating Pull Request..."
echo "Repository: $REPO"
echo "Branch: $BRANCH -> $BASE"
echo ""

RESPONSE=$(curl -s -X POST \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  -d "{
    \"title\": \"$TITLE\",
    \"body\": $(echo "$BODY" | jq -Rs .),
    \"head\": \"$BRANCH\",
    \"base\": \"$BASE\"
  }" \
  "https://api.github.com/repos/$REPO/pulls")

# Check if PR was created successfully
if echo "$RESPONSE" | grep -q '"number"'; then
  PR_NUMBER=$(echo "$RESPONSE" | grep '"number"' | head -1 | sed 's/.*"number": \([0-9]*\).*/\1/')
  PR_URL=$(echo "$RESPONSE" | grep '"html_url"' | head -1 | sed 's/.*"html_url": "\([^"]*\)".*/\1/')
  
  echo "✅ Pull Request created successfully!"
  echo "PR #$PR_NUMBER: $PR_URL"
  echo ""
  echo "CodeRabbit will automatically review this PR."
else
  echo "❌ Failed to create PR"
  echo "Response: $RESPONSE"
  echo ""
  echo "Please create PR manually:"
  echo "https://github.com/$REPO/pull/new/$BRANCH"
fi

