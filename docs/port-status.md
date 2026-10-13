> Managed media now stores upload IDs and queues cleanup transactionally through
> an admin-only media ledger. Members retry their own cleanup; owners recover it
> with explicit deletion consent and a platform uploader check. See
> [media lifecycle](media-api-proposal.md) for setup and remaining recovery limits.

> Post/comment reads now use native member collections with the published
> `community-board` rules. Writes, cascades and economy operations remain in
> transactional functions. Enable collection rules before opening member reads;
> see the membership cutover instructions below. No live cutover has occurred.

> Membership update: caller approval, bans and admission now use Naru platform
> membership. Local member records retain roles and board levels. See
> [membership-cutover.md](membership-cutover.md) for current deployment prerequisites;
> historical progress notes below describe the previous application gate.

# AvocadoEdition port

The reference is `/Users/limeburst/Git/AvocadoEdition/AvocadoEdition`.
The goal is to port its community workflows to Naru SDK 1.1.0, not merely
reproduce the existing demo. SDK additions require the owner's approval.

## Requirements and evidence

| Workflow                                          | Reference                                                   | Status                                                                                                                                                                                                  |
| ------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Member login and profiles                         | `bbs/register*`, `mypage`                                   | Identity, profile, application approval/closed admission/bans implemented; upload authority remains unresolved; approved read budget implemented locally                                                |
| Drawing logs and comments                         | `bbs/write*`, board skins                                   | Gateway CRUD, ownership/revisions, moderator edit/delete and resumable child cleanup implemented; board levels/categories/secrets/previews implemented; public/guest access and rich posts pending      |
| Character profiles                                | `mypage/character`, `adm/character_article*`                | Basic create/read/edit/delete and main character implemented; custom fields pending                                                                                                                     |
| Character relationships, couples, outfits, titles | `mypage/character`, `couple`, `adm/title*`                  | Relationships, wardrobe, owner-managed couples/title grants and member title selection implemented; bulk grants/revocation implemented; ownership gallery review and title deletion cleanup implemented |
| Stats, experience and ranks                       | `adm/status*`, `adm/exp*`, `adm/level*`                     | Allocation, recovery, official progression, rank display and owner administration implemented                                                                                                           |
| Shop, attendance and gacha                        | `shop`, `extend/item.lib.php`                               | Member flows, private history, exchange costs and owner catalog/gacha/recipe forms implemented                                                                                                          |
| Inventory use, sale, gift and crafting            | `inventory`, `adm/recipi*`                                  | Use eligibility, sale/gift/craft, character linking, owner inventory grants and validated catalog effects implemented                                                                                   |
| Quests                                            | `adm/quest*` and their callers                              | Reference admin fields implemented; scheduled member display and category pagination implemented; reference has no claim/reward endpoint                                                                |
| Private messages and notifications                | `bbs/memo*`, `ajax/*call*`                                  | Private inbox/sent/read/reply/delete, receive preference, bulk costs and live unread notices implemented; board notifications pending                                                                   |
| Community administration                          | `adm/admin.menu*.php`                                       | Owner member status/role controls and existing catalog/economy controls implemented; broader board moderation pending; owner cleanup recovery implemented                                               |
| Navigation, content, themes and emoticons         | `adm/menu*`, `adm/content*`, `adm/design*`, `adm/emoticon*` | Pending                                                                                                                                                                                                 |
| Existing data import                              | SQL schema and uploaded files                               | Pending: explicit ID/member mapping and media handling; never copy PHP credentials                                                                                                                      |
| Browser and server acceptance                     | Naru release checklist                                      | 41 tests and synthetic Chrome pass; enforced budgets peak at 84 reads/120 and 10 mutations/30. Real deployment acceptance pending                                                                       |

Naru replaces PHP hosting, account passwords, email verification and SQL server
maintenance. These platform implementation details are not new application features.
Any other omitted reference workflow must be recorded with source evidence and a
reason; passing the current demo tests is not completion of the port.

## Verification

