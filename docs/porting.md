# Porting AvocadoEdition to Naru

neo-avocado is [AvocadoEdition](https://github.com/tateck-develop/AvocadoEdition)
(a GnuBoard 5 roleplay-community build) rebuilt on Naru SDK 1.1.0. Naru
replaces the PHP hosting, accounts, passwords, email verification and the SQL
server; everything a community does is here. This page maps the original's
workflows to the port, and says what was left out and why.

## Workflows

| Workflow                                              | Reference                                                                                | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Member login and profiles                             | `bbs/register*`, `mypage`                                                                | Implemented: platform membership, approval/closed admission/bans, nicknames, receive preferences; the community's own 접근차단일 (`mb_intercept_date`), 회원 삭제 (`member_delete`: nickname kept, the member's mail, 관심, money and roles removed; the Naru account is theirs) and the list's blocked and left counts; 추천인 at joining (`cf_use_recommend`, `mb_recommend`) with its points, repaid on deletion                                                          |
| Guests and public boards                              | GnuBoard level 1, `bbs/write.php` (`wr_name`, `wr_password`)                             | Implemented: level-1 boards and pages readable without sign-in; guests post, comment, edit and delete with a name and password (hashed by `ctx.passwords`, kept in the row, never answered)                                                                                                                                                                                                                                                                                  |
| Drawing logs and comments                             | `bbs/write*`, `skin/board/mmb/*`                                                         | Implemented: levels, categories, secrets, previews, character speakers, dice, calls, HTML posts (sanitized), log numbers, `@N` links, `#tags`, comment counts, links #1/#2 (`wr_link1/2`), several pictures on plain boards (`bo_upload_count`, `bo_image_width`), the new mark (`bo_new`), list order (`bo_sort_field`, but hits and votes) and titles-only lists (`bo_use_list_content`)                                                                                   |
| In-post roleplay actions                              | `skin/board/mmb/*`, `extend/mmb.lib.php`                                                 | Implemented: exploration with a Korean-day limit, explore table, item use and combination (action H), the site-wide 조합(레시피)사용 switch (`cf_5`)                                                                                                                                                                                                                                                                                                                         |
| Character profiles                                    | `mypage/character`, `adm/character_article*`                                             | Implemented: custom fields with public/owner/admin visibility, editing → submitted → approved review, main/sub/NPC, managed uploads for image fields; the owner edits, deletes, moves (by nickname) and creates any member's character (`adm/character_form*`, `character_delete.php`); 선택삭제 as a recoverable 삭제 state hidden everywhere, and 선택제거 (`character_list_update.php`)                                                                                   |
| Character relationships, couples, outfits, titles     | `mypage/character`, `couple`, `adm/title*`                                               | Implemented: relationships, wardrobe, couples, title grants, bulk grant/revoke, ownership review, title deletion cleanup                                                                                                                                                                                                                                                                                                                                                     |
| Stats, experience and ranks                           | `adm/status*`, `adm/exp*`, `adm/level*`                                                  | Implemented: allocation, recovery, official progression, rank display, owner administration                                                                                                                                                                                                                                                                                                                                                                                  |
| Shop, attendance and gacha                            | `shop`, `extend/item.lib.php`                                                            | Implemented: member flows, private history, exchange costs, owner catalog/gacha/recipe forms, 아이템 분류 (`it_category`: 일반/개인/출석, the admin list by it) and 상세이미지 (`it_1`, shown in the shop's and inventory's detail)                                                                                                                                                                                                                                          |
| Inventory use, sale, gift and crafting                | `inventory`, `adm/recipi*`                                                               | Implemented: use eligibility, sale/gift/craft, character linking, owner grants, catalog effects                                                                                                                                                                                                                                                                                                                                                                              |
| Quests                                                | `adm/quest*`                                                                             | Implemented as the reference has it (admin fields and scheduled display); the reference has no claim endpoint                                                                                                                                                                                                                                                                                                                                                                |
| Private messages and notifications                    | `bbs/memo*`, `ajax/*call*`                                                               | Implemented: mailbox, receive preference, costs, live unread notices, new-post notices, `[[nick]]` calls and comment notices (also from guests); the arrival popups of `ajax/load_memo_call.php` and `load_board_call.php`, with an optional chime after the member's first touch                                                                                                                                                                                            |
| Community administration                              | `adm/admin.menu*.php`                                                                    | Implemented: one owner-only query and mutation set per section, checked on the server as the forms are; member levels and Naru roles; moderators pin notices and move posts between boards; the board list's 선택수정/선택삭제 and 게시판 복사 (structure, or with posts); a board's 게시판 관리자 and its group's 그룹 관리자 (`bo_admin`, `gr_admin`, columns) moderate those boards only                                                                                  |
| Navigation, content, themes and emoticons             | `adm/menu*`, `adm/content*`, `adm/design*`, `adm/banner*`, `adm/intro*`, `adm/emoticon*` | Implemented: the no-design look by default (`head.php` `#no_design_gnb`, `main.php`), responsive; 디자인 사용 switches to the seeded design; two-level menus, main slides and intro, design (title, logo, backgrounds, font, colors as CSS variables; design_form.php's screen, menu, button, table, log-board and other styles as checked CSS, use_header, menu_pos, a sanitized counter), content pages, emoticons                                                         |
| Who is here, visits and activity                      | `bbs/current_connect.php`, `adm/visit_*`, `adm/action_*`                                 | Implemented: 현재접속자 (members seen in ten minutes, and where), daily visit counts with the original's breakdowns and deleting old days, activity per member and board with warnings, 100 members a page by a keyset cursor (activity, nickname, member) to the end                                                                                                                                                                                                        |
| Affiliations, races and board groups                  | `adm/side_*`, `adm/class_*`, `adm/boardgroup*`                                           | Implemented: the owner's 소속/종족 lists (free text while empty), official ones picked from them; board groups in the board picker, members-only groups for their members and moderators                                                                                                                                                                                                                                                                                     |
| Addresses, character viewer, member list by 소속      | page URLs, `member/viewer.php`, `member/index.php`, `shop/index.php`                     | Implemented: an address for every page (shareable, reloadable, back and forward), the viewer page with experience history and (opt-in) inventory and money, the member list by 소속 with 쪽지 links, shop display dates, hours and weekdays                                                                                                                                                                                                                                  |
| Page numbers, board search, Q&A and settlement boards | `lib/common.lib.php` `get_paging`, `skin/board/qna`, `skin/board/caculate`               | Implemented: numbered pages for posts, characters and the shop, in get_paging's blocks; a search over every readable post of a board, 500 a call; 최근게시물 (`bbs/new.php`) and 전체검색 (`bbs/search.php`) across the readable boards; a board's RSS feed (`bbs/rss.php`, `/rss/<board>` by a route, for public boards with RSS 보이기 on); Q&A boards with guests' secret questions opened by password; settlement boards settled by moderators with experience and money |
| My page, couples, shop front and music                | `mypage/*`, `member/exp.php`, `bbs/member_leave.php`, `couple`, `shop/skin`, `bgm.php`   | Implemented: account, own characters, own posts, experience history (recorded when the owner changes experience), leaving (soft, as the original), couple list, shop categories with NPC and greeting, YouTube background music                                                                                                                                                                                                                                              |
| Browser and server acceptance                         | Naru release checklist                                                                   | 292 unit, server and page tests, and the e2e suite on naru-dev (a real Chromium against the real edge Worker: owner, members and guests) pass                                                                                                                                                                                                                                                                                                                                |

## Not ported, with reasons

- Polls (`lib/poll.lib.php` is included but never rendered) and popup layers
  (commented out of `adm/admin.menu100.php`).
- Votes (`bo_use_good`), used only by the unused `theme/basic` skin.
- Threaded comment replies (`wr_comment_reply`), mail, SMS and captcha:
  platform plumbing, or unused by the mmb skin.
- Mail settings (`cf_email_use`, `cf_use_email_certify`, `cf_email_*`,
  `adm/mail_*`): sites cannot send email on Naru; sign-in and email
  verification are Naru's (사이트 회원 settings). 입력 금지 메일
  (`cf_prohibit_email`) has no addresses to check.
- Visitors' IP addresses (`visit_search` by IP): Naru does not give them to
  queries and mutations. Visits are counted by day, hour, browser, OS, device and
  referring site instead, and 현재접속자 lists members, not guests.
- 데이터 백업지점 설정 and 데이터 복원하기 (`adm/data_backup.php`,
  `data_restore.php`, commented out of the original's `admin.menu900.php`):
  Naru's restore points (데이터베이스 → 복원 지점: one before every release's
  migrations, one on request, downloadable, kept seven days) keep and bring
  back the whole site database, members' roles included; README's 백업과
  복원 says how. A restore of some tables alone is not offered.
- Session, cache and thumbnail file cleanup (`adm/*_file_delete.php`): Naru
  keeps none of these files.
- Guest secret posts outside Q&A boards, guest uploads and guest calls: a
  guest reads a secret post back only on a Q&A board (with its password), and
  uploads and calls need a member to answer for them.
- Inline uploads inside HTML posts: a post keeps one managed upload.
- Theme-specific fields (`ar_theme`) and form sizes (`ar_size`), which are
  presentation details of PHP themes.
- Pruning old call rows and deleting single calls: calls of deleted posts are
  hidden, not removed.
- 췩 (`bo_use_chick`, posting by uploading pictures first): a post already
  takes its picture as a managed upload in the same form.
- 글읽기 포인트 (`bo_read_point`): it would write a ledger row on every read.
- The Twitter timeline widget (`{{TWITTER}}`, `templete/txt.twitter.php`):
  the embed no longer works; the placeholder is removed from site_main.
- Deleting old mail automatically (`cf_memo_del`, 180 days): the owner prefers
  that nothing is deleted unasked; members remove mail from their own box.
- Birth year (`mb_birth`) on 계정정보: neo-avocado asks for none; the join
  date (the profile's making) is shown.

## How it is built

- **Tables**: every row the community keeps is in the site's own SQLite
  tables, which `_naru/migrations/0001`–`0011` make when the files arrive
  (the foundation, boards, characters, economy, mail and search, then the
  columns later features added). There are no
  collections, collection rules or site functions, and the owner's sign-in
  asks for no access.
- **Queries and mutations**: pages call `_naru/queries/` (read-only) and
  `_naru/mutations/` (one transaction each; `ctx.fail` or any error keeps
  nothing) by `"<module>:<export>"`. Anyone may call any of them, so each
  decides from `ctx.member` (with its Naru roles), `ctx.owner` and
  `ctx.visitor` what the caller may read and do (`_naru/modules/access.js`,
  `boards.js`). Guests' passwords are hashes `ctx.passwords` makes and checks.
- **Live queries**: nothing is pushed. Pages subscribe to a query
  (`community/inbox:status` for unread 쪽지 and calls, `community/posts:latest`
  for a board's newest post), and Naru answers again when a mutation writes a
  table it read.
- **The owner's admin**: `admin/` calls `_naru/queries/admin/` and
  `_naru/mutations/admin/`, one module per section, each refusing anyone but
  the owner. Saves are checked with the forms' own rules
  (`_naru/modules/admin-model.js`); a balance and its history, a character's
  record and its experience history, and title grants are single mutations;
  the reports count with SQL.
- **Membership**: Naru decides who may sign in (open, approval or closed, and
  bans, set on Naru's 데이터베이스 → 사이트 회원 page). The community's level
  (1–10), warnings and leaving day are the `members` table; moderators are
  the Naru role `staff` and members-only board groups the roles
  `group-<id>`.
- **Uploads** go to Naru Media (`media.upload`); rows keep their URLs. Naru's
  media library searches the site's tables when it opens and marks the
  uploads no row names 참조 없음. Nothing is deleted unasked.

## Verifying

- `npm test`: the queries and mutations against a real SQLite database with
  the migrations (`tests/sql-ctx.mjs`), one suite per area and the admin
  (`tests/admin.test.mjs`), and page behaviour against a synthetic SDK.
- `npm run test:e2e`: the whole site on naru-dev (Naru's real edge Worker,
  tables, queries, mutations and live queries) in Chromium, as an owner, two
  members and a guest.
- `tests/bench.mjs`: each screen's load time on naru-dev with network delays
  added, to see what a change costs from Korea.
