import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

const connectionString = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;
export let hasDatabaseConfig = Boolean(connectionString);

function createMockDb(): NodePgDatabase<typeof schema> {
  const createChainable = (): any => {
    const resolved = Promise.resolve([]);
    const fn = () => createChainable();
    return new Proxy(fn, {
      get(_target, prop) {
        if (prop === "then") return resolved.then.bind(resolved);
        if (prop === "catch") return resolved.catch.bind(resolved);
        if (prop === "finally") return resolved.finally.bind(resolved);
        if (prop === "execute") return async () => ({ rows: [] });
        if (prop === "transaction") {
          return async (cb: (tx: any) => Promise<any>) => cb(createMockDb());
        }
        if (prop === "query") {
          return new Proxy(
            {},
            {
              get() {
                return {
                  findMany: async () => [],
                  findFirst: async () => null,
                };
              },
            },
          );
        }
        return () => createChainable();
      },
    });
  };
  return createChainable() as NodePgDatabase<typeof schema>;
}

function createMockPool(): pg.Pool {
  const mockClient = {
    query: async () => ({ rows: [], rowCount: 0 }),
    release: () => {},
  };
  return {
    query: async () => ({ rows: [], rowCount: 0 }),
    connect: async () => mockClient,
    end: async () => {},
    on: () => {},
  } as unknown as pg.Pool;
}

let activePool: pg.Pool;
let activeDb: NodePgDatabase<typeof schema>;

if (connectionString) {
  try {
    const maskedUrl = connectionString.replace(/:\/\/.*@/, "://****:****@");
    console.log(`[db] Connecting to database: ${maskedUrl}`);
    const realPool = new Pool({
      connectionString,
      connectionTimeoutMillis: 2500,
      ssl: connectionString.includes("127.0.0.1") || connectionString.includes("localhost")
        ? false
        : { rejectUnauthorized: false },
    });
    realPool.on("error", (err) => {
      console.warn("[db] Unexpected database pool error:", err.message);
    });
    activePool = realPool;
    activeDb = drizzle(realPool, { schema });
  } catch (err) {
    console.warn("[db] Failed to initialize Postgres pool — using in-memory mock:", err);
    hasDatabaseConfig = false;
    activePool = createMockPool();
    activeDb = createMockDb();
  }
} else {
  console.warn("[db] DATABASE_URL not configured — running with in-memory database mock");
  activePool = createMockPool();
  activeDb = createMockDb();
}

export async function verifyDatabaseConnection(): Promise<boolean> {
  if (!hasDatabaseConfig) return false;
  try {
    await activePool.query("SELECT 1");
    return true;
  } catch (err: any) {
    console.warn(
      `[db] Database unreachable (${err?.code || err?.message || "connection error"}) — falling back to in-memory database mock`,
    );
    const oldPool = activePool;
    hasDatabaseConfig = false;
    activePool = createMockPool();
    activeDb = createMockDb();
    oldPool.end().catch(() => {});
    return false;
  }
}

const pool = new Proxy({} as pg.Pool, {
  get(_target, prop) {
    const value = (activePool as any)[prop];
    return typeof value === "function" ? value.bind(activePool) : value;
  },
});

const db = new Proxy((() => {}) as unknown as NodePgDatabase<typeof schema>, {
  get(_target, prop) {
    const value = (activeDb as any)[prop];
    return typeof value === "function" ? value.bind(activeDb) : value;
  },
  apply(_target, thisArg, argArray) {
    return (activeDb as any).apply(thisArg, argArray);
  },
});

export { pool, db };
