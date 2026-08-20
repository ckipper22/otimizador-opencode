import path from "path";
import { connect } from "@tursodatabase/serverless";

const TURSO_URL = process.env.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;
const USE_TURSO = !!TURSO_URL && !!TURSO_TOKEN;

let tursoClient: any = null;
let db: any = null;
let dbFailed = false;

function getTursoClient() {
  if (!tursoClient && USE_TURSO) {
    console.log("[DB] Conectando ao Turso (SQLite na nuvem)");
    tursoClient = connect({ url: TURSO_URL!, authToken: TURSO_TOKEN! });
  }
  return tursoClient;
}

function getDb(): any {
  if (USE_TURSO) return getTursoClient();
  if (dbFailed) return null;
  if (!db) {
    try {
      const Database = require("better-sqlite3");
      const DB_PATH = process.env.NODE_ENV === "production"
        ? path.join("/tmp", "smartped.db")
        : path.join(process.cwd(), "data", "smartped.db");
      db = new Database(DB_PATH);
      db.pragma("journal_mode = WAL");
      db.pragma("synchronous = NORMAL");
      initSchemaSync();
    } catch (err: any) {
      console.error(`[DB] SQLite indisponível: ${err.message}. Usando apenas cache em memória.`);
      dbFailed = true;
      return null;
    }
  }
  return db;
}

function initSchemaSync() {
  const d = getDb();
  if (!d || USE_TURSO) return;
  d.exec(SCHEMA_SQL);
  runMigrations(d);
}

function runMigrations(d: any) {
  try {
    // Migração: adicionar colunas 'origem' e 'id_encomenda' na tabela itens_manuais (se não existirem)
    d.exec(`ALTER TABLE itens_manuais ADD COLUMN origem TEXT DEFAULT 'manual';`);
  } catch {}
  try {
    d.exec(`ALTER TABLE itens_manuais ADD COLUMN id_encomenda TEXT;`);
  } catch {}
  try {
    // Migração: adicionar colunas 'origem' e 'id_encomenda' na tabela order_items
    d.exec(`ALTER TABLE order_items ADD COLUMN origem TEXT DEFAULT 'manual';`);
  } catch {}
  try {
    d.exec(`ALTER TABLE order_items ADD COLUMN id_encomenda TEXT;`);
  } catch {}
  try {
    // Migração: adicionar colunas 'origem' e 'id_encomenda' na tabela itens_confirmados
    d.exec(`ALTER TABLE itens_confirmados ADD COLUMN origem TEXT DEFAULT 'manual';`);
  } catch {}
  try {
    d.exec(`ALTER TABLE itens_confirmados ADD COLUMN id_encomenda TEXT;`);
  } catch {}
}

