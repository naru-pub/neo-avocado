# Porting neo-avocado to Naru's new SDK 1.1.0

neo-avocado moves from collections, collection rules and site functions to
SQL tables, queries and mutations. The plan, with the decisions taken, is
https://claude.ai/code/artifact/c466ffa0-cfc4-495a-af07-28f4aafbe9f7. This
file is how the code is written. The work happens on the `new-sdk` branch and
is deployed once, at the cutover; nothing here is pushed to `main` before.

Decisions: production data starts fresh (nothing is moved); AvocadoEdition's
member level 1–10 stays a number in neo-avocado's own `members` table; staff
(moderators) and members-only groups are Naru roles (`staff`,
`group-<name>`). Pages have path URLs (`/logs/free/12`), each served by a
route in `_naru/routes/` with its link preview; old `#/` URLs are not
redirected.

## What Naru gives queries and mutations

The types are `_naru/modules/naru-functions.d.ts` (Naru's own
`functions.d.ts`), re-exported by `naru-types.ts` as `QueryCtx` and
`MutationCtx`.

- `_naru/queries/<area>/<module>.ts` exports read-only functions,
  `_naru/mutations/<area>/<module>.ts` writing ones: `export async function
name(ctx, args)`. Pages call them as `query("<area>/<module>:<name>", args)`
  and `mutate(...)` (app/core.ts), and keep an answer current with
  `subscribe(...)`. Shared code lives in `_naru/modules/` (relative imports
  with `.js`).
- **Anyone may call any of them**, visitors included. The code decides:
  `ctx.member` (`{ id, roles }` or null), `ctx.owner`, `ctx.visitor`. Every
  check a collection rule made now sits in `_naru/modules/access.ts`, called
  by the code that needs it.
- `ctx.sql` runs ONE statement: ``ctx.sql`SELECT ... WHERE id = ${id}` ``
  (values are bound, never spliced) or `ctx.sql(text, values)`. It answers
  `{ rows, changes }`. Booleans bind as 1 and 0.
- Allowed: SELECT, INSERT (… RETURNING), UPDATE, DELETE, and WITH before
  them; a query only reads. Refused: PRAGMA, ATTACH, triggers, transactions,
  `WITH RECURSIVE`, and Naru's own table names (`meta`, `collections`,
  `documents`, `media_refs`, `rate_limits`, `usage`, anything `_naru*`,
  `sqlite_*`).
- Speed: Naru no longer checks a statement's plan (it stops any statement
  step after 3 seconds, and pauses one stopped 3 times a minute), but the
  advice still holds: read one table in full at most, reach every other by
  equality on an indexed column or key, and avoid `a.x > b.y` joins.
- Limits: a statement returns at most 1,000 rows and 1 MiB; a call makes at
  most 100 statements and reads at most 500,000 rows; a query answers up to
  1 MiB. There is no per-write budget any more: a mutation is one
  transaction, and a throw, `ctx.fail` or a limit keeps nothing.
- `ctx.fail(code, message, details?)` refuses with a coded error the page
  receives (`AUTH_REQUIRED`, `ACCESS_DENIED`, `NOT_FOUND`, `CONFLICT`,
  `INVALID_REQUEST`, `RATE_LIMITED`, …). Messages are Korean, written for
  visitors.
- `ctx.rolesOf([ids])`, and in mutations `ctx.setRoles(member, roles)`.
- Guests: `ctx.passwords.hash(password)` in mutations keeps a hash in a
  column; `ctx.passwords.verify(password, hash, key)` checks it, ten wrong
  tries an hour per key (use `post:<id>`, `comment:<id>`).
- There is no `notify`/`broadcast`: pages subscribe to a query, and Naru
  re-runs it when a mutation writes a table it read.
- Uploads are unchanged (`media.upload`); store the URL in a TEXT column.
- `_naru/routes/<path>.ts` answers that path (a segment `_name` is a
  parameter, `index` the directory): its default export runs as a
  visitor's query and answers `{ file: "index.html", head, cache }`.
  `modules/previews.ts` makes every route: the page's preview tags, from
  what a visitor may read, by the same checks the queries make. Paths no
  route answers are files, else 404.

## Tables

