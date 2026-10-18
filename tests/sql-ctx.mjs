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
// returns; ctx.fail's coded error; ctx.notify (site.notifications, kept
// only if the mutation returns); roles, and Naru's views of them and of
// uploads (_naru_member_roles, _naru_uploads; tables here, which a test
// fills with site.setRoles and site.upload); ctx.media.types; guest
// passwords (hashed here as a plain marker, not a real hash); a
// statement's limits (100 bound values, 1,000 rows). What it does not: Naru's checks on names, a call's limits,
// and the 3-second statement time.
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

/** What Naru Media stores (Naru's ctx.media.types). */
export const MEDIA_TYPES = Object.freeze([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "audio/mpeg",
  "audio/ogg",
  "audio/opus",
  "audio/wav",
  "application/pdf",
  "application/zip",
  "text/plain",
]);

/** Naru's views site SQL reads, kept here as plain tables. */
const NARU_VIEWS = `
  CREATE TABLE _naru_member_roles (member TEXT NOT NULL, role TEXT NOT NULL,
    PRIMARY KEY (member, role));
  CREATE TABLE _naru_uploads (id TEXT PRIMARY KEY, url TEXT NOT NULL UNIQUE,
    member TEXT, name TEXT NOT NULL, type TEXT NOT NULL, size INTEGER NOT NULL,
    created_at INTEGER NOT NULL);`;

/** An empty database with `sql` (the migrations' text) applied. */
export function database(sql) {
  const db = new DatabaseSync(":memory:");
  db.exec(NARU_VIEWS);
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

/** The site's _naru/routes.json in dist/, or none. */
export async function routeRules() {
  try {
    const { include = [], exclude = [] } = JSON.parse(
      await readFile(join(dist, "routes.json"), "utf8"),
    );
    return { include, exclude };
  } catch {
    return { include: [], exclude: [] };
  }
}

/** Whether `rule` takes `pathname`: `*` is anything, slashes too. */
function takes(rule, pathname) {
  const pattern = rule
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${pattern}$`, "s").test(pathname);
}

/**
 * Whether Naru runs routes.js for `pathname`, as it reads routes.json
 * (control-plane's site-functions/routes.ts, Cloudflare's _routes.json):
 * included, and not excluded.
 */
export function routed(rules, pathname) {
  return (
    !rules.exclude.some((rule) => takes(rule, pathname)) &&
    rules.include.some((rule) => takes(rule, pathname))
  );
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
  const rolesOf = (member) =>
    db
      .prepare(
        "SELECT role FROM _naru_member_roles WHERE member = ? ORDER BY role",
      )
      .all(member)
      .map((row) => row.role);
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
      db.prepare("DELETE FROM _naru_member_roles WHERE member = ?").run(member);
      for (const role of new Set(list))
        db.prepare("INSERT INTO _naru_member_roles VALUES (?, ?)").run(
          member,
          role,
        );
    },
    /** A member's roles, as Naru keeps them. */
    roles: rolesOf,
    /**
     * What mutations sent with ctx.notify, kept as Naru keeps its outbox:
     * only from a mutation that returned. { members, title, body, path }.
     */
    notifications: [],
    /**
     * Records an upload as Naru Media does once it is finished (member null:
     * the owner's), and answers its address.
     */
    upload({
      member = null,
      name = "file.pdf",
      type = "application/pdf",
      size = 1024,
    } = {}) {
      const id = `upload-${db.prepare("SELECT count(*) AS n FROM _naru_uploads").get().n + 1}`;
      const url = `https://media.naru.pub/test/${id}/${encodeURIComponent(name)}`;
      db.prepare("INSERT INTO _naru_uploads VALUES (?, ?, ?, ?, ?, ?, ?)").run(
        id,
        url,
        member,
        name,
        type,
        size,
        site.now,
      );
      return url;
    },
    query: (name, args = null, who = {}) => call("query", name, args, who),
    mutate: (name, args = null, who = {}) => call("mutation", name, args, who),
    /**
     * What Naru answers `path` with: routes.js run as a visitor's query,
     * where routes.json routes the path (null where not: it is a file's).
     */
    async route(path, query = {}, origin) {
      if (!routed(await routeRules(), path)) return null;
      const url = pathToFileURL(join(dist, "routes.js")).href;
      const render = (await import(url)).default;
      const input = JSON.parse(JSON.stringify({ path, origin, query }));
      return JSON.parse(
        JSON.stringify((await render(context("query", {}), input)) ?? null),
      );
    },
  };

  /** `ctx` for one call; `who` is { member } or { owner: true }, else a visitor. */
  function context(kind, { member = null, owner = false } = {}, outbox = []) {
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
              roles: Object.freeze(rolesOf(member)),
            }),
      owner: member === null && owner === true,
      visitor: member === null && owner !== true,
      now: site.now,
      fail(code, message, details) {
        throw new NaruFail(code, message, details);
      },
      sql,
      async rolesOf(ids) {
        return Object.fromEntries(ids.map((id) => [id, rolesOf(id)]));
      },
      media: Object.freeze({ types: MEDIA_TYPES }),
      passwords,
      ...(kind === "mutation"
        ? {
            async setRoles(memberId, list) {
              site.setRoles(memberId, list);
              return null;
            },
            async notify(members, { title, body = "", path = "/", ...rest }) {
              if (
                Object.keys(rest).length ||
                !title?.trim() ||
                title.length > 100 ||
                body.length > 500 ||
                !path.startsWith("/") ||
                path.startsWith("//")
              )
                throw new Error("ctx.notify: invalid message.");
              outbox.push({
                members: [...new Set(members)],
                title,
                body,
                path,
              });
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
    db.exec("BEGIN");
    try {
      const outbox = [];
      const result = await fn(context(kind, who, outbox), input);
      db.exec("COMMIT");
      site.notifications.push(...outbox);
      return JSON.parse(JSON.stringify(result ?? null));
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  return site;
}
