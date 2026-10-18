# What Naru SDK 1.1.0 could improve, from the port to tables

Written 2026-10-17, after the whole site moved from collections, collection
rules and site functions to SQL tables, queries, mutations and live queries
(see [port.md](port.md)). The earlier feedback, written against collections
(rules that could not hide fields, guest writes, media references, array
membership, function-written documents without authors, the document
quota, a local emulator), is answered by the new design or by naru-dev and
is not repeated. Each item below is something the port works around; the
workaround is named so it can go when Naru grows the feature. Items 1–3 are
resolved; how is said in each. Items 1 and 2 are moot since 2026-10-18:
Naru removed its query-plan rule, and stops a statement after 3 seconds
instead.

## 1. JSON in a row cannot be opened by SQL (moot)

Naru's plan rule refused `json_each(visits.hours)` over a row's column until
it was taught otherwise, and is now gone. `admin/visits:report` sums the
day's JSON maps, and counts the different members, in SQL over every day in
the range.

## 2. An ordered aggregate in a correlated subquery (moot)

The plan rule refused a scan of a subquery's own result inside a correlated
subquery until it was taught otherwise, and is now gone. The admin's record
view lists a character's titles in order with `json_group_array` over
`(SELECT title_id FROM character_titles WHERE character_id = characters.id
ORDER BY id)`.

## 3. One statement's limits (resolved)

A statement still binds at most 100 values and returns at most 1,000 rows,
but Naru documents the ways past them. Granting a title to many chosen
characters binds their IDs as one JSON array
(`IN (SELECT value FROM json_each(?))`), one statement each instead of
chunks of 90; the admin's pick lists page by key (`WHERE (sort_order, id) >
(?, ?)`) instead of by `OFFSET`; the visits report no longer reads days.
활동량 관리 still shows its 1,000 most active members: paging it means a
cursor of (activity, nickname, member) over its ordered subquery and a
"더 보기" in the page.

## 4. The runtime's globals

Queries and mutations run in QuickJS. `URL` is there (1,000 parses a call);
whether `structuredClone`, `Intl` and the like are is not documented, so the
admin's checks shared with the page copy with `JSON.parse(JSON.stringify())`.

**Suggestion:** list the globals in `functions.d.ts`.

## 5. Owner-only code is the code's job

Anyone may call any query or mutation, so every admin export is wrapped in
the site's own `ownerOnly(fn)`, and a test checks each export's mark and
calls it as a member, a moderator and a visitor to prove it refuses.

**Suggestion:** an `owner/` folder (or an exported `ownerOnly` flag) whose
exports Naru refuses to anyone but the owner, as it once did for collections
with owner-only access.

## 6. Smaller items

- **Bans are invisible to site code.** 회원관리 counts 차단 members, but a
  site cannot ask Naru which of its members are banned, so the count is
  of the community's own 접근차단일 alone.
- **No HTML sanitizer for site code.** Queries and mutations run without
  a DOM, so HTML a post keeps is cleaned only when shown (DOMPurify). A
  rich-text editor that stores HTML would want a sanitizer on the server.

- **Site time zone.** Korean days and schedules use hand-written offsets
  (`kstDay`, `kstStamp`, `kstStart`); a site time zone with SQL helpers
  would remove them.
- **A boolean column comes back as 0 or 1.** Booleans bind as 1 and 0 but
  read back as numbers, so every row is mapped by hand.

## What worked well

One-statement SQL with bound values, mutations as transactions with
`ctx.fail` details, `ctx.passwords` for guests, `ctx.setRoles` for the
community's moderators and members-only groups, and live queries that answer
again when a mutation writes what they read each replaced a workaround of
the collection design. naru-dev runs the real edge Worker, so the
end-to-end suite tests the site as it will run.
