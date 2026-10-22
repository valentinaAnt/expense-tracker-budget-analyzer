import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Creates an empty folder in the OS temp directory for one test's database,
 * so tests never touch the real data/ folder.
 * Close every database opened in it before calling cleanup().
 */
export function createTempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'expense-tracker-test-'));
  return {
    dir,
    dbPath: join(dir, 'test.db'),
    cleanup: () => rmSync(dir, { recursive: true, force: true, maxRetries: 3 }),
  };
}
