import { spawnSync } from 'node:child_process';

const isRailway = Boolean(process.env.RAILWAY_PROJECT_ID);
const shouldPush = process.env.RUN_DB_PUSH_ON_START === 'true' || (isRailway && process.env.RUN_DB_PUSH_ON_START !== 'false');

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: process.env,
    shell: false
  });

  if (typeof result.status === 'number' && result.status !== 0) {
    process.exit(result.status);
  }

  if (result.error) {
    throw result.error;
  }
}

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

if (shouldPush) {
  console.log('[startup] Running drizzle schema push before app start...');
  run(npmCmd, ['run', 'db:push', '--', '--force']);
}

console.log('[startup] Starting app server...');
run('node', ['build/index.js']);