- `npm test` verifies page requests and server rules.
- `npm run lint` checks formatting.
- Verify runtime behavior with the actual SDK and transactional function runtime.
- Check all requirements above before declaring the port complete.
- Deployment and SDK freeze are separate from implementing the application.

## Current verification and next implementation steps

- 41 unit/page tests pass; Prettier passes.
- `tests/browser-smoke.mjs` passed in actual Chrome with the committed SDK
  1.1.0 and synthetic HTTP responses. It exercised revision-checked editing,
  crafting, relationship creation, outfit registration and wearing. It is not
  a production login, actual Durable Object transaction, or R2 test.
- The browser pass caught an undefined-property argument in relationship
  creation that SDK JSON validation rejects; creation now omits optional IDs.
- The approved `member.read()` extension is implemented locally in SDK 1.1.0; frozen 1.0.0 stays unchanged.
- New collections required for this work: recipes, relations, wardrobe, character_state, stat_config, settings, levels, titles, couples and history;
  post/comment collections require member read, admin write and the community-board rules; all other application collections remain admin/admin. See membership-cutover.md before deploying.
- Next: complete admission/member/moderation administration, boards and private messaging. Admission and bans require
  moving protected writes behind site functions; merely hiding controls will
  not enforce them. Private collections must be admin-readable and filtered
  on the server, not by the browser.
- Still required: cleanup of dependent records on character/log deletion,
  the remaining feature rows above,
  deployment/setup and live acceptance. Do not treat this milestone as a
  finished port.

- Item use and stat allocation also passed the actual-SDK Chrome fixture.
- `tests/runtime.mjs` loads the actual Naru `edge/src/functions.ts` runner, its
  `DataError`, exact QuickJS 0.32.0 interpreter and memory cap. It executes the
  port's source against SQLite and confirms rollback after an injected host
  failure during crafting. It passed. This is not an actual Durable Object
  HTTP/auth integration test.

- Chrome actual-SDK pass now includes owner authentication restore, couple
  creation, title creation and grant, member title selection, linked purchases
  and private history. Owner credentials are synthetic; real sign-in remains
  a deployment acceptance requirement.
- QuickJS/SQLite checks include title selection, linked purchases, server-filtered
  history and a twenty-material craft using 23 writes (within the 25-write limit).
- `admin.html`, `admin.js`, `admin-model.js` implement named owner forms,
  conditional replacement/new-record writes and conditional deletion. Remaining
  administration rows are still unfinished; this is not a completed port.

- Catalog browser acceptance passed: owner creates a recovery item, a fractional-
  weight draw row and a recipe with ingredient rows. Owner balance changes
  use the SDK's existing conditional batch for balance plus history, and the
  browser pass verifies both writes. Inventory grants validate recipient
  character ownership and derive names from the catalog.
- `docs/media-api-proposal.md` records a real SDK gap: uploaded-file deletion.
  Media deletion remains unapproved and unchanged. The separate read API
  has since been approved and implemented locally.
  Continue independent port work; do not implement that extension without an
  affirmative reply. Existing website owner tokens must retain their current
  upload-only media permission.

- Private messages require the new messages collection with both read and
  write set to admin. Listing, reading, deletion and read receipts are party-
  checked inside site functions. Recipient opt-out and all recipients are
  validated before charging/sending. Max 20 recipients and 5,000 characters.
- QuickJS/SQLite tests verify third-party denial, recipient-only receipts and
  maximum-size twenty-recipient delivery using 22 writes. Chrome sends and
  reads between two synthetic members, replies, deletes, treats script-like
  text as plain text, and detects a later message through live polling.
- Original ajax/memo_call.php polls every five seconds; the port matches that
  interval while visible, skipping open mailboxes and existing unread notices.
  SDK call/monthly limits still apply. Comment/board alerts are not complete.

- Member approval/bans use protected member records. All public app functions
  now gate membership, and community data goes through a collection whitelist
  and owned-document checks. Moderators are limited to logs/comments.
