/**
 * Migration 014: Add users, sessions, and checks.user_id
 *
 * Implements Google OAuth & optional user session support:
 * - Creates `users` table
 * - Creates `sessions` table
 * - Adds `user_id` to `checks` table with index
 */

export const name = "014_add_users_sessions_and_check_user_id";

export function up(db) {
  db.pragma("foreign_keys = OFF");

  try {
    // 1. Create users table
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        google_sub TEXT UNIQUE NOT NULL,
        email TEXT NOT NULL,
        name TEXT NOT NULL,
        avatar_url TEXT,
        created_at TEXT NOT NULL,
        last_login_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub);
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    `);

    // 2. Create sessions table
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
    `);

    // 3. Add user_id column to checks if not present
    const checkCols = db.pragma("table_info(checks)");
    const hasUserId = checkCols.some((c) => c.name === "user_id");
    if (!hasUserId) {
      db.exec(`ALTER TABLE checks ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE SET NULL;`);
    }
    db.exec(`CREATE INDEX IF NOT EXISTS idx_checks_user_id ON checks(user_id);`);
  } finally {
    db.pragma("foreign_keys = ON");
  }
}
