-- core/schema.sql
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE,
  bp INTEGER DEFAULT 0,
  bp_today INTEGER DEFAULT 0,
  bp_reset_date TEXT,
  twists JSON DEFAULT '{}',
  boosters JSON DEFAULT '{}',
  queue_priority INTEGER DEFAULT 0,
  blocked JSON DEFAULT '{}',
  streak INTEGER DEFAULT 0,
  last_active TEXT
);

CREATE TABLE IF NOT EXISTS queue (
  user_id TEXT,
  boost_spots INTEGER DEFAULT 0,
  added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id)
);

CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  user_id TEXT,
  action TEXT,
  details TEXT
);

CREATE TABLE IF NOT EXISTS game_state (
  key TEXT PRIMARY KEY,
  value TEXT
);

INSERT OR IGNORE INTO game_state (key, value) VALUES 
('current_round', '0'),
('phase', 'prelive'),
('participants', '[]');