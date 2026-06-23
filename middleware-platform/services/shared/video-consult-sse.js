/**
 * Video Consult SSE Manager
 * Real-time push to provider HUD. Replaces 8-second polling.
 */

const { EVENT_TYPES } = require('./video-consult-sse-schema');

const HEARTBEAT_INTERVAL_MS = 20000;

const roomClients = new Map();
const heartbeatTimers = new Map();

function getClients(roomId) {
  if (!roomClients.has(roomId)) roomClients.set(roomId, new Set());
  return roomClients.get(roomId);
}

function sendEvent(res, eventType, payload) {
  try {
    const data = JSON.stringify({ event: eventType, ts: new Date().toISOString(), payload: payload || {} });
    res.write(`event: ${eventType}\ndata: ${data}\n\n`);
  } catch (e) {
    console.warn('[video-consult-sse] sendEvent failed:', e.message);
  }
}

function startHeartbeat(roomId) {
  if (heartbeatTimers.has(roomId)) return;
  const timer = setInterval(() => {
    const clients = getClients(roomId);
    if (clients.size === 0) {
      clearInterval(heartbeatTimers.get(roomId));
      heartbeatTimers.delete(roomId);
      return;
    }
    clients.forEach(({ res }) => { try { sendEvent(res, EVENT_TYPES.HEARTBEAT, {}); } catch (_) {} });
  }, HEARTBEAT_INTERVAL_MS);
  heartbeatTimers.set(roomId, timer);
}

function stopHeartbeat(roomId) {
  const t = heartbeatTimers.get(roomId);
  if (t) { clearInterval(t); heartbeatTimers.delete(roomId); }
}

function register(roomId, res) {
  const clients = getClients(roomId);
  clients.add({ res, lastPing: Date.now() });
  sendEvent(res, EVENT_TYPES.CONNECTED, { room: roomId, message: 'Subscribed to real-time updates' });
  startHeartbeat(roomId);
  res.on('close', () => unregister(roomId, res));
  res.on('error', () => unregister(roomId, res));
}

function unregister(roomId, res) {
  const clients = roomClients.get(roomId);
  if (!clients) return;
  const toRemove = [...clients].find((c) => c.res === res);
  if (toRemove) clients.delete(toRemove);
  if (clients.size === 0) { roomClients.delete(roomId); stopHeartbeat(roomId); }
}

function broadcast(roomId, eventType, payload) {
  const clients = roomClients.get(roomId);
  if (!clients) return;
  const dead = [];
  clients.forEach(({ res }) => {
    try { sendEvent(res, eventType, payload); } catch (_) { dead.push(res); }
  });
  dead.forEach((res) => unregister(roomId, res));
}

function broadcastAssistantUpdate(roomId, payload) {
  broadcast(roomId, EVENT_TYPES.ASSISTANT_UPDATE, payload);
}

function broadcastTranscriptDelta(roomId, delta) {
  broadcast(roomId, EVENT_TYPES.TRANSCRIPT_DELTA, { transcript_delta: delta });
}

function broadcastRiskAlert(roomId, payload) {
  broadcast(roomId, EVENT_TYPES.RISK_ALERT, payload);
}

function broadcastCodesUpdated(roomId, payload) {
  broadcast(roomId, EVENT_TYPES.CODES_UPDATED, payload);
}

function broadcastSessionEnded(roomId, metadata) {
  broadcast(roomId, EVENT_TYPES.SESSION_ENDED, metadata || {});
}

module.exports = {
  register,
  unregister,
  broadcast,
  broadcastAssistantUpdate,
  broadcastTranscriptDelta,
  broadcastRiskAlert,
  broadcastCodesUpdated,
  broadcastSessionEnded
};
