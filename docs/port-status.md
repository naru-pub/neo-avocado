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

| Workflow                                          | Reference                                                   | Status                                                                                                                                                                                                                                                                 |
| ------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Member login and profiles                         | `bbs/register*`, `mypage`                                   | Identity, profile, application approval/closed admission/bans implemented; upload authority remains unresolved; approved read budget implemented locally                                                                                                               |
| Drawing logs and comments                         | `bbs/write*`, board skins                                   | Gateway CRUD, ownership/revisions, moderator edit/delete and resumable child cleanup implemented; board levels/categories/secrets/previews implemented; posting as a character, server dice and [[nick]] calls implemented; public/guest access and rich posts pending |
| In-post roleplay actions                          | `skin/board/mmb/*`, `extend/mmb.lib.php`                    | Dice, exploration with a Korean-day limit counted on request, explore drop table and item use logged into the comment implemented; in-post combination (action H) deferred                                                                                             |
| Character profiles                                | `mypage/character`, `adm/character_article*`                | Create/read/edit/delete, main character, owner-defined custom fields with public/owner/admin visibility, editing → submitted → approved review, public applicant list and main/sub/NPC implemented; managed uploads for image fields pending                           |
| Character relationships, couples, outfits, titles | `mypage/character`, `couple`, `adm/title*`                  | Relationships, wardrobe, owner-managed couples/title grants and member title selection implemented; bulk grants/revocation implemented; ownership gallery review and title deletion cleanup implemented                                                                |
| Stats, experience and ranks                       | `adm/status*`, `adm/exp*`, `adm/level*`                     | Allocation, recovery, official progression, rank display and owner administration implemented                                                                                                                                                                          |
| Shop, attendance and gacha                        | `shop`, `extend/item.lib.php`                               | Member flows, private history, exchange costs and owner catalog/gacha/recipe forms implemented                                                                                                                                                                         |
| Inventory use, sale, gift and crafting            | `inventory`, `adm/recipi*`                                  | Use eligibility, sale/gift/craft, character linking, owner inventory grants and validated catalog effects implemented                                                                                                                                                  |
| Quests                                            | `adm/quest*` and their callers                              | Reference admin fields implemented; scheduled member display and category pagination implemented; reference has no claim/reward endpoint                                                                                                                               |
| Private messages and notifications                | `bbs/memo*`, `ajax/*call*`                                  | Private inbox/sent/read/reply/delete, receive preference, bulk costs, live unread notices, new-post notices, [[nick]] calls and comment notices with call history implemented                                                                                          |
| Community administration                          | `adm/admin.menu*.php`                                       | Owner member status/role controls and existing catalog/economy controls implemented; broader board moderation pending; owner cleanup recovery implemented                                                                                                              |
| Navigation, content, themes and emoticons         | `adm/menu*`, `adm/content*`, `adm/design*`, `adm/emoticon*` | Emoticon owner CRUD, comment catalogue/picker and safe keyword rendering implemented; managed desktop/mobile content implemented; navigation and themes pending                                                                                                        |
| Existing data import                              | SQL schema and uploaded files                               | Pending: explicit ID/member mapping and media handling; never copy PHP credentials                                                                                                                                                                                     |
| Browser and server acceptance                     | Naru release checklist                                      | 98 unit/page tests, actual-runner QuickJS/SQLite checks and synthetic Chrome pass; Chrome peaks at 10 mutations/30 and 81 reads/120. Real deployment acceptance pending                                                                                                |

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
  text as plain text, and shows a later message's live notice.
- Original ajax/memo_call.php polls every five seconds. The port no longer
  polls: `sendMessage` notifies recipients over `member.live()` (SDK 1.1.0)
  and the page rereads the unread status only when the connection (re)opens.
  Comment alerts and calls were added later; see "Roleplay core".

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

- Emoticons preserve adm/emoticon_list.php's literal command keywords and images,
  plus the board catalogue. Members can insert keywords at the comment cursor;
  saved text remains editable. Rendering creates text/img nodes and never parses
  comment HTML. Overlapping keywords choose the longest match deterministically.
  Definitions load lazily through the existing protected read gateway. Add
  admin/admin `neo_avocado_emoticons` and renew the owner collection grant.
  61 unit/page tests and current SDK QuickJS/SQLite checks pass.