const SCHEMA_SQL = `
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
    origem TEXT DEFAULT 'manual',
    id_encomenda TEXT,
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
  CREATE TABLE IF NOT EXISTS itens_confirmados (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    num_pedido TEXT,
    ean TEXT,
    descricao TEXT,
    laboratorio TEXT,
    cod_dist INTEGER,
    nome_dist TEXT,
    qtd_solicitada INTEGER,
    qtd_faturada INTEGER,
    preco_liquido REAL,
    status TEXT,
    motivo TEXT,
    cnpj TEXT,
    data_confirmacao TEXT,
    origem TEXT DEFAULT 'manual',
    id_encomenda TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(num_pedido, ean, cod_dist)
  );
  CREATE INDEX IF NOT EXISTS idx_orders_cnpj ON orders(cnpj);
  CREATE INDEX IF NOT EXISTS idx_orders_data ON orders(data_pedido);
  CREATE INDEX IF NOT EXISTS idx_order_items_pedido ON order_items(num_pedido);
  CREATE INDEX IF NOT EXISTS idx_api_cache_expires ON api_cache(expires_at);
  CREATE INDEX IF NOT EXISTS idx_faturados_pedido ON faturados(num_pedido);
  CREATE INDEX IF NOT EXISTS idx_itens_confirmados_cnpj ON itens_confirmados(cnpj);
  CREATE INDEX IF NOT EXISTS idx_itens_confirmados_data ON itens_confirmados(data_confirmacao);
  CREATE TABLE IF NOT EXISTS itens_manuais (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cod_interno TEXT UNIQUE,
    ean TEXT,
    descricao TEXT,
    laboratorio TEXT,
    distribuidora TEXT,
    cod_dist INTEGER,
    qtd INTEGER,
    preco_liquido REAL,
    preco_fabrica REAL,
    condicao TEXT,
    prazo INTEGER,
    cnpj TEXT,
    status TEXT DEFAULT 'adicionado',
    data_adicao TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    origem TEXT DEFAULT 'manual',
    id_encomenda TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_itens_manuais_cnpj ON itens_manuais(cnpj);
  CREATE INDEX IF NOT EXISTS idx_itens_manuais_data ON itens_manuais(data_adicao);
  CREATE INDEX IF NOT EXISTS idx_itens_manuais_status ON itens_manuais(status);
  CREATE TABLE IF NOT EXISTS precos_cache (
    ean TEXT,
    cod_dist INTEGER,
    condicao TEXT,
    prazo INTEGER,
    preco_liquido REAL,
    estoque INTEGER,
    nome_dist TEXT,
    qtd_min INTEGER DEFAULT 0,
    tipo_item TEXT,
    ultima_atualizacao TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (ean, cod_dist, condicao, prazo)
  );
  CREATE INDEX IF NOT EXISTS idx_precos_cache_ean ON precos_cache(ean);
  CREATE INDEX IF NOT EXISTS idx_precos_cache_update ON precos_cache(ultima_atualizacao);
  CREATE TABLE IF NOT EXISTS produtos_cache (
    ean TEXT PRIMARY KEY,
    descricao TEXT,
    laboratorio TEXT,
    dcb TEXT,
    molecula TEXT,
    concentracao TEXT,
    apresentacao TEXT,
    tipo_item TEXT,
    ultima_atualizacao TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_produtos_cache_dcb ON produtos_cache(dcb);
  CREATE INDEX IF NOT EXISTS idx_produtos_cache_molecula ON produtos_cache(molecula);
  CREATE INDEX IF NOT EXISTS idx_produtos_cache_update ON produtos_cache(ultima_atualizacao);
`;

export async function initTursoSchema() {
  if (!USE_TURSO) return;
  const d = getDb();
  if (!d) return;
  await d.exec(SCHEMA_SQL);
}

// Orders
export async function saveOrder(numPedido: string, cnpj: string, dataPedido: string, payload: any, response?: any) {
  const d = getDb();
  if (!d) return;
  try {
    const sql = `INSERT OR REPLACE INTO orders (num_pedido, cnpj, data_pedido, payload_json, response_json, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'))`;
    const args = [numPedido, cnpj, dataPedido, JSON.stringify(payload), response ? JSON.stringify(response) : null];
    if (USE_TURSO) { await d.run(sql, ...args); } else { d.prepare(sql).run(...args); }
  } catch {}
}

export async function updateOrderResponse(numPedido: string, response: any) {
  const d = getDb();
  if (!d) return;
  try {
    const sql = `UPDATE orders SET response_json = ?, status = 'completed', updated_at = datetime('now') WHERE num_pedido = ?`;
    const args = [JSON.stringify(response), numPedido];
    if (USE_TURSO) { await d.run(sql, ...args); } else { d.prepare(sql).run(...args); }
  } catch {}
}

export async function getOrder(numPedido: string) {
  const d = getDb();
  if (!d) return undefined;
  try {
    const sql = `SELECT * FROM orders WHERE num_pedido = ?`;
    if (USE_TURSO) { return await d.get(sql, numPedido); }
    return d.prepare(sql).get(numPedido);
  } catch { return undefined; }
}

export async function getOrdersByCnpj(cnpj: string, limit = 50) {
  const d = getDb();
  if (!d) return [];
  try {
    const sql = `SELECT * FROM orders WHERE cnpj = ? ORDER BY created_at DESC LIMIT ?`;
    if (USE_TURSO) { return await d.all(sql, cnpj, limit); }
    return d.prepare(sql).all(cnpj, limit);
  } catch { return []; }
}

