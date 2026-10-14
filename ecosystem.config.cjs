/**
 * PM2 — finanflow em CLUSTER (2 instâncias) para deploy zero-downtime (reload).
 *
 * Deploy sem queda:  pm2 reload finanflow   (sobe a nova antes de derrubar a velha)
 *
 * Observações desta stack:
 *  - Roda TypeScript via `node --import tsx` (interpretador node → cluster OK).
 *  - server.ts não usa dotenv; então carregamos o .env aqui e injetamos no env.
 *  - O agendador do Telegram (telegram.ts) roda só na instância 0 (guardado lá).
 *  - A credencial do Firebase Admin é o serviceAccount.json em cwd (não vai no env).
 */
const fs = require('fs');
const path = require('path');

function loadEnv(file) {
  const env = {};
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m && !line.trim().startsWith('#')) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch (_) { /* .env ausente: segue com o env do processo */ }
  return env;
}

const CWD = __dirname;

module.exports = {
  apps: [
    {
      name: 'finanflow',
      script: 'server.ts',
      interpreter: 'node',
      interpreter_args: '--import tsx',
      cwd: CWD,
      exec_mode: 'cluster',
      instances: 2,
      max_memory_restart: '400M',
      kill_timeout: 5000,
      env: {
        NODE_ENV: 'production',
        ...loadEnv(path.join(CWD, '.env')),
      },
    },
  ],
};