- Actual-SDK Chrome passes owner emoticon creation, picker insertion and saved
  comment image rendering. No SDK API change or live deployment was made.

- Managed content ports adm/contentform.php's title, desktop/mobile HTML and
  header/footer artwork. Owners also control publication and member read level.
  Member lists omit bodies; direct reads enforce the same access and return only
  the chosen body (mobile falls back to desktop). The client renders plain text
  literally and HTML through DOMPurify's HTML profile without executable markup,
  form controls or page-global style/id/name attributes. Body fields are capped
  at 12,000 characters each so a selected body fits the function-result budget;
  the actual QuickJS/SQLite suite verifies maximum-size Korean bodies and a
  ten-record metadata list. 65 unit/page tests and Chrome desktop/mobile checks
  pass. Add admin/admin `neo_avocado_content` and renew owner collection scope.
  PHP includes/skin execution are platform-specific: convert their presentation
  to static content/theme components during import. Navigation/public visitors,
  reusable theme components and existing-data import are still unfinished.
- DOMPurify assets and dual-license files are committed for static deployment;
  `npm run vendor:content` refreshes from the locked package and CI runs
  `npm run vendor:check` to detect stale assets. No SDK API was added.

- SDK 1.1.0 function names now use `<module/path>:<function>`. The port calls
  `neo-avocado:<function>` throughout. Nested module paths map directly to
  `_naru/functions/<module/path>.js`. The canonical HTTP endpoints use the same
  colon separator; old slash-only function references are rejected. SDK 1.0.0
  artifacts and guides are unchanged. Updated-SDK Chrome, 65 unit/page tests and
  QuickJS/SQLite verification pass. Coordinate the 1.1.0 server/asset/app cutover;
  nothing has been deployed.

## Native function imports

SDK 1.1.0 now loads static relative JavaScript imports from immutable function
revisions. Neo-avocado's callable entry points are split into 13 domain modules
in `_naru/functions/`, sharing `_naru/modules/shared.js`. Frontend calls use the
`function-references.js` registry. Generated bundles and the build step were
removed. Unit, actual QuickJS/SQLite and Chrome smoke checks pass. This requires
the updated Naru Worker and control plane before installing the new site layout.

## SDK 1.1.0 feature adoption

Uses the 1.1.0 features that remove earlier workarounds. Nothing has been deployed.

- **Live notices replace the poll.** The five-second `messageStatus` interval is
  gone. `sendMessage` calls `ctx.notify(recipient, { unread: true })`, and a
  read receipt notifies the reader's other tabs with the new status. The page
  opens one `member.live({ topics: ["neo_avocado_logs"] })` after the profile
  loads. It rereads `messageStatus` only when the connection opens or reopens,
  since nothing is replayed, and closes on sign-out, ban or admission views.
  An idle connection costs nothing; opening one counts as one request.
- **New-post broadcasts.** `communityData` broadcasts `{ board, id }` on
  `neo_avocado_logs` after adding a post, but only for non-secret posts on boards
  a base level-2 member could both list and read. Broadcasts reach visitors
  too, so nothing else is sent. The logs tab shows "새 글" for the current board
  and reloads when clicked. The author's own posts are ignored. Edits,
  comments and restricted boards are not announced.
- **Rules share the functions' helpers.** `_naru/rules/community-board.js`
  imports `communityAccess`, `boardOf`, `boardAllowed`, `logReadable` and
  `author` from `_naru/modules/shared.js` instead of copying them. The
  rule's own write validators stay local because their limits differ from the
  gate's, as before. The semantics are unchanged: the Naru example's
  scope/write cases are reproduced in `tests/neo-avocado-functions.test.mjs`,
  and `tests/runtime.mjs` loads the rule through Naru's `ruleEntry` with its
  `modules/shared.js` import. **Divergence:** Naru's
  `docs/examples/community-board-rules.js`, which `naru/edge/src/functions.test.ts`
  tests, is still the self-contained copy. It no longer matches this file
  byte for byte. It needs updating in the Naru repository, which this change
  does not edit.
- **ctx.fail.** No function returned `{ ok: false }` after writing: every such
  return precedes its writes, so those stay ordinary returns. Media checks in
  `saveImage` now call `ctx.fail` with `details.reason` (`media_unavailable`,
  `media_ref_limit`) instead of throwing plain errors. Those calls already rolled
  back; now the page shows a specific message. `app.js` maps `error.details.reason`
  through `REASONS` in `run()` and the editor, and a unique-field conflict
  (`details.unique === "nick"`) to "이미 쓰는 닉네임입니다".