// Order Items
export async function saveOrderItem(item: {
  numPedido: string; ean: string; descricao: string; laboratorio: string;
  codDist: number; nomeDist: string; qtd: number; precoLiquido: number;
  precoOriginal?: number; economia?: number; isSwap?: boolean;
  origem?: string; idEncomenda?: string;
}) {
  const d = getDb();
  if (!d) return;
  try {
    const sql = `INSERT INTO order_items (num_pedido, ean, descricao, laboratorio, cod_dist, nome_dist, qtd, preco_liquido, preco_original, economia, is_swap, origem, id_encomenda) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const args = [item.numPedido, item.ean, item.descricao, item.laboratorio, item.codDist, item.nomeDist, item.qtd, item.precoLiquido, item.precoOriginal || 0, item.economia || 0, item.isSwap ? 1 : 0, item.origem || 'manual', item.idEncomenda || null];
    if (USE_TURSO) { await d.run(sql, ...args); } else { d.prepare(sql).run(...args); }
  } catch {}
}

export async function getOrderItems(numPedido: string) {
  const d = getDb();
  if (!d) return [];
  try {
    const sql = `SELECT * FROM order_items WHERE num_pedido = ?`;
    if (USE_TURSO) { return await d.all(sql, numPedido); }
    return d.prepare(sql).all(numPedido);
  } catch { return []; }
}

// API Cache with TTL
export async function setCache(key: string, data: any, ttlMinutes = 5) {
  const d = getDb();
  if (!d) return;
  try {
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
    const sql = `INSERT OR REPLACE INTO api_cache (cache_key, data_json, expires_at) VALUES (?, ?, ?)`;
    const args = [key, JSON.stringify(data), expiresAt];
    if (USE_TURSO) { await d.run(sql, ...args); } else { d.prepare(sql).run(...args); }
  } catch {}
}

export async function getCache(key: string): Promise<any | null> {
  const d = getDb();
  if (!d) return null;
  try {
    const sql = `SELECT data_json, expires_at FROM api_cache WHERE cache_key = ?`;
    let row: any;
    if (USE_TURSO) { row = await d.get(sql, key); } else { row = d.prepare(sql).get(key); }
    if (!row) return null;
    if (new Date(row.expires_at) < new Date()) {
      const delSql = `DELETE FROM api_cache WHERE cache_key = ?`;
      if (USE_TURSO) { await d.run(delSql, key); } else { d.prepare(delSql).run(key); }
      return null;
    }
    return JSON.parse(row.data_json);
  } catch { return null; }
}

export async function purgeExpiredCache() {
  const d = getDb();
  if (!d) return 0;
  try {
    const sql = `DELETE FROM api_cache WHERE expires_at < datetime('now')`;
    if (USE_TURSO) {
      const result = await d.run(sql);
      return result.rowsAffected ?? 0;
    }
    return d.prepare(sql).run().changes;
  } catch { return 0; }
}

// Faturados (billed items history)
export async function saveFaturado(item: {
  numPedido: string; ean: string; descricao: string; laboratorio: string;
  codDist: number; nomeDist: string; qtd: number; precoLiquido: number;
}) {
  const d = getDb();
  if (!d) return;
  try {
    const sql = `INSERT INTO faturados (num_pedido, ean, descricao, laboratorio, cod_dist, nome_dist, qtd, preco_liquido) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
    const args = [item.numPedido, item.ean, item.descricao, item.laboratorio, item.codDist, item.nomeDist, item.qtd, item.precoLiquido];
    if (USE_TURSO) { await d.run(sql, ...args); } else { d.prepare(sql).run(...args); }
  } catch {}
}

export async function getFaturados(cnpj: string, limit = 200) {
  const d = getDb();
  if (!d) return [];
  try {
    const sql = `SELECT f.* FROM faturados f JOIN orders o ON f.num_pedido = o.num_pedido WHERE o.cnpj = ? ORDER BY f.created_at DESC LIMIT ?`;
    if (USE_TURSO) { return await d.all(sql, cnpj, limit); }
    return d.prepare(sql).all(cnpj, limit);
  } catch { return []; }
}

