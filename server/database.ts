import Database from "better-sqlite3";
import path from "path";

const DB_PATH = process.env.NODE_ENV === "production"
  ? path.join("/tmp", "smartped.db")
  : path.join(process.cwd(), "data", "smartped.db");

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    initSchema();
  }
  return db;
}

function initSchema() {
  const d = getDb();
  d.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      num_pedido TEXT UNIQUE,
      cnpj TEXT,
      data_pedido TEXT,
      status TEXT DEFAULT 'pending',
      payload_json TEXT,
      response_json TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      num_pedido TEXT,
      ean TEXT,
      descricao TEXT,
      laboratorio TEXT,
      cod_dist INTEGER,
      nome_dist TEXT,
      qtd INTEGER,
      preco_liquido REAL,
      preco_original REAL,
      economia REAL,
      is_swap INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (num_pedido) REFERENCES orders(num_pedido)
    );

    CREATE TABLE IF NOT EXISTS api_cache (
      cache_key TEXT PRIMARY KEY,
      data_json TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT
    );

    CREATE TABLE IF NOT EXISTS faturados (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      num_pedido TEXT,
      ean TEXT,
      descricao TEXT,
      laboratorio TEXT,
      cod_dist INTEGER,
      nome_dist TEXT,
      qtd INTEGER,
      preco_liquido REAL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_orders_cnpj ON orders(cnpj);
    CREATE INDEX IF NOT EXISTS idx_orders_data ON orders(data_pedido);
    CREATE INDEX IF NOT EXISTS idx_order_items_pedido ON order_items(num_pedido);
    CREATE INDEX IF NOT EXISTS idx_api_cache_expires ON api_cache(expires_at);
    CREATE INDEX IF NOT EXISTS idx_faturados_pedido ON faturados(num_pedido);
  `);
}

// Orders
export function saveOrder(numPedido: string, cnpj: string, dataPedido: string, payload: any, response?: any) {
  const d = getDb();
  const stmt = d.prepare(`
    INSERT OR REPLACE INTO orders (num_pedido, cnpj, data_pedido, payload_json, response_json, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `);
  stmt.run(numPedido, cnpj, dataPedido, JSON.stringify(payload), response ? JSON.stringify(response) : null);
}

export function updateOrderResponse(numPedido: string, response: any) {
  const d = getDb();
  d.prepare(`UPDATE orders SET response_json = ?, status = 'completed', updated_at = datetime('now') WHERE num_pedido = ?`)
    .run(JSON.stringify(response), numPedido);
}

export function getOrder(numPedido: string) {
  const d = getDb();
  return d.prepare(`SELECT * FROM orders WHERE num_pedido = ?`).get(numPedido);
}

export function getOrdersByCnpj(cnpj: string, limit = 50) {
  const d = getDb();
  return d.prepare(`SELECT * FROM orders WHERE cnpj = ? ORDER BY created_at DESC LIMIT ?`).all(cnpj, limit);
}

// Order Items
export function saveOrderItem(item: {
  numPedido: string; ean: string; descricao: string; laboratorio: string;
  codDist: number; nomeDist: string; qtd: number; precoLiquido: number;
  precoOriginal?: number; economia?: number; isSwap?: boolean;
}) {
  const d = getDb();
  d.prepare(`
    INSERT INTO order_items (num_pedido, ean, descricao, laboratorio, cod_dist, nome_dist, qtd, preco_liquido, preco_original, economia, is_swap)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(item.numPedido, item.ean, item.descricao, item.laboratorio, item.codDist, item.nomeDist, item.qtd, item.precoLiquido, item.precoOriginal || 0, item.economia || 0, item.isSwap ? 1 : 0);
}

export function getOrderItems(numPedido: string) {
  const d = getDb();
  return d.prepare(`SELECT * FROM order_items WHERE num_pedido = ?`).all(numPedido);
}

// API Cache with TTL
export function setCache(key: string, data: any, ttlMinutes = 5) {
  const d = getDb();
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
  d.prepare(`INSERT OR REPLACE INTO api_cache (cache_key, data_json, expires_at) VALUES (?, ?, ?)`)
    .run(key, JSON.stringify(data), expiresAt);
}

export function getCache(key: string): any | null {
  const d = getDb();
  const row = d.prepare(`SELECT data_json, expires_at FROM api_cache WHERE cache_key = ?`).get(key) as any;
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) {
    d.prepare(`DELETE FROM api_cache WHERE cache_key = ?`).run(key);
    return null;
  }
  return JSON.parse(row.data_json);
}

export function purgeExpiredCache() {
  const d = getDb();
  const result = d.prepare(`DELETE FROM api_cache WHERE expires_at < datetime('now')`).run();
  return result.changes;
}

// Faturados (billed items history)
export function saveFaturado(item: {
  numPedido: string; ean: string; descricao: string; laboratorio: string;
  codDist: number; nomeDist: string; qtd: number; precoLiquido: number;
}) {
  const d = getDb();
  d.prepare(`
    INSERT INTO faturados (num_pedido, ean, descricao, laboratorio, cod_dist, nome_dist, qtd, preco_liquido)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(item.numPedido, item.ean, item.descricao, item.laboratorio, item.codDist, item.nomeDist, item.qtd, item.precoLiquido);
}

export function getFaturados(cnpj: string, limit = 200) {
  const d = getDb();
  return d.prepare(`
    SELECT f.* FROM faturados f
    JOIN orders o ON f.num_pedido = o.num_pedido
    WHERE o.cnpj = ?
    ORDER BY f.created_at DESC LIMIT ?
  `).all(cnpj, limit);
}

// Startup cache purge
export function startDbCachePurge() {
  setInterval(() => {
    const purged = purgeExpiredCache();
    if (purged > 0) {
      console.log(`[DB CACHE PURGE] ${purged} entradas expiradas removidas.`);
    }
  }, 10 * 60 * 1000);
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
