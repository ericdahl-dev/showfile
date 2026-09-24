import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, zipFiles } from '../js/zip.js';

test('crc32 matches the standard check value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')) >>> 0, 0xCBF43926);
});

// Let an independent reader (Python's zipfile) judge the archive.
for (const compress of [false, true]) {
  test(`zipFiles output opens in a standard reader (compress: ${compress})`, async () => {
    const big = 'LTC '.repeat(5000);
    const blob = await zipFiles([
      { name: 'a.txt', data: 'hello' },
      { name: 'dir/b.bin', data: new Uint8Array([0, 1, 2, 255]) },
      { name: 'big.txt', data: big },
    ], { compress });
    const file = join(mkdtempSync(join(tmpdir(), 'zip-test-')), 'out.zip');
    writeFileSync(file, Buffer.from(await blob.arrayBuffer()));

    const out = execFileSync('python3', ['-c', `
import sys, zipfile, json
z = zipfile.ZipFile(sys.argv[1])
assert z.testzip() is None
print(json.dumps({n: list(z.read(n)[:8]) + [len(z.read(n))] for n in z.namelist()}))
`, file], { encoding: 'utf8' });
    const got = JSON.parse(out);
    assert.deepEqual(Object.keys(got), ['a.txt', 'dir/b.bin', 'big.txt']);
    assert.deepEqual(got['a.txt'], [...Buffer.from('hello'), 5]);
    assert.deepEqual(got['dir/b.bin'], [0, 1, 2, 255, 4]);
    assert.equal(got['big.txt'].at(-1), big.length);
  });
}