// Itens Confirmados (items with confirmed return status)
export async function saveItemConfirmado(item: {
  numPedido: string; ean: string; descricao: string; laboratorio: string;
  codDist: number; nomeDist: string; qtdSolicitada: number; qtdFaturada: number;
  precoLiquido: number; status: string; motivo?: string; cnpj: string; dataConfirmacao: string;
}) {
  const d = getDb();
  if (!d) return;
  try {
    const sql = `INSERT INTO itens_confirmados (num_pedido, ean, descricao, laboratorio, cod_dist, nome_dist, qtd_solicitada, qtd_faturada, preco_liquido, status, motivo, cnpj, data_confirmacao, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(num_pedido, ean, cod_dist) DO UPDATE SET
        qtd_faturada = excluded.qtd_faturada,
        status = excluded.status,
        motivo = excluded.motivo,
        updated_at = datetime('now')`;
    const args = [item.numPedido, item.ean, item.descricao, item.laboratorio, item.codDist, item.nomeDist, item.qtdSolicitada, item.qtdFaturada, item.precoLiquido, item.status, item.motivo || "", item.cnpj, item.dataConfirmacao];
    if (USE_TURSO) { await d.run(sql, ...args); } else { d.prepare(sql).run(...args); }
  } catch {}
}

export async function getItensConfirmados(cnpj: string, dataInicio?: string, dataFim?: string, limit = 500) {
  const d = getDb();
  if (!d) return [];
  try {
    let sql = `SELECT * FROM itens_confirmados WHERE cnpj = ?`;
    const args: any[] = [cnpj];
    if (dataInicio) {
      sql += ` AND data_confirmacao >= ?`;
      args.push(dataInicio);
    }
    if (dataFim) {
      sql += ` AND data_confirmacao <= ?`;
      args.push(dataFim);
    }
    sql += ` ORDER BY updated_at DESC LIMIT ?`;
    args.push(limit);
    if (USE_TURSO) { return await d.all(sql, ...args); }
    return d.prepare(sql).all(...args);
  } catch { return []; }
}

// Itens Manuais (items added manually via button "+")
export async function saveItemManual(item: {
  codInterno: string; ean: string; descricao: string; laboratorio: string;
  distribuidora: string; codDist: number; qtd: number; precoLiquido: number;
  precoFabrica?: number; condicao?: string; prazo?: number; cnpj: string;
  dataAdicao: string; status?: string;
  origem?: string; idEncomenda?: string;
}) {
  const d = getDb();
  if (!d) return;
  try {
    const sql = `INSERT INTO itens_manuais (cod_interno, ean, descricao, laboratorio, distribuidora, cod_dist, qtd, preco_liquido, preco_fabrica, condicao, prazo, cnpj, status, data_adicao, updated_at, origem, id_encomenda)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?)
      ON CONFLICT(cod_interno) DO UPDATE SET
        qtd = excluded.qtd,
        status = excluded.status,
        updated_at = datetime('now)`;
    const args = [item.codInterno, item.ean, item.descricao, item.laboratorio, item.distribuidora, item.codDist, item.qtd, item.precoLiquido, item.precoFabrica || 0, item.condicao || "", item.prazo || 0, item.cnpj, item.status || "adicionado", item.dataAdicao, item.origem || "manual", item.idEncomenda || null];
    if (USE_TURSO) { await d.run(sql, ...args); } else { d.prepare(sql).run(...args); }
  } catch {}
}

export async function getItensManuais(cnpj: string, dataInicio?: string, dataFim?: string, limit = 500) {
  const d = getDb();
  if (!d) return [];
  try {
    let sql = `SELECT * FROM itens_manuais WHERE cnpj = ?`;
    const args: any[] = [cnpj];
    if (dataInicio) {
      sql += ` AND data_adicao >= ?`;
      args.push(dataInicio);
    }
    if (dataFim) {
      sql += ` AND data_adicao <= ?`;
      args.push(dataFim);
    }
    sql += ` ORDER BY created_at DESC LIMIT ?`;
    args.push(limit);
    if (USE_TURSO) { return await d.all(sql, ...args); }
    return d.prepare(sql).all(...args);
  } catch { return []; }
}

