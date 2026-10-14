# What Naru SDK 1.1.0 could improve, from finishing the port

> **Update 2026-10-15:** items 1–4 and 7 are now in SDK 1.1.0 (rule
> `present`/`queryable`, document secrets for visitors and functions,
> managed uploads, `has`, and the naru-dev emulator), and the port uses them;
> see port-status.md, "SDK 1.1.0 features adopted". Items 5, 6 and 8 remain.

Written 2026-10-14, after the last rows of the port (guests, board numbers and
tags, HTML posts, combination, image fields, menus/design) were
built on SDK 1.1.0 as it stands. Every item below is something the port had
to work around; the workaround is named so it can be deleted when the SDK
grows the feature. Ordered by how much app code or risk each would remove.

## 1. Rules that filter rows but cannot hide fields

Collection rules decide _which_ documents a member reads, not _what_ of them.
So anything with a private part goes back behind a function:

- Guest password hashes live in their own admin collection
  (`neo_avocado_guest_keys`) because members read posts natively and would
  receive a hash stored on the post.
- Characters' owner/admin-only custom fields keep the whole characters
  collection behind the `communityRead` gate, with its whitelist, per-kind
  page limits and a client shim (`communityCollection` in `app.js`) that
  imitates the SDK.
- Locked secret posts are redacted by the gate for visitors.

**Suggestion:** let a rule return a projection, e.g. `export function
present(ctx, doc)` returning the document visible to that caller (or a list
of fields to drop). Most of `communityData`'s read path and the client shim
would go, and reads would get native caching and the 64 KiB-free page size.

## 2. Visitor writes and function results

Rules run for visitors on world-readable collections, so public boards read
natively. Writing is another matter: rules' `canWrite` cannot hash or check a
guest password, so every guest write is a function call, and a visitor's
list through a function is uncached and capped at 64 KiB a result.

**Suggestion:** let `canWrite` see `ctx.visitor` and `ctx.password.verify`
(read-only, like the rest of the rule sandbox), so guest edits could be
native writes checked against a hash in a separate collection.

## 3. Media references are the app's job

`media_assets` (a ledger with `refs`), `registerMedia` after each upload, a
ten-minute grace period, `cleanupMedia`/`mediaCleanup`, `releaseMedia`,
`attachRef`/`releaseRef`, `RELEASE_WRITES` budgeting in cascades, owner
recovery and `media-cleanup.js` on the client: roughly 300 lines exist only so
an upload is deleted when the last document using it goes. Image profile
fields needed a second reference shape (`characters/<id>#<field>`) and a
three-per-character cap to fit the 25-write cascade.

**Suggestion:** native references. For example `ctx.media.attach(id, key)` /
`ctx.media.detach(id, key)` with Naru deleting an upload when its last
reference goes (and unattached uploads after a grace period), or a document
field convention (`{ $media: id }`) Naru counts itself. HTML posts could then
take inline uploads, which this port leaves out.

## 4. No array membership in `where`

Hashtag search stores the first five tags again as `tag0`…`tag4` so a
predicate of five `eq`s can find them (`tagFields`, `tagWhere` in
`modules/shared.js`).

**Suggestion:** `{ has: [field, value] }` for arrays of scalars (and an index
for it).

## 5. Function-written documents have no author

Documents a function writes have no `createdBy`, which is why `owner` is in
the data everywhere, every author check reads `createdBy ?? data.owner`
(`author()`) and the board rule checks both.

**Suggestion:** an explicit `ctx.add(..., { as: memberId })` (and the same on
`set`) that records the member as `createdBy`. Owner batches also have no
documented maximum size.

## 6. Storage quota against a real community

10,000 documents / 10 MiB per site (#2) is below an AvocadoEdition community
of a few years: every comment, message, history row, inventory item and call
is a document.

**Suggestion:** a quota that scales with plan, a way to check remaining
space, and counting by bytes rather than documents.

## 7. A local emulator

The port maintains three imitations of Naru: an in-memory `ctx` for unit tests
(including a `where` evaluator, `tests/where.mjs`), a harness that bundles
Naru's own `edge/src/functions.ts` from a checkout of the Naru repository
(`tests/runtime.mjs`, which needs that repository's dependencies installed),
and an 1,150-line Playwright fixture that re-implements the HTTP protocol,
rate limits, rules, live sockets and now visitors (`tests/browser-smoke.mjs`).
Each new SDK feature means updating all three, and the fixture still ignores
`where` on native lists.

**Suggestion:** a published emulator (`npx naru dev`) running the real
runner, rules, SQLite, live connections and limits locally.

## 8. Smaller items

- **Abuse controls for visitor writes.** Guest posting rests on the
  per-address limit (20 writes a minute). A CAPTCHA/Turnstile check usable
  from a function (`ctx.visitor.verify(token)`) would make public writing
  safe to turn on.
- **Who is calling.** Functions branch on `ctx.member`, `ctx.owner` and
  `ctx.visitor`; `communityAccess` had to learn all three. A single
  `ctx.caller` (`{ kind, id }`) would be clearer.
- **Grouped counts.** Comment counts are one `ctx.count` per log. A
  `ctx.countBy(collection, field, values)` would be one operation.
- **Site time zone.** Korean-day limits and schedules use hand-written
  offsets (`kstDay`, `kstStamp`); `ctx.today()` from a site time zone (#9)
  would remove them. A `where` placeholder for "now" would let scheduled
  banners be native reads instead of a function.
- **Sequences.** Log numbers use a counter document per board. It works inside
  a transaction; a documented `ctx.next(sequence)` would save every app from
  writing it.
- **Rules divergence.** Naru's `docs/examples/community-board-rules.js` is
  still the self-contained copy and no longer matches this port's rule,
  which imports `modules/shared.js`.

## What worked well

Transactional functions with `ctx.fail` details, read-only and visitor
declarations, `ctx.password`, `getMany`, `where`, unique fields, live notices
after commit and transactional `ctx.media.delete` each removed a workaround
cleanly; the guest board, comment counts and in-post combination were built
on them without SDK changes.

## Changed in the SDK during the port

- **Collection settings at owner sign-in.** Installing the port meant
  creating some 30 collections by hand with the right access, rules and
  unique fields, and a site's owner token cannot change them. SDK 1.1.0's
  `auth.signIn` now takes `settings` (read, write, rules, unique per
  collection); Naru's sign-in page creates missing collections that way and,
  on the owner's click, corrects existing ones, marking widened access.
  `admin.html` uses it (naru-pub `97701a29`).
