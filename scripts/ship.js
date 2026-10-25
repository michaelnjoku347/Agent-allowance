/**
 * One-click deploy: build the image and serve the dashboard on port 8787.
 *
 *   npm run ship
 *
 * A .env file is passed through when it exists. Docker has to be installed.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function docker() {
  const found = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8' });
  if (found.status === 0) return true;
  console.error('Docker is not running. Install Docker, start it, then run npm run ship again.');
  return false;
}

function main() {
  if (!docker()) process.exit(1);
  const args = ['compose', '-f', 'docker-compose.yml'];
  if (existsSync(join(root, '.env'))) args.push('-f', 'docker-compose.env.yml', '--env-file', '.env');
  args.push('up', '--build');
  const child = spawnSync('docker', args, { cwd: root, stdio: 'inherit' });
  process.exit(child.status ?? 1);
}

main();
