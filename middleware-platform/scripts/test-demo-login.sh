#!/bin/bash
# Test demo account logins via API
# Run after: npm run seed:demo (or npm run seed:demo -- --reset)
# Server must be running on localhost:4000

BASE="http://localhost:4000"
PASS="demo123"

test_login() {
  local email=$1
  local name=$2
  echo -n "Testing $name ($email)... "
  res=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/customers/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$email\",\"password\":\"$PASS\"}")
  code=$(echo "$res" | tail -n1)
  body=$(echo "$res" | sed '$d')
  if [ "$code" = "200" ] && echo "$body" | grep -q '"success":true'; then
    echo "✅ OK"
  else
    echo "❌ FAILED (HTTP $code)"
    echo "$body" | head -c 200
    echo
  fi
}

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Testing demo logins (password: $PASS)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
test_login "provider@doclittle.com" "Provider"
test_login "patient@doclittle.com"  "Patient"
test_login "insurer@doclittle.com"  "Insurer"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
