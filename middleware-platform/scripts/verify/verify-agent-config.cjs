/**
 * Verify Retell agent config matches canonical expectations.
 *
 * Usage:
 *   RETELL_API_KEY=... node scripts/verify/verify-agent-config.cjs
 *
 * Inventory:
 *   ../docs/deployment/retell-agent-inventory.json
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function getInventoryPath() {
  if (process.env.AGENT_INVENTORY_PATH) return process.env.AGENT_INVENTORY_PATH;
  return path.join(__dirname, '../../docs/deployment/retell-agent-inventory.json');
}

function normalizeWsUrl(url) {
  if (!url) return '';
  return String(url).trim().replace(/\/+$/, '');
}

function getWebsocketUrl(agent) {
  // Retell agents can expose websocket URL in different shapes depending on API version.
  const a = agent || {};
  return (
    a?.response_engine?.llm_websocket_url ||
    a?.llm_websocket_url ||
    a?.llm_websocket ||
    ''
  );
}

function getToolList(agent) {
  const a = agent || {};
  // Some payloads use general_tools, others use functions.
  const tools = Array.isArray(a.general_tools) ? a.general_tools : [];
  const fns = Array.isArray(a.functions) ? a.functions : [];
  return tools.length ? tools : fns;
}

function getToolNames(agent) {
  return new Set(
    getToolList(agent)
      .map((t) => t?.name)
      .filter(Boolean)
      .map((n) => String(n).trim())
  );
}

function getPrompt(agent) {
  const a = agent || {};
  return String(a.general_prompt || a.system_prompt || '');
}

function checkAgent(agentId, agent, canonical) {
  const failures = [];

  // Websocket URL check
  const ws = normalizeWsUrl(getWebsocketUrl(agent));
  const expectedPath = String(canonical.websocket_path || '/webhook/retell/llm');
  if (!ws) failures.push('missing_websocket_url');
  else if (!ws.endsWith(expectedPath)) failures.push(`websocket_url_not_canonical:${ws}`);

  const toolNames = getToolNames(agent);
  const requireTools = canonical.require_tools !== false;
  const requirePromptMarkers = canonical.require_prompt_markers !== false;

  if (requireTools) {
    const requiredTools = Array.isArray(canonical.required_tools) ? canonical.required_tools : [];
    const missingTools = requiredTools.filter((t) => !toolNames.has(t));
    if (missingTools.length) failures.push(`missing_tools:${missingTools.join(',')}`);
  }

  if (requirePromptMarkers) {
    const prompt = getPrompt(agent);
    const markers = Array.isArray(canonical.prompt_markers) ? canonical.prompt_markers : [];
    const missingMarkers = markers.filter((m) => !prompt.includes(m));
    if (missingMarkers.length) failures.push(`prompt_missing_markers:${missingMarkers.join(',')}`);
  }

  return {
    agent_id: agentId,
    ok: failures.length === 0,
    failures,
    observed: {
      websocket_url: ws,
      tool_count: toolNames.size
    }
  };
}

async function main() {
  const apiKey = process.env.RETELL_API_KEY;
  if (!apiKey) {
    console.error('FAIL RETELL_API_KEY missing');
    process.exit(2);
  }
  const apiBase = normalizeWsUrl(process.env.RETELL_API_BASE_URL || 'https://api.retellai.com').replace(/^ws(s)?:\/\//, 'https://');

  const inventoryPath = getInventoryPath();
  if (!fs.existsSync(inventoryPath)) {
    console.error(`FAIL inventory_not_found ${inventoryPath}`);
    process.exit(2);
  }

  const inv = readJson(inventoryPath);
  const agents = Array.isArray(inv.agents) ? inv.agents : [];
  const canonical = inv.canonical || {};

  if (agents.length === 0) {
    console.error('FAIL inventory_empty (docs/deployment/retell-agent-inventory.json has no agents)');
    process.exit(2);
  }

  const results = [];
  for (const row of agents) {
    const agentId = row.agent_id || row.agentId;
    if (!agentId) continue;
    try {
      const resp = await axios.get(`${apiBase.replace(/\/$/, '')}/get-agent/${agentId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: 15000
      });
      results.push(checkAgent(agentId, resp.data, canonical));
    } catch (e) {
      results.push({
        agent_id: agentId,
        ok: false,
        failures: [`get_agent_failed:${e.response?.status || e.message}`],
        observed: {}
      });
    }
  }

  const failed = results.filter((r) => !r.ok);
  results.forEach((r) => {
    if (r.ok) console.log(`PASS ${r.agent_id} tools=${r.observed.tool_count} ws=${r.observed.websocket_url}`);
    else console.log(`FAIL ${r.agent_id} ${r.failures.join(' | ')}`);
  });

  if (failed.length) process.exit(2);
  process.exit(0);
}

main().catch((e) => {
  console.error('FAIL verifier_crashed', e.message);
  process.exit(2);
});

