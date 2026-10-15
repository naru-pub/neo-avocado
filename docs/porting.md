# Porting AvocadoEdition to Naru

neo-avocado is [AvocadoEdition](https://github.com/tateck-develop/AvocadoEdition)
(a GnuBoard 5 roleplay-community build) rebuilt on Naru SDK 1.1.0. Naru
replaces the PHP hosting, accounts, passwords, email verification and the SQL
server; everything a community does is here. This page maps the original's
workflows to the port, and says what was left out and why.

## Workflows

| Workflow                                          | Reference                                                                                | Status                                                                                                                                                                                                                                                                          |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Member login and profiles                         | `bbs/register*`, `mypage`                                                                | Implemented: platform membership, approval/closed admission/bans, nicknames, receive preferences                                                                                                                                                                                |
| Guests and public boards                          | GnuBoard level 1, `bbs/write.php` (`wr_name`, `wr_password`)                             | Implemented: level-1 boards and pages readable without sign-in; guests post, comment, edit and delete with a name and password (PBKDF2 via `ctx.password`, hashes kept apart)                                                                                                   |
| Drawing logs and comments                         | `bbs/write*`, `skin/board/mmb/*`                                                         | Implemented: levels, categories, secrets, previews, character speakers, dice, calls, HTML posts (sanitized), log numbers, `@N` links, `#tags`, comment counts                                                                                                                   |
| In-post roleplay actions                          | `skin/board/mmb/*`, `extend/mmb.lib.php`                                                 | Implemented: exploration with a Korean-day limit, explore table, item use and combination (action H)                                                                                                                                                                            |
| Character profiles                                | `mypage/character`, `adm/character_article*`                                             | Implemented: custom fields with public/owner/admin visibility, editing → submitted → approved review, main/sub/NPC, managed uploads for image fields                                                                                                                            |
| Character relationships, couples, outfits, titles | `mypage/character`, `couple`, `adm/title*`                                               | Implemented: relationships, wardrobe, couples, title grants, bulk grant/revoke, ownership review, title deletion cleanup                                                                                                                                                        |
| Stats, experience and ranks                       | `adm/status*`, `adm/exp*`, `adm/level*`                                                  | Implemented: allocation, recovery, official progression, rank display, owner administration                                                                                                                                                                                     |
| Shop, attendance and gacha                        | `shop`, `extend/item.lib.php`                                                            | Implemented: member flows, private history, exchange costs, owner catalog/gacha/recipe forms                                                                                                                                                                                    |
| Inventory use, sale, gift and crafting            | `inventory`, `adm/recipi*`                                                               | Implemented: use eligibility, sale/gift/craft, character linking, owner grants, catalog effects                                                                                                                                                                                 |
| Quests                                            | `adm/quest*`                                                                             | Implemented as the reference has it (admin fields and scheduled display); the reference has no claim endpoint                                                                                                                                                                   |
| Private messages and notifications                | `bbs/memo*`, `ajax/*call*`                                                               | Implemented: mailbox, receive preference, costs, live unread notices, new-post notices, `[[nick]]` calls and comment notices (also from guests)                                                                                                                                 |
| Community administration                          | `adm/admin.menu*.php`                                                                    | Implemented: member status/roles, catalog/economy, cleanup recovery; moderators pin notices and move posts between boards                                                                                                                                                       |
| Navigation, content, themes and emoticons         | `adm/menu*`, `adm/content*`, `adm/design*`, `adm/banner*`, `adm/intro*`, `adm/emoticon*` | Implemented: the no-design look by default (`head.php` `#no_design_gnb`, `main.php`), responsive; 디자인 사용 switches to the seeded design; two-level menus, main slides and intro, design (title, logo, backgrounds, font, colors as CSS variables), content pages, emoticons |
| My page, couples, shop front and music            | `mypage/*`, `member/exp.php`, `bbs/member_leave.php`, `couple`, `shop/skin`, `bgm.php`   | Implemented: account, own characters, own posts, experience history (recorded when the owner changes experience), leaving (soft, as the original), couple list, shop categories with NPC and greeting, YouTube background music                                                 |
| Browser and server acceptance                     | Naru release checklist                                                                   | 106 unit and page tests, and the e2e suite on naru-dev (a real Chromium against the real edge Worker: owner, members and guests) pass                                                                                                                                           |

## Not ported, with reasons

- Polls (`lib/poll.lib.php` is included but never rendered) and popup layers
  (commented out of `adm/admin.menu100.php`).
- Votes (`bo_use_good`), used only by the unused `theme/basic` skin.
- Threaded comment replies (`wr_comment_reply`), visitor statistics, mail,
  SMS, RSS and captcha: platform plumbing, or unused by the mmb skin.
- Guest secret posts, guest uploads and guest calls: a guest could never read
  a secret post back, and uploads and calls need a member to answer for them.
- Inline uploads inside HTML posts: a post keeps one managed upload.
- Theme-specific fields (`ar_theme`) and form sizes (`ar_size`), which are
  presentation details of PHP themes.
- Pruning old call rows and deleting single calls: calls of deleted posts are
  hidden, not removed.

## How it is built

- **Collections** are declared in `_naru/collections.json`, which Naru
  installs when the files arrive: logs and comments readable by members (and visitors, on level-1
  boards) through the `community-board` rule, characters through the
  `characters` rule (which trims custom fields a reader may not see), profiles
  with unique nicknames, and everything else admin-only.
- **Reads** of logs, comments and characters are native SDK reads filtered by
  those rules. **Writes**, cascades and the economy run in site functions
  (`_naru/functions/`), each in one transaction; functions declared read-only
  use the read budget.
- **SDK 1.1.0 features used**: platform membership (approval, bans), member and
  visitor site functions, collection rules with `present`/`queryable`, document
  secrets (guest passwords as hashes nobody can read), managed uploads (a
  deleted post or character takes its pictures with it), `has` for `#tag`
  search, live notices and broadcasts, and naru-dev for local testing.
- **Membership**: Naru decides who may sign in (open, approval or closed, and
  bans, set on Naru's 데이터베이스 → 사이트 회원 page); the community's own
  roles and board levels live in `neo_avocado_members`.

## Verifying

- `npm test`: page behaviour against an in-memory SDK, and every site function
  against a fake `ctx`.
- `npm run test:e2e`: the whole site on naru-dev (Naru's real edge Worker, rules
  and functions) in Chromium, as an owner, two members and a guest.
- `tests/bench.mjs`: each screen's load time on naru-dev with network delays
  added, to see what a change costs from Korea.
