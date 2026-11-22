import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

const connectionString = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;
export const hasDatabaseConfig = Boolean(connectionString);

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

let pool: pg.Pool;
let db: NodePgDatabase<typeof schema>;

if (connectionString) {
  try {
    const maskedUrl = connectionString.replace(/:\/\/.*@/, "://****:****@");
    console.log(`[db] Connecting to database: ${maskedUrl}`);
    pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
    });
    db = drizzle(pool, { schema });
  } catch (err) {
    console.warn("[db] Failed to initialize Postgres pool — using in-memory mock:", err);
    pool = createMockPool();
    db = createMockDb();
  }
} else {
  console.warn("[db] DATABASE_URL not configured — running with in-memory database mock");
  pool = createMockPool();
  db = createMockDb();
}

export { pool, db };
