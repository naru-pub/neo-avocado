# How neo-avocado is built

neo-avocado is AvocadoEdition on Naru SDK 1.1.0: static pages, and site
code Naru runs against the site's own SQLite tables. What was ported and
what was not is [porting.md](porting.md).

## Layout

| Path                      | What it is                                                                          |
| ------------------------- | ----------------------------------------------------------------------------------- |
| `site/`                   | What Naru publishes; `npm run build` compiles it into `dist/`, the TypeScript as JS |
| `site/index.html`         | The community's one page; `site/app/` draws it (`main.ts`, one module per area)     |
| `site/admin/`             | The owner's admin page (`main.ts`), one module per area, and its menu (`forms.ts`)  |
| `site/shared/`            | What both pages use: the site's address (`config.ts`), HTML and emoticon rendering  |
| `site/styles/`, `vendor/` | The styles (base, 디자인 사용 off, 디자인) and vendored libraries (DOMPurify)       |
| `site/_naru/`             | The site's code on Naru (below)                                                     |
| `types/`                  | Naru's own type declarations, copied by `npm run sync:naru`                         |
| `tests/`, `scripts/`      | Tests and the build, deploy and sync scripts                                        |

The build publishes `site/` alone, with `LICENSE` as `LICENSE.txt`; this
file, the README and the tests stay in the repository.

## The site's code (`site/_naru/`)

- `migrations/0001_schema.sql` makes the tables (below).
- `queries/<area>/<module>.ts` export read-only functions and
  `mutations/<area>/<module>.ts` writing ones, `export async function
name(ctx, args)`, by area: community, characters, economy, content and
  admin. Pages call them as `query("<area>/<module>:<name>", args)` and
  `mutate(...)` (`site/app/core.ts`), and keep an answer current with
  `subscribe(...)`. `tests/function-modules.test.mjs` checks every reference
  names an export and every export is called.
