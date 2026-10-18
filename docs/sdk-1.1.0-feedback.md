# What Naru SDK 1.1.0 could improve, from the port to tables

Written 2026-10-17, after the whole site moved from collections, collection
rules and site functions to SQL tables, queries, mutations and live queries.
What collections lacked is answered by that design or by naru-dev, and what
Naru has answered since (JSON and ordered aggregates in SQL, one statement's
limits, the runtime's globals, which `functions.d.ts` now lists) is gone from
here. Each item below is something the port still works around; the
workaround is named so it can go when Naru grows the feature.

## 1. Owner-only code is the code's job

Anyone may call any query or mutation, so every admin export is wrapped in
the site's own `ownerOnly(fn)`, and a test checks each export's mark and
calls it as a member, a moderator and a visitor to prove it refuses.

**Suggestion:** an `owner/` folder (or an exported `ownerOnly` flag) whose
exports Naru refuses to anyone but the owner, as it once did for collections
with owner-only access.

## 2. Smaller items

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
- **App notifications pile up and outlive what they tell of.** Five comments
  on one post are five notifications in the Naru app, and reading the 쪽지
  or opening 알림 on the site leaves them there. A key that replaces the
  earlier notification of the same post, and a way to withdraw one, would
  let them follow the site's own 알림. `modules/push.ts` also cuts titles
  and bodies, which Naru now does itself; that can go once it is deployed.

## What worked well

One-statement SQL with bound values, mutations as transactions with
`ctx.fail` details, `ctx.passwords` for guests, `ctx.setRoles` for the
community's moderators and members-only groups, and live queries that answer
again when a mutation writes what they read each replaced a workaround of
the collection design. naru-dev runs the real edge Worker, so the
end-to-end suite tests the site as it will run.
