// A stand-in for Naru running neo-avocado's queries and mutations: a real
// SQLite database (node:sqlite) with the site's migrations applied, and the
// ctx Naru hands each call, so tests run the same SQL Naru runs.
//
//   const site = await testSite();
//   await site.mutate("community/posts:write", args, { member: "m-1" });
//   await site.query("community/posts:page", args); // a visitor
//
// What it shares with Naru: SQLite and its dialect; ctx.sql's tag and
// (text, values) forms, booleans bound as 1 and 0, { rows, changes };
// queries only read; a mutation is one transaction, kept only if it
// returns; ctx.fail's coded error; roles; guest passwords (hashed here as a
// plain marker, not a real hash). What it does not: Naru's checks on names
// and query plans, and its limits.
import { DatabaseSync } from "node:sqlite";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
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

/** A fresh site: an empty database with every migration in dist/ applied. */
export async function testSite({
  now = Date.parse("2026-10-16T03:00:00Z"),
} = {}) {
  const db = new DatabaseSync(":memory:");
  const names = (await readdir(join(dist, "migrations")).catch(() => []))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const name of names)
    db.exec(await readFile(join(dist, "migrations", name), "utf8"));
  const roles = new Map();
  const site = {
    db,
    now,
    /** Rows of `text` with `values`, straight from the database (for asserts). */
    rows: (text, ...values) => db.prepare(text).all(...values.map(bind)),
    /** Runs a statement directly, as a test's setup. */
    run: (text, ...values) => db.prepare(text).run(...values.map(bind)),
    setRoles(member, list) {
      roles.set(member, [...new Set(list)].sort());
    },
    query: (name, args = null, who = {}) => call("query", name, args, who),
    mutate: (name, args = null, who = {}) => call("mutation", name, args, who),
  };

  /** `ctx` for one call; `who` is { member } or { owner: true }, else a visitor. */
  function context(kind, { member = null, owner = false } = {}) {
    const sql = (text, ...values) => {
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
        throw new Error("Invalid SQL: a read-only query cannot write.");
      const prepared = db.prepare(statement);
      const params = bound.map(bind);
      if (!writes || /\bRETURNING\b/i.test(statement)) {
        const rows = prepared.all(...params);
        return Promise.resolve({
          rows,
          changes: writes
            ? Number(db.prepare("SELECT changes() AS n").get().n)
            : 0,
        });
      }
      const { changes } = prepared.run(...params);
      return Promise.resolve({ rows: [], changes: Number(changes) });
    };
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
