# Membership cutover (not yet ready to deploy)

The member gateway and approved SDK read API are implemented locally.
Chrome passes with separate read/mutation limits enforced (84/120 reads and
10/30 mutations per minute). Media deletion remains unapproved. Remaining
workflows and live acceptance still prevent deployment readiness.

## Prepare before publishing

1. Export the existing site database and media inventory. Preserve IDs, wallet
   balances, inventory, purchase counters, private messages and pending work.
2. Create `neo_avocado_members`, with both read and write set to admin.
3. For existing community members who should retain access, create a record
   keyed by their site member ID, with `status: "approved"`, `role: "member"`.
   Do not infer these IDs from Naru account IDs or usernames. Preapprove staff
   separately, and grant `moderator` only where intended.
4. Set **both read and write to admin on every application collection**,
   including profiles, characters, logs, comments, wallets, inventory, catalogs,
   configuration and private records. Leaving a member/world permission enabled
   lets a native SDK request bypass the application gate.
5. Publish the updated frontend and function module together during an
   application maintenance window. Old pages used native collection requests
   and will fail after the permission change. Naru's control plane itself does
   not need to stop. Preserve database and payment/durable records.
6. Use an owner sign-in granting the newly added collections. Re-sign in if
   an older owner grant lacks them.
7. Verify approved/pending/banned member reads, mutations, private records,
   moderator limits, multi-page reads, active-session bans and rate limits
   against a real authorized test site before opening the community.

## Implemented rules

- Free admission is the default. `settings/community.admission` may be `open`,
  `approval` or `closed`. Explicit member records override the default.
- `membership` returns only the caller's own status, role, ID and profile.
  `join` creates/updates that profile and an ordinary member record; it cannot
  unban or self-promote. Pending members may edit their joining nickname.
- Approved members access data through `communityData` and other checked site
  functions. Wallets and inventory are restricted to the caller. Member records
  and private message/history storage cannot be queried through that gateway.
- Moderators may edit/delete others' logs and comments. They do not gain
  character/profile ownership, another member's wallet or arbitrary collection
  access. Site owners retain their native administrator authority.
- A deleted log/character is marked `deleted` before cleanup. Each call removes
  small child batches. Incomplete cleanup stays marked durably and can be
  resumed by its author (or a moderator for logs). New comments/references to
  a deleting parent are refused. Purchased inventory is detached from a
  deleted character rather than discarded; history and money are preserved.

## Remaining acceptance gaps

- Deploy the approved read endpoint alongside SDK 1.1.0 before the new app.
  The local Chrome fixture enforces 120 reads/minute and 30 calls/minute and
  passes. Verify deployed routing, authentication and budgets before opening.
- Naru's existing member upload endpoint has no application membership check.
  A community ban blocks app data/functions, but its Naru token can still
  request media uploads. Upload authority and orphan reconciliation need
  explicit review; they are not claimed complete.
- Interrupted cleanup stays durable. Owner recovery views now resume it in
  revision-checked batches; re-sign in for the additional collection scopes.
  Large cleanup and conflict preservation pass locally. Operators must review
  the recovery queues during cutover; unattended background recovery is absent.
- Media deletion, public/guest board access, richer moderation, imports and
  the other outstanding workflows in `port-status.md` remain unfinished.

## Board cutover

Backfill each legacy log lacking a board with `board: "default"` through an
owner-authorized import or conditional write, preserving all other fields,
IDs, ownership and timestamps where the import supports them. New lists
filter explicitly on this value; missing JSON fields do not match JSON null.
Add the protected `neo_avocado_boards` collection. A missing default board
uses the virtual image board at level 2. Review each board's levels and secret
policy before reopening. No backfill or permission changes have been made
against a live site.
