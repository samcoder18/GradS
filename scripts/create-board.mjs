import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function createOpaqueToken() {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function buildShareUrl(siteUrl, token) {
  const url = new URL(siteUrl);
  url.hash = new URLSearchParams({ board: token }).toString();
  return url.toString();
}

export async function runSeedWithPsql({ connectionUrl, tokenHash }) {
  const sql = "with seeded as (select private.seed_audit_board(decode(:'board_token_hash', 'hex')) as board_id) select private.normalize_roadmap_only(board_id) from seeded;\n";
  const args = [
    '--no-psqlrc',
    '--set=ON_ERROR_STOP=1',
    `--set=board_token_hash=${tokenHash}`,
    '--file=-',
  ];

  await new Promise((resolve, reject) => {
    const child = spawn('psql', args, {
      env: { ...process.env, PGDATABASE: connectionUrl },
      stdio: ['pipe', 'ignore', 'inherit'],
    });

    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`psql failed (${signal ? `signal ${signal}` : `exit ${code}`})`));
    });

    child.stdin.end(sql);
  });
}

export async function provisionBoard({
  connectionUrl,
  siteUrl,
  runPsql = runSeedWithPsql,
}) {
  if (!connectionUrl) {
    throw new Error('SUPABASE_DB_URL is required');
  }
  if (!siteUrl) {
    throw new Error('AUDIT_TRACKER_SITE_URL is required');
  }

  const token = createOpaqueToken();
  const tokenHash = hashToken(token);

  await runPsql({ connectionUrl, tokenHash });

  return {
    token,
    shareUrl: buildShareUrl(siteUrl, token),
  };
}

async function main() {
  const result = await provisionBoard({
    connectionUrl: process.env.SUPABASE_DB_URL,
    siteUrl: process.env.AUDIT_TRACKER_SITE_URL,
  });

  process.stdout.write(`${result.shareUrl}\n`);
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMain) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
