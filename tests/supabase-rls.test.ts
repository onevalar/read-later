import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Postgres RLS isolates accounts and rejects anonymous access, mutation and invalid operations', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to anon, authenticated;
      insert into auth.users values ('11111111-1111-4111-8111-111111111111'), ('22222222-2222-4222-8222-222222222222');
    `);
    const migration = await readFile(
      new URL('../supabase/migrations/202610080001_reading_operations.sql', import.meta.url),
      'utf8',
    );
    await db.exec(migration);
    await db.exec(migration); // repeatable setup does not change permissions or lose data
    const owner = '11111111-1111-4111-8111-111111111111';
    const other = '22222222-2222-4222-8222-222222222222';
    const payload = JSON.stringify({
      id: 'op1',
      kind: 'create',
      at: 1000,
      url: 'https://example.com',
      patch: { id: 'page1', title: 'Private article', savedAt: 1000 },
    });
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${owner}', false);`);
    await db.query('insert into public.reading_operations(user_id,id,payload) values ($1,$2,$3)', [
      owner,
      'op1',
      payload,
    ]);
    assert.equal((await db.query('select * from public.reading_operations')).rows.length, 1);
    await assert.rejects(
      db.query('insert into public.reading_operations(user_id,id,payload) values ($1,$2,$3)', [other, 'op1', payload]),
      /row-level security/,
    );
    await assert.rejects(db.query('update public.reading_operations set payload=$1', [payload]), /permission denied/);
    await assert.rejects(db.query('delete from public.reading_operations'), /permission denied/);
    for (const invalid of [{ id: 'null-id', kind: null }, { id: null }, { url: null }, { at: null }, { patch: null }]) {
      const op = { ...JSON.parse(payload), id: 'invalid', ...invalid };
      await assert.rejects(
        db.query('insert into public.reading_operations(user_id,id,payload) values ($1,$2,$3)', [
          owner,
          'invalid',
          JSON.stringify(op),
        ]),
        /check constraint/,
      );
    }
    await db.query(
      'insert into public.reading_operations(user_id,id,payload) values ($1,$2,$3) on conflict(user_id,id) do nothing',
      [owner, 'op1', payload],
    );
    assert.equal((await db.query('select * from public.reading_operations')).rows.length, 1);
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [other]);
    assert.equal((await db.query('select * from public.reading_operations')).rows.length, 0);
    await db.query('insert into public.reading_operations(user_id,id,payload) values ($1,$2,$3)', [
      other,
      'op1',
      payload,
    ]);
    assert.equal(
      (await db.query<{ user_id: string }>('select user_id from public.reading_operations')).rows[0].user_id,
      other,
    );
    await db.exec('reset role; set role anon;');
    await assert.rejects(db.query('select * from public.reading_operations'), /permission denied/);
    await assert.rejects(
      db.query('insert into public.reading_operations(user_id,id,payload) values ($1,$2,$3)', [owner, 'op1', payload]),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
