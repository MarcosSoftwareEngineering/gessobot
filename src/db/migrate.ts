import { initDatabase } from './database';

initDatabase()
  .then(() => {
    console.log('✅ Migração concluída!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Erro na migração:', err);
    process.exit(1);
  });
