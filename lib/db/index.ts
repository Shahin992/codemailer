import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/lib/env";
import * as schema from "./schema";

type Db = NodePgDatabase<typeof schema>;

// Reuse one pool across hot reloads in development.
const globalForDb = globalThis as unknown as { __pool?: Pool; __db?: Db };

function createDb(): Db {
  const pool = globalForDb.__pool ?? new Pool({ connectionString: env("DATABASE_URL"), max: 10 });
  globalForDb.__pool = pool;
  return drizzle(pool, { schema });
}

export function getDb(): Db {
  if (!globalForDb.__db) globalForDb.__db = createDb();
  return globalForDb.__db;
}

// `db` is created on first use, so importing this module never needs a database.
export const db = new Proxy({} as Db, {
  get(_target, prop) {
    const real = getDb() as unknown as Record<string | symbol, unknown>;
    const value = real[prop];
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(real) : value;
  },
});

export { schema };
