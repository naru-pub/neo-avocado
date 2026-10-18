// A stand-in for Naru running neo-avocado's queries and mutations: a real
// SQLite database (node:sqlite) with the site's migrations applied, and the
// ctx Naru hands each call, so tests run the same SQL Naru runs.
//
//   const site = await testSite();
//   await site.mutate("community/posts:write", args, { member: "m-1" });
//   await site.query("community/posts:page", args); // a visitor
//   await site.route("/logs/free/12"); // what Naru answers that path with
//
// What it shares with Naru: SQLite and its dialect; ctx.sql's tag and
// (text, values) forms, booleans bound as 1 and 0, { rows, changes };
// queries only read; a mutation is one transaction, kept only if it
// returns; ctx.fail's coded error; roles; guest passwords (hashed here as a
// plain marker, not a real hash); a statement's limits (100 bound values,
// 1,000 rows). What it does not: Naru's checks on names, a call's limits,
// and the 3-second statement time.
import { DatabaseSync } from "node:sqlite";
import { readdir, readFile } from "node:fs/promises";
import { join, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const dist = fileURLToPath(new URL("../dist/_naru/", import.meta.url));

/** What ctx.fail throws, as the SDK hands it to pages: status, code, details. */
export class NaruFail extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "NaruFail";
    this.code = code;
    this.details = details;
    this.status =
      {
        CONFLICT: 409,
        QUOTA_EXCEEDED: 409,
        AUTH_REQUIRED: 401,
        ACCESS_DENIED: 403,
        NOT_FOUND: 404,
        RATE_LIMITED: 429,
        UNAVAILABLE: 503,
      }[code] ?? 400;
  }
}

// A write, perhaps after a WITH: what a query may not run.
const WRITES =
  /^\s*(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER)\b|^\s*WITH\b[\s\S]*\)\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i;
const bind = (value) =>
  typeof value === "boolean" ? (value ? 1 : 0) : (value ?? null);

/** The site's migrations' file names in dist/, in the order Naru applies them. */
async function migrationNames() {
  return (await readdir(join(dist, "migrations")).catch(() => []))
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

/** The site's migrations in dist/, in the order Naru applies them. */
export async function migrations() {
  return await Promise.all(
    (await migrationNames()).map((name) =>
      readFile(join(dist, "migrations", name), "utf8"),
    ),
  );
}

/** An empty database with `sql` (the migrations' text) applied. */
export function database(sql) {
  const db = new DatabaseSync(":memory:");
  for (const text of sql) db.exec(text);
  return db;
}

/**
 * ctx.sql over `db`, as Naru's: a tag or (text, values), booleans bound as 1
 * and 0, { rows, changes }; a query's (`kind` "query") only reads.
 */
export function sqlOf(db, kind = "mutation") {
  return (text, ...values) => {
    let statement, bound;
    if (Array.isArray(text) && Object.hasOwn(text, "raw")) {
      statement = text.join("?");
      bound = values;
    } else {
      statement = String(text);
      bound = values[0] ?? [];
    }
    const writes = WRITES.test(statement);
    if (kind === "query" && writes)
      return Promise.reject(
        new Error("Invalid SQL: a read-only query cannot write."),
      );
    if (bound.length > 100)
      return Promise.reject(
        new Error("Invalid SQL: at most 100 values are bound."),
      );
    try {
      const prepared = db.prepare(statement);
      const params = bound.map(bind);
      if (!writes || /\bRETURNING\b/i.test(statement)) {
        const rows = prepared.all(...params).map((row) => ({ ...row }));
        if (rows.length > 1000)
          throw new Error(
            "ctx.sql returns at most 1000 rows and 1 MiB; add a LIMIT.",
          );
        return Promise.resolve({
          rows,
          changes: writes
            ? Number(db.prepare("SELECT changes() AS n").get().n)
            : 0,
        });
      }
      const { changes } = prepared.run(...params);
      return Promise.resolve({ rows: [], changes: Number(changes) });
    } catch (error) {
      return Promise.reject(error);
    }
  };
}

/** The site's routes in dist/: routes/posts/_id.js is "posts/_id". */
export async function routes() {
  const root = join(dist, "routes");
  const entries = await readdir(root, { recursive: true }).catch(() => []);
  return entries
    .filter((name) => name.endsWith(".js"))
    .map((name) => name.split(sep).join("/").replace(/\.js$/, ""))
    .sort();
}

/**
 * The route answering `pathname`, as Naru matches them (control-plane's
 * site-functions/routes.ts): segments that start with _ take any one
 * segment, fixed segments win, and a directory's index answers it.
 */
export function matchRoute(names, pathname) {
  let segments;
  try {
    segments = pathname
      .split("/")
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment));
  } catch {
    return null;
  }
  const candidates = pathname.endsWith("/")
    ? [[...segments, "index"]]
    : [segments, [...segments, "index"]];
  let best = null;
  for (const wanted of candidates)
    for (const route of names) {
      const pattern = route.split("/");
      if (pattern.length !== wanted.length) continue;
      const params = {};
      let score = "";
      const matches = pattern.every((part, index) => {
        if (part === wanted[index]) {
          score += "1";
          return true;
        }
        if (
          part.startsWith("_") &&
          part.length > 1 &&
          wanted[index] !== "index"
        ) {
          params[part.slice(1)] = wanted[index];
          score += "0";
          return true;
        }
        return false;
      });
      if (matches && (!best || score > best.score))
        best = { route, params, score };
    }
  return best && { route: best.route, params: best.params };
}

