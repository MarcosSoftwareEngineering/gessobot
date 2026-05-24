import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

if (!process.env.DATABASE_URL) {
  throw new Error('❌ DATABASE_URL é obrigatório no .env (pegue no neon.tech)');
}

export const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

export async function query(sql: string, params: any[] = []) {
  const client = await db.connect();
  try {
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

// ==========================================
// 🗄️ KEEP-ALIVE BANCO NEON (evita arquivamento)
// ==========================================
setInterval(async () => {
  try {
    await query('SELECT 1');
    console.log('🗄️ Keep-alive banco Neon OK');
  } catch (e) {
    console.warn('⚠️ Keep-alive banco falhou:', e);
  }
}, 5 * 60 * 1000); // A cada 5 minutos

export async function initDatabase(): Promise<void> {
  console.log('📦 Iniciando banco de dados Neon...');

  await query(`
    CREATE TABLE IF NOT EXISTS orcamentos (
      id SERIAL PRIMARY KEY,
      numero_cliente TEXT NOT NULL,
      nome_cliente TEXT,
      servico TEXT NOT NULL,
      metragem REAL,
      metros_lineares REAL,
      ambiente TEXT,
      acabamento TEXT,
      localizacao TEXT,
      valor_total REAL,
      desconto REAL DEFAULT 0,
      valor_final REAL,
      prazo_dias INTEGER,
      status TEXT DEFAULT 'pendente',
      criado_em TIMESTAMP DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS sessoes (
      numero_cliente TEXT PRIMARY KEY,
      estado TEXT DEFAULT 'INICIO',
      dados TEXT DEFAULT '{}',
      ultimo_acesso TIMESTAMP DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS clientes (
      numero TEXT PRIMARY KEY,
      nome TEXT,
      total_orcamentos INTEGER DEFAULT 0,
      ultimo_contato TIMESTAMP DEFAULT NOW()
    )
  `);

  console.log('✅ Banco de dados pronto!');
}