import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, test, vi } from 'vitest';

import {
  buildShareUrl,
  createOpaqueToken,
  hashToken,
  provisionBoard,
} from '../scripts/create-board.mjs';

const execFileAsync = promisify(execFile);

describe('board provisioning', () => {
  test('creates a 256-bit URL-safe opaque token', () => {
    const token = createOpaqueToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  test('hashes the token with SHA-256', () => {
    const token = 'FowEeAvGTBYSyLZ_hyK-x8FHD0sC6XeSNJCCxk1pq8M';

    expect(hashToken(token)).toBe(createHash('sha256').update(token, 'utf8').digest('hex'));
  });

  test('puts the capability only in the share URL fragment', () => {
    const token = 'FowEeAvGTBYSyLZ_hyK-x8FHD0sC6XeSNJCCxk1pq8M';
    const shareUrl = buildShareUrl('https://example.test/audit/?draft=1#old', token);
    const url = new URL(shareUrl);

    expect(url.hash).toBe(`#board=${token}`);
    expect(url.searchParams.has('board')).toBe(false);
    expect(url.pathname).toBe('/audit/');
  });

  test('sends only the token hash to PostgreSQL and returns one fragment URL', async () => {
    const connectionUrl = 'postgresql://provisioner:secret@db.example.test:5432/postgres';
    const siteUrl = 'https://example.test/audit/';
    const runPsql = vi.fn().mockResolvedValue(undefined);

    const result = await provisionBoard({ connectionUrl, siteUrl, runPsql });

    expect(runPsql).toHaveBeenCalledOnce();
    const [{ tokenHash, connectionUrl: receivedConnectionUrl }] = runPsql.mock.calls[0];
    expect(receivedConnectionUrl).toBe(connectionUrl);
    expect(tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.shareUrl).toBe(`${siteUrl}#board=${result.token}`);
    expect(tokenHash).toBe(createHash('sha256').update(result.token, 'utf8').digest('hex'));
    expect(JSON.stringify(runPsql.mock.calls)).not.toContain(result.token);
  });

  test('prints only the share URL when psql writes query output', async () => {
    const fakeBin = await mkdtemp(join(tmpdir(), 'audit-tracker-psql-'));
    const fakePsql = join(fakeBin, 'psql');

    try {
      await writeFile(
        fakePsql,
        '#!/bin/sh\ncat >/dev/null\nprintf "seeded row output\\n"\n',
        'utf8',
      );
      await chmod(fakePsql, 0o755);

      const { stdout, stderr } = await execFileAsync(
        process.execPath,
        [new URL('../scripts/create-board.mjs', import.meta.url).pathname],
        {
          env: {
            ...process.env,
            PATH: `${fakeBin}:${process.env.PATH}`,
            SUPABASE_DB_URL: 'postgresql://provisioner:secret@db.example.test/postgres',
            AUDIT_TRACKER_SITE_URL: 'https://example.test/audit/',
          },
        },
      );

      expect(stderr).toBe('');
      expect(stdout).toMatch(
        /^https:\/\/example\.test\/audit\/#board=[A-Za-z0-9_-]{43}\n$/,
      );
    } finally {
      await rm(fakeBin, { recursive: true, force: true });
    }
  });
});