/**
 * A fresh site: an empty database with every migration in dist/ applied,
 * but the last `pending` of them (a count, or the name a migration's file
 * starts with: that one and those after), which `site.migrate()` applies
 * (to test a migration on rows written before it).
 */
export async function testSite({
  now = Date.parse("2026-10-16T03:00:00Z"),
  pending = 0,
} = {}) {
  const sql = await migrations();
  if (typeof pending === "string") {
    const names = await migrationNames();
    const first = names.findIndex((name) => name.startsWith(pending));
    if (first < 0) throw new Error(`No migration ${pending}.`);
    pending = names.length - first;
  }
  const db = database(sql.slice(0, sql.length - pending));
  const roles = new Map();
  const site = {
    db,
    now,
    /** Applies the migrations held back, in order. */
    migrate() {
      for (const text of sql.slice(sql.length - pending)) db.exec(text);
      pending = 0;
    },
    /** Rows of `text` with `values`, straight from the database (for asserts). */
    rows: (text, ...values) =>
      db
        .prepare(text)
        .all(...values.map(bind))
        .map((row) => ({ ...row })),
    /** Runs a statement directly, as a test's setup. */
    run: (text, ...values) => db.prepare(text).run(...values.map(bind)),
    setRoles(member, list) {
      roles.set(member, [...new Set(list)].sort());
    },
    /** A member's roles, as Naru keeps them. */
    roles: (member) => [...(roles.get(member) ?? [])],
    query: (name, args = null, who = {}) => call("query", name, args, who),
    mutate: (name, args = null, who = {}) => call("mutation", name, args, who),
    /**
     * What Naru answers `path` with: the route matching it run as a
     * visitor's query (null when none does, and the path is a file's).
     */
    async route(path, query = {}, origin) {
      const match = matchRoute(await routes(), path);
      if (!match) return null;
      const url = pathToFileURL(join(dist, "routes", `${match.route}.js`)).href;
      const render = (await import(url)).default;
      const input = JSON.parse(
        JSON.stringify({ path, origin, params: match.params, query }),
      );
      return JSON.parse(
        JSON.stringify((await render(context("query", {}), input)) ?? null),
      );
    },
  };

  /** `ctx` for one call; `who` is { member } or { owner: true }, else a visitor. */
  function context(kind, { member = null, owner = false } = {}) {
    const sql = sqlOf(db, kind);
    const passwords = {
      verify: async (password, hash) => hash === `hash:${password}`,
      ...(kind === "mutation"
        ? { hash: async (password) => `hash:${password}` }
        : {}),
    };
    return Object.freeze({
      member:
        member === null
          ? null
          : Object.freeze({
              id: member,
              roles: Object.freeze(roles.get(member) ?? []),
            }),
      owner: member === null && owner === true,
      visitor: member === null && owner !== true,
      now: site.now,
      fail(code, message, details) {
        throw new NaruFail(code, message, details);
      },
      sql,
      async rolesOf(ids) {
        return Object.fromEntries(ids.map((id) => [id, roles.get(id) ?? []]));
      },
      passwords,
      ...(kind === "mutation"
        ? {
            async setRoles(memberId, list) {
              site.setRoles(memberId, list);
              return null;
            },
          }
        : {}),
    });
  }

  async function call(kind, reference, args, who) {
    const [module, name] = reference.split(":");
    const folder = kind === "query" ? "queries" : "mutations";
    const url = pathToFileURL(join(dist, folder, `${module}.js`)).href;
    const fn = (await import(url))[name];
    if (typeof fn !== "function")
      throw new NaruFail("NOT_FOUND", `No ${kind} ${reference}.`);
    // JSON both ways, as across Naru's boundary.
    const input = JSON.parse(JSON.stringify(args ?? null));
    if (kind === "query")
      return JSON.parse(
        JSON.stringify((await fn(context(kind, who), input)) ?? null),
      );
    const saved = new Map(roles);
    db.exec("BEGIN");
    try {
      const result = await fn(context(kind, who), input);
      db.exec("COMMIT");
      return JSON.parse(JSON.stringify(result ?? null));
    } catch (error) {
      db.exec("ROLLBACK");
      roles.clear();
      for (const [key, value] of saved) roles.set(key, value);
      throw error;
    }
  }
  return site;
}