- **`where` predicates.** The `communityRead` gate accepts `options.where` only
  for collections it returns unredacted: profiles, characters, titles, couples,
  relations, wardrobe, recipes and emoticons. A predicate on redacted logs
  could probe locked secret bodies, so logs, inventory and other collections
  refuse it. The gate ANDs `{ ne: ["deleted", true] }` so a predicate never
  reaches soft-deleted rows. Fetch-all-then-filter loops now query a character's
  titles (`in` on ID), couples (`any` first/second), the member's own characters,
  visible recipes and message recipients. Two lists stay full reads: the gift
  dialog's character list, which is refiltered as the recipient changes, and the
  relation target list.
- **Transactional media deletion.** When a document releases the last
  reference to a managed upload, `releaseMedia` deletes the ledger row and calls
  `ctx.media.delete` in the same transaction. A rolled-back call deletes
  nothing. The browser's claim → `member.media.delete` → complete sequence and
  the `claimMedia`/`completeMedia` exports are gone. Abandoned uploads (registered,
  never attached, past the ten-minute grace) and rows the old flow left `pending`
  or `deleting` are handled by one `cleanupMedia` call. A read-only `mediaCleanup`
  check runs first, so an ordinary visit spends no write call. The log/character
  cascade now budgets writes rather than only child count, since a release
  can cost two writes. Owner recovery (`retryOwnerMedia`) is unchanged.
- **Unique nicknames (deploy step, not assumed).** The app handles the
  conflict, but the constraint needs the collection setting `unique: ["nick"]` on
  `neo_avocado_profiles` (database panel or PATCH). Naru refuses it while two
  profiles share a nickname, so resolve duplicates first. Matching is exact:
  "Bob" and "bob" differ. See membership-cutover.md.
- Verification: 84 unit/page tests, actual-runner QuickJS/SQLite checks (rule
  import, notices after commit, none after rollback, `ctx.fail` details, gate
  `where`, media drops in the 25-write cascade) and the Chrome smoke with the
  real 1.1.0 SDK and a mocked live WebSocket pass. Chrome peaked at 10/30
  mutations and 79/120 reads. The smoke fixture now classifies read-only calls
  by each module's `readOnly`; it had been counting them as mutations since the
  `readOnly` change.
- Left deliberately: nothing periodic (no scheduled jobs). Comment notices and
  calls came later with a per-member opt-out (see "Roleplay core"). No broadcast payload
  beyond board and ID. Owner-side media recovery keeps its batch/consent path.

## Roleplay core

Ports the mmb log board (`skin/board/mmb/*`, `write_update.inc.php`,
`extend/mmb.lib.php`), character sheets (`mypage/character/*`,
`adm/character_article*`), the applicant list (`member/ready.php`) and board
calls (`ajax/board_call.php`). Nothing has been deployed.

- **Posting as a character.** Log and comment `add` take `character`, one of
  the caller's own non-deleted characters, validated in the gate. The post
  stores a `speaker` snapshot: name, type, displayed title (name and HTTPS
  image) and portrait (worn outfit, else the character image), as the original
  stored `ch_id`, `ti_id` and `ma_id` with each post. Edits keep the speaker;
  a forged `speaker` or a new `character` in an edit is ignored. Without a
  character the post shows the nickname, as before. Native member reads
  return the snapshot, so rendering costs no extra reads.
- **Dice.** `dice: true` on a log or comment `add` stores `rolls` from
  `ctx.random()`; edits keep both, so dice cannot be rerolled or forged.
  Comments posted before this change still derive their roll from the ID.
- **Exploration (탐색).** A comment `add` with `action: "explore"` on a board
  whose `actions` flag is on (the built-in default board has it on) draws one
  row from the new `neo_avocado_explore` weighted table (a row without an item
  is a miss) into the speaking character's inventory. Only approved characters
  may explore, up to `settings/community.exploreLimit` times per Korean day
  (0, the default, turns exploration off). The count lives in
  `character_state.explore = { day, count }` and is compared with `kstDay(now)`
  on each request; nothing resets it on a schedule.