// Purge de dados antigos (6 meses)
export async function purgeOldData() {
  const d = getDb();
  if (!d) return 0;
  const sixMonthsAgo = new Date(Date.now() - 6 * 30 * 24 * 60 * 60 * 1000).toISOString();
  let totalPurged = 0;
  try {
    const tables = [
      { table: "orders", dateCol: "created_at" },
      { table: "order_items", dateCol: "created_at" },
      { table: "faturados", dateCol: "created_at" },
      { table: "itens_confirmados", dateCol: "created_at" },
      { table: "itens_manuais", dateCol: "created_at" }
    ];
    for (const { table, dateCol } of tables) {
      const sql = `DELETE FROM ${table} WHERE ${dateCol} < ?`;
      if (USE_TURSO) {
        const result = await d.run(sql, sixMonthsAgo);
        totalPurged += result.rowsAffected ?? 0;
      } else {
        totalPurged += d.prepare(sql).run(sixMonthsAgo).changes;
      }
    }
    if (totalPurged > 0) {
      console.log(`[DB PURGE 6M] ${totalPurged} registros antigos removidos.`);
    }
  } catch (e: any) {
    console.error(`[DB PURGE 6M] Erro: ${e.message}`);
  }
  return totalPurged;
}

// Startup cache purge
export function startDbCachePurge() {
  setInterval(async () => {
    const purged = await purgeExpiredCache();
    if (purged > 0) {
      console.log(`[DB CACHE PURGE] ${purged} entradas expiradas removidas.`);
    }
  }, 10 * 60 * 1000);

  // Purge de dados antigos (6 meses) - executa a cada 24h
  setInterval(async () => {
    await purgeOldData();
  }, 24 * 60 * 60 * 1000);
}

// Produtos Cache (DCB, molecula, concentracao)
export async function saveProdutoCache(item: {
  ean: string; descricao?: string; laboratorio?: string;
  dcb?: string; molecula?: string; concentracao?: string;
  apresentacao?: string; tipoItem?: string;
}) {
  const d = getDb();
  if (!d) return;
  try {
    const sql = `INSERT OR REPLACE INTO produtos_cache (ean, descricao, laboratorio, dcb, molecula, concentracao, apresentacao, tipo_item, ultima_atualizacao)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`;
    const args = [item.ean, item.descricao || null, item.laboratorio || null, item.dcb || null, item.molecula || null, item.concentracao || null, item.apresentacao || null, item.tipoItem || null];
    if (USE_TURSO) { await d.run(sql, ...args); } else { d.prepare(sql).run(...args); }
  } catch {}
}

export async function countProdutosCache(): Promise<number> {
  const d = getDb();
  if (!d) return 0;
  try {
    const sql = `SELECT COUNT(*) as count FROM produtos_cache`;
    let row: any;
    if (USE_TURSO) { row = await d.get(sql); } else { row = d.prepare(sql).get(); }
    return row?.count || 0;
  } catch { return 0; }
}

// Precos Cache (preços e estoque do giro diário)
export async function savePrecosCacheBatch(items: Array<{
  ean: string; codDist: number; condicao: string; prazo: number;
  precoLiquido: number; estoque: number; nomeDist: string;
  qtdMin?: number; tipoItem?: string;
}>) {
  const d = getDb();
  if (!d || items.length === 0) return;
  try {
    const sql = `INSERT OR REPLACE INTO precos_cache (ean, cod_dist, condicao, prazo, preco_liquido, estoque, nome_dist, qtd_min, tipo_item, ultima_atualizacao)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`;
    for (const item of items) {
      const args = [item.ean, item.codDist, item.condicao, item.prazo, item.precoLiquido, item.estoque, item.nomeDist, item.qtdMin || 0, item.tipoItem || null];
      if (USE_TURSO) { await d.run(sql, ...args); } else { d.prepare(sql).run(...args); }
    }
  } catch {}
}

export async function getPrecoCacheByEan(ean: string): Promise<any[]> {
  const d = getDb();
  if (!d) return [];
  try {
    const sql = `SELECT * FROM precos_cache WHERE ean = ? ORDER BY preco_liquido ASC`;
    if (USE_TURSO) { return await d.all(sql, ean); }
    return d.prepare(sql).all(ean);
  } catch { return []; }
}

