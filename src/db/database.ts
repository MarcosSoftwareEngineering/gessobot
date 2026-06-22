import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

if (!process.env.DATABASE_URL) {
  throw new Error('❌ DATABASE_URL é obrigatório no .env (pegue no neon.tech)');
}

export const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  // Limita conexões ociosas longas - ajuda o Neon a hibernar mais rápido
  idleTimeoutMillis: 30_000,
  max: 5,
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
// 🗄️ KEEP-ALIVE REMOVIDO
// ==========================================
// O keep-alive forçado (SELECT 1 a cada 5min, 24/7) foi REMOVIDO de propósito.
// Ele impedia o Neon de hibernar (scale-to-zero), consumindo compute mesmo
// sem nenhum usuário interagindo com o bot - foi a causa do estouro de cota.
//
// O Pool do 'pg' já reconecta automaticamente quando uma nova query chega
// e o banco está hibernado. O único custo é um pequeno delay (~1-2s) na
// primeira query após um período ocioso, que é aceitável para um bot de
// WhatsApp.
//
// Se no futuro você quiser evitar esse delay em horários de pico previsíveis
// (ex: 8h-20h), pode reativar um keep-alive *condicional* só nesse período,
// nunca 24/7.

// ==========================================
// 📦 INICIALIZAÇÃO RESILIENTE DO BANCO
// ==========================================
export async function initDatabase(): Promise<void> {
  console.log('📦 Iniciando banco de dados Neon...');

  try {
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
  } catch (e) {
    // NÃO relança o erro - deixa o servidor HTTP subir mesmo se o banco
    // estiver indisponível (ex: cota excedida, hibernando, rede instável).
    // O bot pode tentar reconectar nas próximas operações.
    console.error('⚠️ Falha ao inicializar banco de dados (servidor continuará subindo):', e);
  }
}
