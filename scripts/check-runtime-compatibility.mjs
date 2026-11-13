import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDatabase } from '../server/db.mjs';
import { privateFields } from '../server/privacy.mjs';

// Use a new, synthetic directory only: never point this fixture at application data.
const [phase, directory] = process.argv.slice(2);
if (!['seed', 'upgrade', 'verify'].includes(phase) || !directory) throw Error('Expected fixture phase and directory');
const marker = join(directory, 'synthetic-runtime-fixture');
if (phase === 'seed') {
  mkdirSync(directory, { mode: 0o700 });
  writeFileSync(marker, 'market-runtime-fixture\n', { flag: 'wx' });
} else {
  assert.equal(readFileSync(marker, 'utf8'), 'market-runtime-fixture\n');
}
const db = openDatabase(directory);
try {
  const fields = privateFields(directory, db);
  if (phase === 'seed') {
    db.prepare('INSERT INTO audit VALUES(?,?,?,?,?)').run('one', 'fixture', 'test', fields.seal('synthetic-old', 'fixture:one'), 1);
  } else {
    assert.equal(fields.open(db.prepare('SELECT target FROM audit WHERE id=?').get('one').target, 'fixture:one'), 'synthetic-old');
    if (phase === 'upgrade') {
      db.prepare('INSERT INTO audit VALUES(?,?,?,?,?)').run('two', 'fixture', 'test', fields.seal('synthetic-new', 'fixture:two'), 2);
    } else {
      assert.equal(fields.open(db.prepare('SELECT target FROM audit WHERE id=?').get('two').target, 'fixture:two'), 'synthetic-new');
    }
  }
  console.log(`Synthetic encrypted SQLite fixture: ${phase} passed`);
} finally { db.close(); }
