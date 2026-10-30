/**
 * Ponto de entrada em produção (app Node da Hostinger ou qualquer servidor): `npm start`.
 *
 * 1. Carrega as variáveis de um arquivo FORA da pasta do app, para sobreviver a cada novo deploy:
 *    ENV_FILE, ou ../studio85.env (ao lado de public_html).
 * 2. Aplica as migrações pendentes do banco (prisma migrate deploy).
 * 3. No primeiro boot (banco sem configurações), roda o seed com serviços, horários, termos e o admin.
 * 4. Sobe a API, que também serve o site já compilado (apps/web/dist).
 */
const { execFileSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const path = require('node:path');

const apiDir = path.join(__dirname, 'apps', 'api');

function loadEnvFile() {
  const candidates = [process.env.ENV_FILE, path.join(__dirname, '..', 'studio85.env')].filter(Boolean);
  const file = candidates.find((candidate) => existsSync(candidate));
  if (!file) return;
  // Variáveis já definidas no painel têm prioridade sobre o arquivo
  if (typeof process.loadEnvFile === 'function') process.loadEnvFile(file);
  else require(require.resolve('dotenv', { paths: [apiDir] })).config({ path: file });
  console.log(`[studio85] Variáveis carregadas de ${file}`);
}

async function firstBootSeed() {
  const { PrismaClient } = require(require.resolve('@prisma/client', { paths: [apiDir] }));
  const prisma = new PrismaClient();
  let hasSettings;
  let hasAdmin;
  try {
    hasSettings = (await prisma.businessSettings.count()) > 0;
    hasAdmin = (await prisma.user.count({ where: { roles: { some: { role: { name: 'ADMIN' } } } } })) > 0;
  } finally {
    await prisma.$disconnect();
  }
  // Instalação pronta: o seed não roda de novo (ele reescreveria horários e termos)
  if (hasSettings && hasAdmin) return;

  if ((process.env.SEED_ADMIN_PASSWORD || '').length < 8 || !process.env.SEED_ADMIN_EMAIL) {
    throw new Error('Primeiro boot: defina SEED_ADMIN_EMAIL e SEED_ADMIN_PASSWORD (8+ caracteres) para criar o admin.');
  }
  console.log(hasSettings ? '[studio85] Nenhum admin no banco: rodando o seed para criá-lo…' : '[studio85] Banco vazio: rodando o seed inicial…');
  execFileSync(process.execPath, [path.join(apiDir, 'dist-seed', 'seed.js')], { cwd: apiDir, stdio: 'inherit' });
}

async function main() {
  loadEnvFile();
  process.env.NODE_ENV = process.env.NODE_ENV || 'production';
  // Fotos e comprovantes ficam fora da pasta do app, senão um novo deploy apagaria tudo
  process.env.STORAGE_LOCAL_PATH = process.env.STORAGE_LOCAL_PATH || path.join(__dirname, '..', 'studio85-storage');

  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL não definida.');

  if (process.env.RUN_MIGRATIONS !== 'false') {
    const prismaCli = require.resolve('prisma/build/index.js', { paths: [apiDir] });
    execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], { cwd: apiDir, stdio: 'inherit' });
  }
  await firstBootSeed();

  process.chdir(apiDir);
  require(path.join(apiDir, 'dist', 'main.js'));
}

main().catch((error) => {
  console.error(`[studio85] Falha ao iniciar: ${error.message}`);
  process.exit(1);
});
