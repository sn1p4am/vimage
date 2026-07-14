/**
 * 数据库初始化
 * 使用SQLite创建和管理数据库
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || './data/vimage.db';

// 确保数据库目录存在
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// 创建数据库连接
const db = new Database(DB_PATH);

// 启用WAL模式以提升并发性能
db.pragma('journal_mode = WAL');

/**
 * 初始化数据库表
 */
function initDatabase() {
  const createTableSQL = `
    CREATE TABLE IF NOT EXISTS request_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,

      -- 请求信息
      original_url TEXT NOT NULL,
      query_term TEXT,  -- 允许为空，因为URL解析可能失败

      -- 重试信息
      retry_count INTEGER DEFAULT 0,
      retry_1_term TEXT,
      retry_2_term TEXT,
      retry_3_term TEXT,

      -- 结果
      success BOOLEAN,
      final_url TEXT,
      source TEXT,
      response_time INTEGER,
      error_message TEXT,

      -- 缓存标记
      from_cache BOOLEAN DEFAULT 0
    )
  `;

  const createIndexSQL = `
    CREATE INDEX IF NOT EXISTS idx_timestamp
    ON request_logs(timestamp DESC)
  `;

  const createPaginationIndexSQL = `
    CREATE INDEX IF NOT EXISTS idx_timestamp_id
    ON request_logs(timestamp DESC, id DESC)
  `;

  db.exec(createTableSQL);
  db.exec(createIndexSQL);
  db.exec(createPaginationIndexSQL);

  console.log('Database initialized successfully');
}

// 初始化数据库
initDatabase();

module.exports = db;