- **Items in a post.** A comment `add` with `item` (an owned inventory ID) uses
  it as the speaker: a recovery item heals the speaking character, a draw
  ticket rolls its own table into the item's character (or the speaker), and
  an item without an effect is logged as used with its description. Personal
  item and profile tickets need their forms and are refused (`not_usable_here`).
  Catalog use conditions apply as in the inventory. Non-reusable items are
  consumed. Each outcome is stored on the comment in `actions` and rendered as
  the original's action logs. Explore, item, dice, calls and the comment are
  one transaction; a later failure (for example `explore_limit`) rolls back
  the item too. The runtime check runs all of them in one call within limits.
- **Custom profile fields.** The owner defines fields in `neo_avocado_character_fields`
  (ID = code, `[a-z][a-z0-9_]{0,31}`): label, type text/textarea/select/url/image,
  select options, help, order, visibility public/owner/admin and "required to
  submit". Values live in the character's `fields` object (top-level queries
  cannot reach inside it). The gate returns, for one character, only public
  values plus owner-visible values to the character's owner; lists omit custom
  values altogether, which also keeps a page within the function result limit.
  Members cannot read admin-visibility definitions or write admin values; their
  edits keep them. Values are validated by type (select must match an option,
  url/image must be HTTPS) and capped at 6,000 characters together. `wear` and
  the profile ticket return redacted characters too.
- **Application flow.** Characters carry `state` (editing, submitted, approved)
  and `type` (main, sub, npc). Members choose editing or submitted and main or
  sub; submitting requires every required field they can fill. An approved
  character stays approved and an NPC stays an NPC when the member edits.
  Characters saved before this change count as approved when their official
  record is. The owner's `reviewCharacter` (owner-only; `admin.call`) sets
  state, type and admin-only fields, and keeps `character_state.approved` in
  step, so shop/item conditions and bulk title grants agree with the sheet.
  `admin.html` has a "캐릭터 신청 심사" section for it. The member tab filters
  applicants (editing or submitted) or approved characters with a gate `where`.
  Approving through the older character_state form changes only the official
  record; its help text points to the review section.
- **Calls and comment notices.** `[[nick]]` in a log or comment calls that
  member (at most five per post, only newly added names on edit). A nickname
  nobody uses becomes `[[???]]`, as in the original. A comment notifies the
  post's author unless their profile turns `commentAlerts` off (profile
  editor). A member who cannot read the post (secret, level, deleted) is not
  told. Each delivery adds a row to the new admin/admin `neo_avocado_calls`
  collection and sends `ctx.notify(member, { calls: true })` after commit.
  `messageStatus` now also returns `calls`, so a (re)opened live connection
  costs no extra read. The 알림 tab reads `callHistory` (read-only, newest
  first, hiding posts no longer readable) and calls `seeCalls`, which stores
  `profile.callsSeenAt` and clears the member's other tabs. Calls resolve
  nicknames exactly; enable the `unique: ["nick"]` profile constraint to avoid
  ambiguity.

### Deploy steps

1. Before publishing, create `neo_avocado_character_fields`,
   `neo_avocado_explore` and `neo_avocado_calls`, each with read and write set
   to **admin**. The updated `messageStatus`, character saves and comment
   actions read them, so publishing first would break those calls.
2. Sign in to `admin.html` again so the owner grant covers the first two (the
   calls collection is only written by functions).
3. Publish the site files together: the new `_naru/modules/characters.js`,
   `_naru/modules/roleplay.js`, `_naru/functions/community/calls.js` and
   `_naru/functions/characters/review.js` are imported or called by the
   updated entry points.
4. Optionally set a stored `default` board's (or any board's) "댓글 행동 허용"
   and `기본 설정 → 캐릭터별 하루 탐색 횟수`, and fill the explore table.
5. Existing characters have no `state`; they are shown without one and treated
   as approved if their official record is. Backfill `state` (and `type: "main"`)
   if the applicant filter should list them.

### Deferred

- Image fields take HTTPS addresses; managed uploads would need a media
  reference per field.
- In-post combination (action H), and the attack/defence/upgrade log types the
  skin's comments mention, which its update code does not implement. Crafting
  remains in the inventory.
- Pruning old call rows, and deleting a call row. Calls of deleted posts are
  hidden, not removed.
- Guest posting (visitor calls are being added to the SDK separately).
- Theme-specific fields (`ar_theme`) and form sizes (`ar_size`), which are
  presentation details of PHP themes.
