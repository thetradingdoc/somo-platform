/**
 * Review Task Service (HITL)
 * Creates and manages human-in-the-loop review tasks for video consult AI decisions.
 * See video_consult_review_tasks table.
 */

const { db } = require('../../database');
const crypto = require('crypto');

/**
 * Create a review task when AI flags requires_human_review
 * @param {Object} opts - { room_id, severity, findings, assigned_to? }
 * @returns {Object} Created task
 */
function createTask(opts) {
  const id = crypto.randomBytes(16).toString('hex');
  const { room_id, severity = 'WARNING', findings, assigned_to } = opts;
  if (!room_id) throw new Error('room_id required');
  const findingsJson = findings ? JSON.stringify(findings) : null;
  try {
    db.prepare(`
      INSERT INTO video_consult_review_tasks (id, room_id, severity, findings, assigned_to, status)
      VALUES (?, ?, ?, ?, ?, 'pending')
    `).run(id, room_id, severity, findingsJson, assigned_to || null);
  } catch (e) {
    console.warn('[review-task-service] createTask failed:', e.message);
    return null;
  }
  return getTask(id);
}

/**
 * Get task by id
 */
function getTask(id) {
  const row = db.prepare('SELECT * FROM video_consult_review_tasks WHERE id = ?').get(id);
  if (!row) return null;
  return {
    ...row,
    findings: row.findings ? JSON.parse(row.findings) : null
  };
}

/**
 * List tasks by room or status
 * @param {Object} opts - { room_id?, status? }
 */
function listTasks(opts = {}) {
  const { room_id, status } = opts;
  let sql = 'SELECT * FROM video_consult_review_tasks WHERE 1=1';
  const params = [];
  if (room_id) {
    sql += ' AND room_id = ?';
    params.push(room_id);
  }
  if (status) {
    sql += ' AND status = ?';
    params.push(status);
  }
  sql += ' ORDER BY created_at DESC';
  const rows = db.prepare(sql).all(...params);
  return rows.map(r => ({
    ...r,
    findings: r.findings ? JSON.parse(r.findings) : null
  }));
}

/**
 * Assign task to user
 */
function assignTask(id, assignedTo) {
  db.prepare('UPDATE video_consult_review_tasks SET assigned_to = ? WHERE id = ?').run(assignedTo, id);
  return getTask(id);
}

/**
 * Resolve task (approve or reject)
 * @param {string} id - Task id
 * @param {Object} resolution - { resolved_by?, notes? }
 */
function resolveTask(id, resolution = {}) {
  db.prepare(`
    UPDATE video_consult_review_tasks
    SET status = 'resolved', resolved_at = datetime('now')
    WHERE id = ?
  `).run(id);
  return getTask(id);
}

module.exports = {
  createTask,
  getTask,
  listTasks,
  assignTask,
  resolveTask
};
