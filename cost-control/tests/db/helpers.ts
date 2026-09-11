import { Client } from 'pg'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL

const root = path.resolve(__dirname, '../..')

// สร้าง schema ใหม่ทั้งหมดจาก shim + migrations (ใช้กับ Postgres ธรรมดา ไม่ใช่ Supabase จริง)
export async function resetDatabase(client: Client) {
  await client.query('drop schema if exists public cascade; create schema public;')
  await client.query('drop schema if exists auth cascade; drop schema if exists storage cascade;')
  await client.query('grant all on schema public to public;')
  const files = [
    path.join(root, 'supabase/tests/00_supabase_shim.sql'),
    ...readdirSync(path.join(root, 'supabase/migrations'))
      .filter(f => f.endsWith('.sql'))
      .sort()
      .map(f => path.join(root, 'supabase/migrations', f)),
  ]
  for (const f of files) await client.query(readFileSync(f, 'utf8'))
}

export async function createUser(client: Client, email: string, fullName: string, role: string): Promise<string> {
  const { rows } = await client.query(
    `insert into auth.users (email, raw_user_meta_data) values ($1, $2::jsonb) returning id`,
    [email, JSON.stringify({ full_name: fullName, role })]
  )
  return rows[0].id
}

// รัน query ในฐานะผู้ใช้ (role authenticated + jwt sub) ภายใน transaction เดียว
export async function runAs<T>(client: Client, userId: string, fn: (q: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>) => Promise<T>): Promise<T> {
  await client.query('begin')
  try {
    await client.query('set local role authenticated')
    await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId])
    await client.query(`select set_config('request.jwt.claim.role', 'authenticated', true)`)
    const q = (sql: string, params?: unknown[]) => client.query(sql, params as unknown[] | undefined) as Promise<{ rows: Record<string, unknown>[] }>
    const out = await fn(q)
    await client.query('commit')
    return out
  } catch (e) {
    await client.query('rollback')
    throw e
  }
}

export const n = (v: unknown) => Number(v)