- `modules/` is what they share, imported relatively with `.js`:
  `access.ts` (who may do what, the owner's settings, `invalid()`),
  `boards.ts`, `characters.ts`, `economy.ts`, `mail.ts`, `members.ts`
  (each area's rows), `admin.ts` and `admin-model.ts` with `admin-models/`
  (the owner's admin, below), `places.ts` and `previews.ts` (addresses).
  Nothing is bundled.
- `routes.json` lists the addresses Naru answers before the page loads, in
  Cloudflare Pages' `_routes.json` form (`/logs` and `/logs/*` for a
  section), and `routes.ts` answers each as a visitor's query: index.html
  with that page's link preview (`modules/previews.ts`), or a board's RSS
  feed. What an address names is `modules/places.ts`, which the page's
  router reads too. A listed address that names nothing is 404, as is one
  neither listed nor a file.

**Anyone may call any query or mutation**, visitors included, so each
decides from `ctx.member` (`{ id }` or null), `ctx.owner` and
`ctx.visitor` what the caller may read and do (`modules/access.ts`,
`boards.ts`). Roles are the site's own `member_roles (member, role)`:
moderators have `staff`, members-only board groups' members `group-<id>`;
a member's level 1–10 is the site's own `members` row.

**The owner's admin** (`site/admin/`) calls each section's `list`, `get`,
`save` and `remove` where it has them: `admin/records:<call>` with
`{ section }` for those `modules/admin-calls.ts` lists as plain, which the
shared code in `modules/admin.ts` does, and `admin/<section>:<call>` for
what a section does itself (`admin/members`, `admin/boards:save`,
`admin/history`, …). Every one is made by `ownerOnly(fn)`, which refuses
anyone but the owner before `fn` runs; so are the owner's calls outside
admin/ (`economy/grants:grant`, `characters/review:reviewCharacter`,
`characters/sheet:move`). A save takes the form's values and checks them
with `buildRecord` (`modules/admin-model.ts`): each section's fields and its
own rules (`check`) are in `modules/admin-models/<area>.ts`, grouped as the
admin menu groups them, and the page draws its forms from the same models.
Values left out keep the record's own. Writes that go together are one
mutation: a balance and its history entry, a character's record and its
experience history, a title given to many characters.

## What Naru gives the site's code

Its types are `types/naru-functions.d.ts` (Naru's `functions.d.ts`),
re-exported by `modules/naru-types.ts`; the pages' client is typed by
`types/naru.d.ts`, which `tsconfig.json` maps the SDK's address to.

- `ctx.sql` runs one statement: ``ctx.sql`SELECT ... WHERE id = ${id}` ``
  (values are bound, never spliced) or `ctx.sql(text, values)`, answering
  `{ rows, changes }`. Booleans bind as 1 and 0. A query only reads.
  Refused: PRAGMA, ATTACH, triggers, transactions, `WITH RECURSIVE`, and
  Naru's own tables, but for its view
  `_naru_uploads (id, url, member, name, type, size, created_at)`, which
  statements read and join.
- Limits: a statement binds at most 100 values and returns at most 1,000
  rows and 1 MiB, and is stopped after 3 seconds; a call reads at most
  500,000 rows. A mutation is one transaction: a throw, `ctx.fail` or a
  limit keeps nothing.
- `ctx.fail(code, message, details?)` refuses with a coded error the page
  receives (`AUTH_REQUIRED`, `ACCESS_DENIED`, `NOT_FOUND`, `CONFLICT`,
  `INVALID_REQUEST`, `RATE_LIMITED`, …); messages are Korean, for visitors,
  and `details.reason` is what tests and pages check.
- `ctx.media.types` is what Naru Media stores; a post's new 첨부파일 must be
  the writer's own upload in `_naru_uploads`, whose name, size and type it
  keeps.
- Guests: `ctx.passwords.hash(password)` in mutations, and
  `ctx.passwords.verify(password, hash, key)`, ten wrong tries an hour per
  key (`post:<id>`, `comment:<id>`).
- Nothing is pushed: pages subscribe to a query (`community/inbox:status`
  for unread 쪽지 and calls, `community/posts:latest`), and Naru answers it
  again when a mutation writes a table it read.

## Tables

- The schema is one migration, `0001_schema.sql`, squashed before the first
  release. Applied migrations are never edited: a change is a new file
  after it. Before a site's first release, the owner can empty its
  database to apply a changed one (Naru's 데이터베이스 → 복원 지점 →
  데이터베이스 초기화, after uploading it).
- Names: snake_case, never one of Naru's names. Rows pages or other rows
  name by number are `INTEGER PRIMARY KEY AUTOINCREMENT`, so a deleted
  one's number is never given again; the owner's records are keyed by the
  IDs the owner gives them; a row per member is `member TEXT PRIMARY KEY`.
- Times are INTEGER milliseconds (`ctx.now`); Korean days are `YYYY-MM-DD`
  strings (`kstDay`); flags are INTEGER 0/1. CHECKs hold what code checks
  too: levels, amounts, flags, days, JSON.
- What no query filters on goes in a TEXT column of JSON, parsed in code;
  anything filtered, joined, sorted or counted is a column with an index
  that serves the statement (every list's order has one).
- Arrays people search or join are tables of their own (post tags,
  favorites, character titles, recipe ingredients).
- Text search uses `posts_search` and `comments_search`
  (`fts5(…, tokenize = 'trigram')`, by the row's id as rowid). Naru has no
  triggers, so every mutation writing a post's or comment's text keeps its
  row in step (`savePostSearch`, `saveCommentSearch`, and the deletes).
  trigram finds terms of 3 characters or more; shorter ones use LIKE,
  bounded by the board.
- Counts and aggregates are computed in SQL, not kept by hand, but for
  the counters pages show often (조회수, link and download counts).

## Code

- Keep AvocadoEdition's behaviour, and the comments that name the PHP file a
  rule comes from.
- One query per page view where a page would chain several reads; loops
  that called again until done are one call.
- Shared code is written once: the owner's names (`modules/names.ts`, for
  the site's code and its pages), a reply's place (`replyPlace`), 소속·종족
  restrictions (`requireSideAndClass`).

## Tests

- `npm run typecheck`, `npm test` and `npm run lint` pass before each
  commit. `npm test` builds, then tests `dist/`.
- The site's code is tested with `tests/sql-ctx.mjs`: `await testSite()`
  gives a database with the schema applied; `site.query(name, args, who)`
  and `site.mutate(...)` call the built code (`who` is `{ member: "m-1" }`,
  `{ owner: true }`, or nothing for a visitor); `site.run`/`site.rows` set
  up and inspect tables; `site.setRoles(member, roles)`,
  `site.upload({ member, … })`; `site.route(path)` answers a path as Naru
  would. `tests/helpers.mjs` has what the suites share (refusals, rows made
  directly, admin calls routed as the page routes them).
- `tests/neo-avocado.test.mjs` runs the page in JSDOM against a synthetic
  SDK.
- The end-to-end suite runs the built site on naru-dev in Chromium:
  `NARU_REPO_PATH=<naru-pub> PLAYWRIGHT_MODULE=<playwright's index.mjs> npm run test:e2e`.
  Run it alone: a build during it changes the files naru-dev serves.
