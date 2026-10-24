import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'

mkdirSync('data', { recursive: true })

export const db = new DatabaseSync(process.env.HANDLED_DB ?? 'data/handled.db')

db.exec(`
create table if not exists settings (key text primary key, value text);
create table if not exists profile (id integer primary key check (id = 1), data text not null);
create table if not exists cases (
  id text primary key,
  playbook text,
  pack text,
  title text not null,
  status text not null default 'open',
  fields text not null default '{}',
  computed text not null default '{}',
  summary text,
  questions text,
  money_at_stake real not null default 0,
  money_recovered real not null default 0,
  messages text not null default '[]',
  busy integer not null default 0,
  created_at text not null,
  updated_at text not null
);
create table if not exists events (
  id integer primary key autoincrement,
  case_id text not null,
  at text not null,
  kind text not null,
  title text not null,
  detail text
);
create table if not exists actions (
  id integer primary key autoincrement,
  case_id text not null,
  step text,
  tool text not null,
  title text not null,
  payload text not null,
  status text not null default 'proposed',
  due_at text,
  source text,
  result text,
  created_at text not null,
  done_at text
);
create table if not exists deadlines (
  id integer primary key autoincrement,
  case_id text not null,
  title text not null,
  due_at text not null,
  rule_id text,
  note text,
  kind text not null default 'deadline',
  done integer not null default 0
);
create table if not exists jobs (
  id integer primary key autoincrement,
  case_id text not null,
  kind text not null,
  run_at text not null,
  payload text not null default '{}',
  status text not null default 'pending'
);
`)

export function json<T = any>(text: string | null | undefined, fallback: T): T {
  return text ? JSON.parse(text) : fallback
}