- `docs/membership-cutover.md` records the incompatible permission cutover,
  existing-member preapproval, preserved inventory/history and remaining
  gaps. No production permissions have changed; the approved SDK read API
  is implemented locally.
- Actual-SDK browser fixture denies every native member collection request;
  the complete app flow still runs through its gateway. It exercises an active
  member ban, owner reapproval and re-entry. The same fixture measured a peak
  of 92 function calls/minute. Its pass does NOT prove production readiness.
- The read-only SDK proposal is approved and implemented locally. Protected
  get/list, membership/status, mailbox lists and history use `member.read`.
  Sends, receipts, deletion and economic/content mutations keep `call`.
  The latest Chrome fixture enforces both rates and passed at 84 reads/120
  and 10 mutations/30 in a fixed minute. Media deletion remains unapproved.
- Boards now enforce list/read/write/comment levels, categories and secret
  visibility. List previews do not expose locked bodies/images. Full reads
  retrieve the stored body without truncation. Existing logs require explicit
  `board: "default"` backfill during cutover. Public/guest access, rich posts,
  board notifications are still incomplete. Operator cleanup recovery is
  implemented and verified locally.
- Local SDK/member HTTP + Durable Object integration passes (27 checks,
  one existing skip). It verifies read authentication, write rejection and
  independent server budgets. The same SDK contract suite passes all 11
  checks through the public Worker route. SDK build/reference freshness and
  edge typechecking pass. Nothing has been deployed.

- Owner recovery views list durably marked logs/characters and resume bounded,
  revision-checked batches. Conflicts leave the marker for retry. Character
  cleanup now removes couple records too, within the 25-write function cap.
  Purchased inventory is detached, while wallets and history remain intact.
  43 unit/page checks pass; actual-SDK Chrome recovery and large QuickJS/SQLite
  deletion checks pass. No media is deleted and nothing has been deployed.

- Title administration now grants/revokes for selected characters or all approved
  characters, matching adm/title_has_update.php's approved-only bulk grant and
  duplicate prevention. Existing progression and other titles are preserved;
  revocation clears the equipped title when applicable. Revision-checked chunks
  report committed progress on failure; rerunning is idempotent. 46 unit/page
  checks and actual-SDK Chrome selected grant/revoke pass. Gallery review and
  cascading title-definition deletion are still pending.

- Title-definition deletion marks the title durably, blocks grants/equipping and
  title-gated use/purchases while cleanup is pending, and removes it from all
  progression records (including orphan/unapproved records). Revision-checked
  batches preserve other titles and progression; reselect Delete to resume after
  interruption. The final batch uses the existing media-reference release path.
  Unit tests verify conflict recovery; current SDK QuickJS/SQLite checks pass.

- Quests preserve the reference's daily/weekly type, faction, title, start/end
  scheduling and multiple image URLs. Owner forms validate Korean local times,
  ordered periods and safe image URLs. Members have a paginated quest tab with
  category filtering; the server excludes future, ended and malformed periods.
  Start is inclusive, end exclusive. An absent boundary imposes no time limit.
  Add admin/admin `neo_avocado_quests` and renew the owner collection grant.
  Reference adm/quest_form.php links quest.php, but that file/claim implementation
  is absent, so no invented reward/claim endpoint is introduced. 58 unit/page
  tests and the current SDK QuickJS/SQLite suite pass.
- Actual-SDK Chrome verifies owner quest creation, image persistence, member
  display and weekly filtering. Local acceptance passed; no live collection or
  deployment has been changed.

- Owner title-ownership review matches adm/title_has_list.php: holder names,
  title artwork, equipped status, character/title search and individual revoke.
  Search covers all progression pages, with 50 results per displayed page.
  Missing character/title definitions remain visible for cleanup. Revision-checked
  revocation preserves unrelated grants and clears matching equipped selection.
  59 unit/page checks pass; no additional SDK API is required.
- Actual-SDK Chrome verifies ownership search and individual revoke; formatting
  and 59 unit/page checks pass. No deployment has been made.