- Migrations are `_naru/migrations/NNNN_<area>.sql`, applied in name order:
  0001 foundation, 0002 boards, 0003 characters, 0004 economy, 0005 mail,
  0006 search, 0007 board admins, 0008 post links (and pictures), 0009
  member blocks, 0010 recommenders, 0011 item details, 0012 stat order, 0013 secret comments, 0014 reply
  posts, 0015 post hits.
  Applied migrations
  are never edited; a change is a new one. 0001–0005 started fresh,
  writing each area's tables once; 0006 fills its tables from the rows
  already there; 0007–0014 add columns
  and 0015 a table (0011 files the personal items
  already made).
- Names: snake_case, no prefix, never one of Naru's names above.
- Keys: `id INTEGER PRIMARY KEY` for rows the site makes; a member's id is
  TEXT; a row kept per member uses `member TEXT PRIMARY KEY`.
- Times are INTEGER milliseconds (`ctx.now`); KST days stay `YYYY-MM-DD`
  strings (`kstDay`). Booleans are INTEGER 0/1 with `NOT NULL DEFAULT 0`.
- Settings no query filters on go in one TEXT column of JSON
  (`options TEXT NOT NULL DEFAULT '{}'`), parsed in code; anything filtered,
  joined, sorted or counted is a column with an index.
- Arrays people search or join become their own table (post tags,
  favorites, character titles, recipe ingredients).
- Text search uses full-text tables, keyed by the row's id as rowid:
  `posts_search` and `comments_search`, each
  `USING fts5(…, tokenize = 'trigram')`. Naru has no triggers, so every
  mutation writing a post's title or text, or a comment's, keeps its row in
  step in the same call (`savePostSearch`, `saveCommentSearch`, and the
  deletes). trigram finds terms of 3 characters or more (MATCH with the
  term as one quoted phrase); shorter ones use LIKE on the base table,
  bounded by the board. A full-text table is read whole only as a
  statement's first table; elsewhere by MATCH, LIKE or rowid.
- Counters and aggregates are computed with SQL (`count(*)`, `GROUP BY`,
  `max(number) + 1`), not kept by hand.

## Code

- Keep AvocadoEdition's behaviour exactly; the existing tests say what it is.
  Keep the comments that name the PHP file a rule comes from.
- One query per page view where a page used to chain several reads.
- Loops that called again until `done` become one call.
- Nothing of the old design is left: no `_naru/functions/`, rules or
  `_naru/collections.json`, and pages use no `collection()`, `call()` or
  `batch()`; `tests/admin-model.test.mjs` checks no page or server code
  names a collection.
- The owner's admin (`admin/`) is `_naru/queries/admin/<section>` and
  `_naru/mutations/admin/<section>`: `list`, `get`, `save` and `remove`
  where the section has them, each made by `ownerOnly(fn)`
  (`modules/access.ts`), which refuses anyone but the owner before `fn`
  runs; so are the owner's calls outside admin/ (`economy/grants:grant`,
  `characters/review:reviewCharacter`, `characters/sheet:move`).
  `tests/admin.test.mjs` checks every export's mark and calls each as a
  member, a moderator and a visitor. `save` takes
  the form's values and checks them with `buildRecord`
  (`_naru/modules/admin-model.ts`), the forms' own rules; values left out
  keep the record's. Writes that go together are one mutation.

## Tests

- Server code is tested with `tests/sql-ctx.mjs` (one suite per area, and
  `tests/admin.test.mjs` for the owner's): `await testSite()` gives a
  database with every migration applied; `site.query(name, args, who)` and
  `site.mutate(...)` call the built code (`who` is `{ member: "m-1" }`,
  `{ owner: true }`, or nothing for a visitor); `site.run`/`site.rows` set
  up and inspect tables; `site.setRoles(member, roles)`; `site.route(path)`
  answers a path as Naru would, matching it to a route
  (`tests/routes.test.mjs`).
- Page tests (JSDOM, `tests/neo-avocado.test.mjs`) fake `query`, `mutate` and
  `subscribe` in the synthetic SDK.
- `npm run typecheck`, `npm test` and `npm run lint` pass before each commit.
  The end-to-end suite runs on naru-dev:
  `NARU_REPO_PATH=<naru-pub> PLAYWRIGHT_MODULE=<playwright index.mjs> LC_ALL=en_US.UTF-8 E2E_PORT=4310 npm run test:e2e`.
