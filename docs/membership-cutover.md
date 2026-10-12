# Membership cutover (not yet ready to deploy)

The member gateway and approved SDK read API are implemented locally.
Chrome passes with separate read/mutation limits enforced (84/120 reads and
10/30 mutations per minute). Media deletion remains unapproved. Remaining
workflows and live acceptance still prevent deployment readiness.

## Prepare before publishing

1. Export the existing site database and media inventory. Preserve IDs, wallet
   balances, inventory, purchase counters, private messages and pending work.
2. Create `neo_avocado_members` and `neo_avocado_media_assets`, with both read and write set to admin.
3. For existing community members, reconcile platform membership separately.
   Create application metadata keyed by the site member ID with `role: "member"`.
   Do not infer these IDs from Naru account IDs or usernames. Preapprove staff
   separately, and grant `moderator` only where intended.
4. Publish `_naru/rules/community-board.js`. On `neo_avocado_logs` and
   `neo_avocado_comments`, set **read to member, write to admin, and rules to
   community-board**. The rules must be enabled before opening member reads.
   Set **both read and write to admin on all other application collections**,
   including profiles, characters, wallets, inventory, catalogs, configuration
   and private records. Member/world access without rules bypasses the app gate.
5. Publish the updated frontend and function module together during an
   application maintenance window. Old pages used native collection requests
   and will fail after the permission change. Naru's control plane itself does
   not need to stop. Preserve database and payment/durable records.
6. Use an owner sign-in granting the newly added collections. Re-sign in if
   an older owner grant lacks them.
7. Verify approved/pending/banned member reads, mutations, private records,
   moderator limits, multi-page reads, active-session bans and rate limits
   against a real authorized test site before opening the community.

## Platform membership

Admission and caller approval/bans now belong to Naru. The frontend calls
`member.membership()` before any protected reads. Pending and banned members see
their member ID and can recheck or sign out; they cannot submit/edit a profile
until approved. An ACCESS_DENIED response triggers a fresh platform status check,
so a live ban clears private views without confusing a board ACL denial with a ban.

Naru rejects pending/banned tokens before data requests, site functions and media
upload authorization/finalization. Functions retain application roles, board levels,
ownership, secret-post redaction and transactional business rules. The local
`membership` function now returns only profile/role/level; it does not decide status.
`neo_avocado_members.status` and `settings/community.admission` are inert legacy
fields. New member metadata contains role/level only. Local admin forms no longer
edit approval, bans or admission; use Naru's database panel instead.

Messages and gifts still require an existing recipient profile; messages honor
recipient opt-out. They no longer consult legacy approval/ban fields. Naru's SDK
cannot query another member's platform status, so a banned member can receive
messages/gifts but cannot access them while banned. No wallet, inventory, history,
private message, durable cleanup record or existing ID is deleted by this change.

This is a code change only: no live data or permissions have been migrated.
Before publishing, ensure all control-plane processes enforce platform membership
and the served SDK supports both `membership()` and this app's existing `read()`
API. Membership is committed on Naru main; read-only functions remain a separate
SDK dependency. Do not deploy against a server lacking either capability.

For a live community, separately reconcile existing approvals/bans and admission
with platform states before publishing. Do not remove legacy gates while platform
members are still default-approved. Preserve role/level metadata and keep every
other application collection admin/admin. Post/comment reads use native
collections plus board rules; platform membership alone does not replace board
ACLs or ownership checks.

Interrupted cleanup remains durable and owner-recoverable. Managed media IDs and
deletion are implemented; see [media lifecycle](media-api-proposal.md) for ledger
setup and owner deletion consent. Public/guest boards, imports and unattended
recovery remain separate work.

## Board cutover

Backfill each legacy log lacking a board with `board: "default"` through an
owner-authorized import or conditional write, preserving all other fields,
IDs, ownership and timestamps where the import supports them. New lists
filter explicitly on this value; missing JSON fields do not match JSON null.
Add the protected `neo_avocado_boards` collection. A missing default board
uses the virtual image board at level 2. Review each board's levels and secret
policy before reopening. No backfill or permission changes have been made
against a live site.

## Native post and comment reads

The frontend uses `member.collection()` for log get/list and comment get/list.
Log lists always send `filter: { board }`, including the default board. Comment
lists send `filter: { logId }`. Rules apply before pagination and totals.
Inaccessible secret posts are absent from the list, rather than locked previews;
get requests for them return NOT_FOUND. Short previews are produced locally from
complete authorized documents; expansion rereads through the native collection.

Member reads require the configured `community-board` module. Configure both
collections in Naru's database panel as above; never open member reads without
rules. Backfill missing legacy log board IDs before using this frontend. Publish
the rules and frontend together after the Worker/control-plane release supporting
collection rules. Allow the ten-second rules-file cache to expire before opening.
No live permissions, membership states or document data have been changed.

Post/comment mutations still call `communityData`; log/character deletion retains
its durable, resumable cascade. Purchases, stock, rewards, gifts and private
messages remain in transactional functions. Do not enable native member writes
as part of this cutover. The rule file's write hook is defensive support for future
changes, not permission to bypass the existing write functions.
