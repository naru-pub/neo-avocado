# What Naru SDK 1.1.0 could improve, from the port to tables

Written 2026-10-17, after the whole site moved from collections, collection
rules and site functions to SQL tables, queries, mutations and live queries
(see [port.md](port.md)). The earlier feedback, written against collections
(rules that could not hide fields, guest writes, media references, array
membership, function-written documents without authors, the document
quota, a local emulator), is answered by the new design or by naru-dev and
is not repeated. Each item below is something the port works around; the
workaround is named so it can go when Naru grows the feature.

## 1. JSON in a row cannot be opened by SQL

A day's visit counts keep their hourly, browser, OS, device and referrer
breakdowns as JSON maps. Summing them with `json_each` is refused by the
plan rule, since the table-valued function is a second table scanned for
every day:

> Invalid SQL: it would read all of j for every row before it; give j an
> index on the column it joins on.

`admin/visits:report` therefore sums days, months, years and weekdays in SQL
but reads the days' rows (at most 1,000) and sums the maps in code.

**Suggestion:** let a table-valued function over the current row's own
column (`json_each(visits.hours)`) count as reaching that row, not as a
scan; its size is bounded by the row's.

## 2. An ordered aggregate in a correlated subquery

`json_group_array` over a character's titles in the order given needs an
ordered inner subquery, which the plan rule refuses even though it only
reads that character's rows by index:

> Invalid SQL: a subquery would read all of (subquery-1) for every row;
> give (subquery-1) an index on the column it compares.

The admin's record view lists titles in index order instead.

**Suggestion:** treat a scan of a subquery's own result (an ephemeral
table) as part of the subquery it belongs to.

## 3. One statement's limits

A statement binds at most 100 values and returns at most 1,000 rows
("ctx.sql returns at most 1000 rows and 1 MiB; add a LIMIT."). Granting a
title to many chosen characters runs in chunks of 90 IDs; the admin's pick
lists read 1,000 rows at a time; 활동량 관리 shows 1,000 members and the
visits report 1,000 days.

**Suggestion:** a documented way to pass a list as one value (a JSON array
used with `IN (SELECT value FROM json_each(?))` exempt from item 1), and
streaming or paging for owner-only reads.

## 4. The runtime's globals

Queries and mutations run in QuickJS. `URL` is there (1,000 parses a call);
whether `structuredClone`, `Intl` and the like are is not documented, so the
admin's checks shared with the page copy with `JSON.parse(JSON.stringify())`.

**Suggestion:** list the globals in `functions.d.ts`.

## 5. Owner-only code is the code's job

Anyone may call any query or mutation, so every admin module starts with the
same owner check, and a test calls each export as a member and a visitor to
prove it refuses.

**Suggestion:** an `owner/` folder (or an exported `ownerOnly` flag) whose
exports Naru refuses to anyone but the owner, as it once did for collections
with owner-only access.

## 6. Smaller items

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
