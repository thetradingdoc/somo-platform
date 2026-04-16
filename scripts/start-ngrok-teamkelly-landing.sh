#!/bin/bash
# Expose Team Kelly landing (http://localhost:8080) on a public HTTPS URL.
# Serve the site first, e.g. from repo root:
#   cd "teamkelly/website" && python3 -m http.server 8080

set -euo pipefail

echo "🚀 ngrok → Team Kelly landing (localhost:8080)"
echo "   Ensure something is listening on 8080 (e.g. python3 -m http.server 8080 in teamkelly/website)."
echo ""

if ! command -v ngrok &> /dev/null; then
  echo "❌ ngrok is not installed."
  echo "   brew install ngrok/ngrok/ngrok  — or https://ngrok.com/download"
  exit 1
fi

# Avoid stacking duplicate tunnels for the same port
pkill -f "ngrok http 8080" 2>/dev/null || true

echo "📡 Tunnel: http://localhost:8080 → https://..."
echo "   Open the Forwarding URL in your browser (you may need to click through ngrok’s warning page)."
echo "   ngrok free plan: only one tunnel may run at a time — stop \`ngrok http 4000\` if this fails."
echo ""

ngrok http 8080 --log=stdout