export async function getPrecoCacheByEans(eans: string[]): Promise<Map<string, any[]>> {
  const d = getDb();
  const result = new Map<string, any[]>();
  if (!d || eans.length === 0) return result;
  try {
    const placeholders = eans.map(() => '?').join(',');
    const sql = `SELECT * FROM precos_cache WHERE ean IN (${placeholders}) ORDER BY preco_liquido ASC`;
    let rows: any[];
    if (USE_TURSO) { rows = await d.all(sql, ...eans); } else { rows = d.prepare(sql).all(...eans); }
    for (const row of rows) {
      const existing = result.get(row.ean) || [];
      existing.push(row);
      result.set(row.ean, existing);
    }
  } catch {}
  return result;
}

export async function listPrecosCache(limit = 50): Promise<any[]> {
  const d = getDb();
  if (!d) return [];
  try {
    const sql = `SELECT * FROM precos_cache ORDER BY preco_liquido ASC LIMIT ?`;
    if (USE_TURSO) { return await d.all(sql, limit); }
    return d.prepare(sql).all(limit);
  } catch { return []; }
}

export async function countPrecosCache(): Promise<number> {
  const d = getDb();
  if (!d) return 0;
  try {
    const sql = `SELECT COUNT(*) as count FROM precos_cache`;
    let row: any;
    if (USE_TURSO) { row = await d.get(sql); } else { row = d.prepare(sql).get(); }
    return row?.count || 0;
  } catch { return 0; }
}

export async function purgePrecosCache(): Promise<number> {
  const d = getDb();
  if (!d) return 0;
  try {
    const countSql = `SELECT COUNT(*) as count FROM precos_cache`;
    let before: any;
    if (USE_TURSO) { before = await d.get(countSql); } else { before = d.prepare(countSql).get(); }
    const count = before?.count || 0;
    const sql = `DELETE FROM precos_cache`;
    if (USE_TURSO) { await d.run(sql); } else { d.prepare(sql).run(); }
    return count;
  } catch { return 0; }
}

export async function getLastPrecoSync(): Promise<string | null> {
  const d = getDb();
  if (!d) return null;
  try {
    const sql = `SELECT MAX(ultima_atualizacao) as last_sync FROM precos_cache`;
    let row: any;
    if (USE_TURSO) { row = await d.get(sql); } else { row = d.prepare(sql).get(); }
    return row?.last_sync || null;
  } catch { return null; }
}

// EANs Fixos — usa tabela existente sugestoes_eans (populados uma vez via Sugestoes — nunca atualizados)
export async function saveEansFixos(eans: Array<{ ean: string; descricao?: string; laboratorio?: string; codDist?: number; nomeDist?: string }>) {
  const d = getDb();
  if (!d || eans.length === 0) return;
  try {
    const sql = `INSERT OR REPLACE INTO sugestoes_eans (ean, descricao, laboratorio, cod_dist, nome_dist, ultima_atualizacao) VALUES (?, ?, ?, ?, ?, datetime('now'))`;
    for (const e of eans) {
      const args = [e.ean, e.descricao || null, e.laboratorio || null, e.codDist || null, e.nomeDist || null];
      if (USE_TURSO) { await d.run(sql, ...args); } else { d.prepare(sql).run(...args); }
    }
  } catch {}
}

export async function getEansFixos(): Promise<string[]> {
  const d = getDb();
  if (!d) return [];
  try {
    const sql = `SELECT ean FROM sugestoes_eans ORDER BY ultima_atualizacao DESC`;
    let rows: any[];
    if (USE_TURSO) { rows = await d.all(sql); } else { rows = d.prepare(sql).all(); }
    return rows.map((r: any) => r.ean).filter((e: string) => !!e);
  } catch { return []; }
}

export async function countEansFixos(): Promise<number> {
  const d = getDb();
  if (!d) return 0;
  try {
    const sql = `SELECT COUNT(*) as count FROM sugestoes_eans`;
    let row: any;
    if (USE_TURSO) { row = await d.get(sql); } else { row = d.prepare(sql).get(); }
    return row?.count || 0;
  } catch { return 0; }
}

export function closeDb() {
  if (!USE_TURSO && db) {
    try { db.close(); } catch {}
    db = null;
  }
}
