'use strict';

function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS waitlist (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL,
      email      TEXT    NOT NULL,
      source     TEXT,
      product    TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_waitlist_email ON waitlist(email);
  `);
}

function down(db) {
  db.exec('DROP TABLE IF EXISTS waitlist');
}

function waitlistRoute(db) {
  const insertStmt = db.prepare(`
    INSERT INTO waitlist (name, email, source, product)
    VALUES (@name, @email, @source, @product)
    ON CONFLICT(email) DO UPDATE SET
      name    = excluded.name,
      source  = excluded.source,
      product = excluded.product
  `);

  return async function handler(req, res) {
    const { name, email, source, product } = req.body || {};

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ success: false, error: 'name is required' });
    }
    if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, error: 'valid email is required' });
    }

    try {
      insertStmt.run({
        name: name.trim().slice(0, 120),
        email: email.trim().toLowerCase().slice(0, 254),
        source: source ? String(source).trim().slice(0, 80) : 'routine_builder',
        product: product ? String(product).trim().slice(0, 200) : null
      });
      return res.json({ success: true });
    } catch (err) {
      console.error('[waitlist] insert error:', err.message);
      return res.status(500).json({ success: false, error: 'server error' });
    }
  };
}

module.exports = { up, down, waitlistRoute };
