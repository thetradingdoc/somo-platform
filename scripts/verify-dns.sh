#!/bin/bash
# Verify DNS Records for api.doclittle.site

echo "🔍 Verifying DNS Records for api.doclittle.site"
echo "══════════════════════════════════════════════════════════════════════"
echo ""

EXPECTED_TXT="e81a8b6649a65b93adedf7874dff6c695e9750b24ba940f1261ac373549c5ff2"
EXPECTED_CNAME="doclittle.azurewebsites.net"

# Check TXT record
echo "📋 Checking TXT Record (Domain Verification)..."
TXT_RESULT=$(dig +short asuid.api.doclittle.site TXT 2>/dev/null | tr -d '"' || echo "")

if [ -z "$TXT_RESULT" ]; then
    echo "❌ TXT record not found"
    echo "   Expected: $EXPECTED_TXT"
    echo "   Action: Add TXT record in IONOS (see DNS_SETUP_IONOS.md)"
else
    if echo "$TXT_RESULT" | grep -q "$EXPECTED_TXT"; then
        echo "✅ TXT record found and correct"
        echo "   Value: $TXT_RESULT"
    else
        echo "⚠️  TXT record found but value doesn't match"
        echo "   Found: $TXT_RESULT"
        echo "   Expected: $EXPECTED_TXT"
    fi
fi

echo ""

# Check CNAME record
echo "📋 Checking CNAME Record (Points to Azure)..."
CNAME_RESULT=$(dig +short api.doclittle.site CNAME 2>/dev/null | sed 's/\.$//' || echo "")

if [ -z "$CNAME_RESULT" ]; then
    echo "❌ CNAME record not found"
    echo "   Expected: $EXPECTED_CNAME"
    echo "   Action: Add CNAME record in IONOS (see DNS_SETUP_IONOS.md)"
else
    if [ "$CNAME_RESULT" = "$EXPECTED_CNAME" ]; then
        echo "✅ CNAME record found and correct"
        echo "   Points to: $CNAME_RESULT"
    else
        echo "⚠️  CNAME record found but points to wrong location"
        echo "   Found: $CNAME_RESULT"
        echo "   Expected: $EXPECTED_CNAME"
    fi
fi

echo ""

# Summary
echo "📊 SUMMARY"
echo "══════════════════════════════════════════════════════════════════════"

if [ -n "$TXT_RESULT" ] && echo "$TXT_RESULT" | grep -q "$EXPECTED_TXT" && [ "$CNAME_RESULT" = "$EXPECTED_CNAME" ]; then
    echo "✅ All DNS records are configured correctly!"
    echo ""
    echo "💡 Next step: Run ./scripts/add-custom-domain.sh"
else
    echo "⚠️  DNS records need to be configured"
    echo ""
    echo "📝 See DNS_SETUP_IONOS.md for detailed instructions"
    echo ""
    echo "Quick reference:"
    echo "  TXT:  asuid.api → $EXPECTED_TXT"
    echo "  CNAME: api → $EXPECTED_CNAME"
fi

echo ""

