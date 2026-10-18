-- neo-avocado's tables: AvocadoEdition's (install/gnuboard5.sql,
-- adm/sql_write.sql) as one SQLite schema.
--
-- Conventions: times are milliseconds since the epoch (Naru's ctx.now),
-- Korean days "YYYY-MM-DD" and the owner's schedules Korean local
-- "YYYY-MM-DDTHH:mm"; flags are 0 and 1; what no query filters on is a JSON
-- object or list in a TEXT column. A member is a Naru member ID: sign-in,
-- accounts and roles (staff for moderators, group-<id> for members-only
-- board groups) are Naru's, read in SQL as _naru_member_roles, and uploads
-- as _naru_uploads. Rows other rows or pages name by number are
-- AUTOINCREMENT, so a deleted one's number is never given again. The
-- owner's records are keyed by the IDs the owner gives them.

---------------------------------------------------------------- members --

-- A member's standing (g5_member): level 1–10, 2 unless the owner says
-- otherwise (cf_register_level). left_on is the Korean day a member left
-- (member_leave.php), kept until the owner clears it; blocked_on the day
-- their 접근차단 starts; deleted_at when the owner deleted them
-- (member_delete), for good. recommender is the 추천인's member ID.
CREATE TABLE members (
  member TEXT PRIMARY KEY,
  level INTEGER NOT NULL DEFAULT 2 CHECK (level BETWEEN 1 AND 10),
  adult INTEGER NOT NULL DEFAULT 0,
  warnings INTEGER NOT NULL DEFAULT 0,
  warning_note TEXT NOT NULL DEFAULT '',
  left_on TEXT CHECK (left_on IS NULL OR left_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  blocked_on TEXT CHECK (blocked_on IS NULL OR blocked_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  deleted_at INTEGER,
  recommender TEXT,
  note TEXT NOT NULL DEFAULT '',
  agreed_at INTEGER,
  requested_at INTEGER
);
-- 회원 정리: those who left, by when.
CREATE INDEX members_left_on ON members (left_on) WHERE left_on IS NOT NULL;

-- What joining makes (bbs/register_form_update.php): the nickname posts
-- show, unique whatever its case (as MySQL's utf8_general_ci compares it)
-- and of Hangul, letters and digits (valid_mb_nick), joined_at (mb_datetime)
-- and the member's own preferences. deleted_at hides a deleted member's
-- profile, while its nickname stays taken.
CREATE TABLE profiles (
  member TEXT PRIMARY KEY,
  nick TEXT NOT NULL UNIQUE COLLATE NOCASE
    CHECK (length(nick) BETWEEN 1 AND 20 AND nick NOT GLOB '*[^0-9A-Za-z가-힣]*'),
  joined_at INTEGER NOT NULL,
  accept_messages INTEGER NOT NULL DEFAULT 1,
  comment_alerts INTEGER NOT NULL DEFAULT 1,
  calls_seen_at INTEGER,
  main_character INTEGER,
  birth_year INTEGER CHECK (birth_year IS NULL OR birth_year BETWEEN 1900 AND 2100),
  deleted_at INTEGER
);

-- 관심로그 (g5_scrap): the posts a member marked, newest first.
CREATE TABLE favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member TEXT NOT NULL,
  post INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (member, post)
);
CREATE INDEX favorites_post ON favorites (post);

-- 현재접속자 (g5_login): where each member was last, and when.
CREATE TABLE presence (
  member TEXT PRIMARY KEY,
  place TEXT NOT NULL DEFAULT '',
  at INTEGER NOT NULL
);
CREATE INDEX presence_at ON presence (at);

-- 접속자 집계 (g5_visit_sum): a Korean day's counts; members counts each
-- member's visits, the others are JSON maps of counts.
CREATE TABLE visits (
  day TEXT PRIMARY KEY,
  total INTEGER NOT NULL DEFAULT 0,
  guests INTEGER NOT NULL DEFAULT 0,
  members TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(members)),
  hours TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(hours)),
  browsers TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(browsers)),
  os TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(os)),
  devices TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(devices)),
  domains TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(domains))
);

----------------------------------------------------------- the site ------

-- The owner's settings, one JSON row each (g5_config, avo_css_config):
-- community, profile, design and the like.
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(value))
);

-- 내용 페이지 (bbs/content.php), by its co_id; site_main is the home's.
CREATE TABLE content (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  read_level INTEGER NOT NULL DEFAULT 1,
  format TEXT NOT NULL DEFAULT 'html',
  body TEXT NOT NULL DEFAULT '',
  mobile_body TEXT NOT NULL DEFAULT '',
  header_image TEXT,
  footer_image TEXT
);

-- 메뉴 (adm/menu_list.php): a child names its parent, a top-level menu.
-- Ties in sort_order go by when each was made.
CREATE TABLE menus (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  link TEXT NOT NULL DEFAULT '',
  parent TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1,
  mobile INTEGER NOT NULL DEFAULT 1,
  new_window INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT 0
);

-- 메인 슬라이드·인트로 (adm/banner_list.php, intro_list.php), shown between
-- starts_at and ends_at.
CREATE TABLE banners (
  id TEXT PRIMARY KEY,
  place TEXT NOT NULL DEFAULT 'main',
  image TEXT NOT NULL DEFAULT '',
  mobile_image TEXT,
  alt TEXT NOT NULL DEFAULT '',
  url TEXT,
  new_window INTEGER NOT NULL DEFAULT 0,
  starts_at TEXT CHECK (starts_at IS NULL OR starts_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]*'),
  ends_at TEXT CHECK (ends_at IS NULL OR ends_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]*'),
  sort_order INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX banners_place ON banners (place, sort_order, created_at);

-- 팝업레이어 (avo_new_win), shown between starts_at and ends_at, in the
-- order they were made.
CREATE TABLE popups (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  device TEXT NOT NULL DEFAULT 'both',
  starts_at TEXT CHECK (starts_at IS NULL OR starts_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]*'),
  ends_at TEXT CHECK (ends_at IS NULL OR ends_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]*'),
  disable_hours INTEGER NOT NULL DEFAULT 24,
  left_px INTEGER NOT NULL DEFAULT 10,
  top_px INTEGER NOT NULL DEFAULT 10,
  width_px INTEGER NOT NULL DEFAULT 450,
  height_px INTEGER NOT NULL DEFAULT 500,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT 0
);

-- 설문조사 (avo_poll, avo_poll_etc): options are lines; a member's vote
-- and 기타의견.
CREATE TABLE polls (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL DEFAULT '',
  options TEXT NOT NULL DEFAULT '',
  level INTEGER NOT NULL DEFAULT 2,
  point INTEGER NOT NULL DEFAULT 0,
  etc TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE poll_votes (
  poll_id TEXT NOT NULL,
  member TEXT NOT NULL,
  choice INTEGER NOT NULL,
  PRIMARY KEY (poll_id, member)
);
CREATE TABLE poll_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  poll_id TEXT NOT NULL,
  member TEXT NOT NULL,
  idea TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX poll_comments_poll ON poll_comments (poll_id, id);

-- 이모티콘 (avo_emoticon): the text a comment writes and the picture it
-- shows, in the order they were made.
CREATE TABLE emoticons (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  image TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT 0
);

-- 퀘스트 (avo_quest); side is a 소속's name; images a JSON list.
CREATE TABLE quests (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'daily',
  side TEXT NOT NULL DEFAULT '',
  starts_at TEXT,
  ends_at TEXT,
  images TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX quests_type ON quests (type);

------------------------------------------------------------- money -------

-- A member's money (mb_point) and the Korean day the login reward was last
-- paid.
CREATE TABLE wallets (
  member TEXT PRIMARY KEY,
  balance INTEGER NOT NULL DEFAULT 0
    CHECK (typeof(balance) = 'integer' AND balance BETWEEN 0 AND 9007199254740991),
  last_daily TEXT
);

-- Everything that moved a member's money, items or a character's
-- experience (avo_point, avo_exp, avo_order): delta and balance for money,
-- exp_delta and exp for experience, character_name as it was then. What no
-- query filters on (a gift's recipient, a grant's count) is in details.
CREATE TABLE history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL,
  kind TEXT NOT NULL,
  at INTEGER NOT NULL,
  delta INTEGER,
  balance INTEGER,
  exp_delta INTEGER,
  exp INTEGER,
  memo TEXT,
  actor TEXT,
  item_id TEXT,
  inventory_id INTEGER,
  character_id INTEGER,
  character_name TEXT,
  entry_id TEXT,
  details TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(details))
);
-- A member's history, all of it or of a kind, newest first; the owner's
-- by kind, item, experience and grantor; a character's; and what a member
-- has already paid to read (글읽기 포인트, once a post).
CREATE INDEX history_owner ON history (owner, id);
CREATE INDEX history_owner_kind ON history (owner, kind, id);
CREATE INDEX history_kind ON history (kind, id);
CREATE INDEX history_item ON history (item_id);
CREATE INDEX history_exp ON history (id) WHERE exp_delta IS NOT NULL;
CREATE INDEX history_character ON history (character_id, kind);
CREATE INDEX history_actor ON history (actor);
CREATE INDEX history_read ON history (owner, kind, json_extract(details, '$.post'));

------------------------------------------------------------- boards ------

-- 게시판 그룹 (g5_group): a members-only group's boards (gr_use_access) are
-- for the members with the Naru role group-<id> and the staff; admin is
-- its 그룹 관리자; device gr_device.
CREATE TABLE board_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  members_only INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  admin TEXT,
  device TEXT NOT NULL DEFAULT 'both'
);

-- 게시판 (g5_board), by its bo_table. kind is the skin: image (mmb), text,
-- qna or settlement (caculate); secret off, optional or required; admin
-- its 게시판 관리자; sort_order bo_order. What no query filters on is in
-- options.
CREATE TABLE boards (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  group_id TEXT,
  kind TEXT NOT NULL DEFAULT 'image' CHECK (kind IN ('image', 'text', 'qna', 'settlement')),
  enabled INTEGER NOT NULL DEFAULT 1,
  list_level INTEGER NOT NULL DEFAULT 2,
  read_level INTEGER NOT NULL DEFAULT 2,
  write_level INTEGER NOT NULL DEFAULT 2,
  comment_level INTEGER NOT NULL DEFAULT 2,
  anonymous INTEGER NOT NULL DEFAULT 0,
  secret TEXT NOT NULL DEFAULT 'optional' CHECK (secret IN ('off', 'optional', 'required')),
  write_reward INTEGER NOT NULL DEFAULT 0,
  comment_reward INTEGER NOT NULL DEFAULT 0,
  write_min INTEGER NOT NULL DEFAULT 0,
  write_max INTEGER NOT NULL DEFAULT 0,
  comment_min INTEGER NOT NULL DEFAULT 0,
  comment_max INTEGER NOT NULL DEFAULT 0,
  edit_lock INTEGER NOT NULL DEFAULT 1,
  page_rows INTEGER NOT NULL DEFAULT 15,
  fold_height INTEGER NOT NULL DEFAULT 600,
  admin TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  options TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(options))
);
CREATE INDEX boards_group ON boards (group_id);

-- A post (g5_write_*): number is its board's (wr_num), the board's highest
-- plus one. owner is NULL for a guest's, who signs with guest_name and
-- proves it theirs with guest_hash. A reply (wr_reply) names its thread's
-- first post and its place under it (reply_path, three digits a level).
-- speaker, rolls, actions, settlement, called, links, files and
-- attachments are JSON. version counts writes: a page's revision.
CREATE TABLE posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  board TEXT NOT NULL,
  number INTEGER NOT NULL,
  owner TEXT,
  character_id INTEGER,
  title TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  format TEXT NOT NULL DEFAULT 'text',
  body TEXT NOT NULL DEFAULT '',
  image TEXT,
  secret INTEGER NOT NULL DEFAULT 0,
  members_only INTEGER NOT NULL DEFAULT 0,
  adult INTEGER NOT NULL DEFAULT 0,
  wide INTEGER NOT NULL DEFAULT 0,
  fold INTEGER NOT NULL DEFAULT 0,
  anonymous INTEGER NOT NULL DEFAULT 0,
  notice INTEGER NOT NULL DEFAULT 0,
  writing INTEGER NOT NULL DEFAULT 0,
  speaker TEXT,
  dice INTEGER NOT NULL DEFAULT 0,
  rolls TEXT,
  actions TEXT NOT NULL DEFAULT '[]',
  called TEXT NOT NULL DEFAULT '[]',
  links TEXT NOT NULL DEFAULT '[]',
  files TEXT NOT NULL DEFAULT '[]',
  attachments TEXT NOT NULL DEFAULT '[]',
  reward INTEGER NOT NULL DEFAULT 0,
  settlement TEXT,
  thread INTEGER,
  reply_path TEXT NOT NULL DEFAULT '',
  guest_name TEXT,
  guest_hash TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE (board, number)
);
-- A board's list as it shows (notices first, each thread newest first, its
-- replies in place), whole or by 분류, and the posts beside one (윗글·
-- 아래글); its newest; a thread's replies; a member's posts by time
-- (활동량, 글쓰기 간격); a character's; and the site's newest (최근게시물).
CREATE INDEX posts_order ON posts (board, notice DESC, coalesce(thread, id) DESC, reply_path);
CREATE INDEX posts_category_order ON posts (board, category, notice DESC, coalesce(thread, id) DESC, reply_path);
CREATE INDEX posts_neighbors ON posts (board, coalesce(thread, id), reply_path);
CREATE INDEX posts_latest ON posts (board, id);
CREATE INDEX posts_thread ON posts (thread, reply_path);
CREATE INDEX posts_owner ON posts (owner, created_at);
CREATE INDEX posts_character ON posts (character_id);
CREATE INDEX posts_created ON posts (created_at);

-- A post's #tags (mmb's autolink), at most five, searched by tag.
CREATE TABLE post_tags (
  post_id INTEGER NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY (post_id, tag)
);
CREATE INDEX post_tags_tag ON post_tags (tag, post_id);

-- 조회수 (wr_hit), 링크 연결 수 (wr_link1_hit) and 다운로드 수 (bf_download).
CREATE TABLE post_hits (
  post_id INTEGER PRIMARY KEY,
  hits INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE link_hits (
  post_id INTEGER NOT NULL,
  url TEXT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (post_id, url)
);
CREATE TABLE attachment_downloads (
  post_id INTEGER NOT NULL,
  url TEXT NOT NULL,
  downloads INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (post_id, url)
);

-- 추천·비추천 (g5_board_good): one vote a member a post, and when.
CREATE TABLE post_votes (
  post_id INTEGER NOT NULL,
  member TEXT NOT NULL,
  vote INTEGER NOT NULL CHECK (vote IN (1, -1)),
  created_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (post_id, member)
);

-- A comment (a g5_write_* row with wr_is_comment): a guest's with
-- guest_name and guest_hash; admin the site owner's mark; settlement a
-- settlement's reply; a reply (wr_comment_reply) in its thread's place.
CREATE TABLE comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  owner TEXT,
  body TEXT NOT NULL DEFAULT '',
  dice INTEGER NOT NULL DEFAULT 0,
  rolls TEXT,
  anonymous INTEGER NOT NULL DEFAULT 0,
  secret INTEGER NOT NULL DEFAULT 0,
  character_id INTEGER,
  speaker TEXT,
  actions TEXT NOT NULL DEFAULT '[]',
  called TEXT NOT NULL DEFAULT '[]',
  reward INTEGER NOT NULL DEFAULT 0,
  admin INTEGER NOT NULL DEFAULT 0,
  settlement INTEGER NOT NULL DEFAULT 0,
  thread INTEGER,
  reply_path TEXT NOT NULL DEFAULT '',
  guest_name TEXT,
  guest_hash TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
-- A post's comments as they show, and its newest; a thread's replies; a
-- member's by time; a character's; and the site's newest.
CREATE INDEX comments_order ON comments (post_id, coalesce(thread, id), reply_path);
CREATE INDEX comments_post_time ON comments (post_id, created_at);
CREATE INDEX comments_thread ON comments (thread, reply_path);
CREATE INDEX comments_owner ON comments (owner, created_at);
CREATE INDEX comments_character ON comments (character_id);
CREATE INDEX comments_created ON comments (created_at);

-- Search: trigram full-text tables of post titles and bodies and of
-- comments, by the same rowid (a 2-character word is matched with LIKE).
CREATE VIRTUAL TABLE posts_search USING fts5(title, body, tokenize = 'trigram');
CREATE VIRTUAL TABLE comments_search USING fts5(body, tokenize = 'trigram');

-- 알림 (ajax/board_call.php): a call ([[nick]]) or a comment notice to
-- recipient from sender (NULL: a guest or 익명), with the nick and speaker
-- it showed and the start of the text.
CREATE TABLE calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient TEXT NOT NULL,
  sender TEXT,
  nick TEXT NOT NULL DEFAULT '',
  speaker TEXT,
  kind TEXT NOT NULL,
  board TEXT NOT NULL,
  post_id INTEGER NOT NULL,
  comment_id INTEGER,
  preview TEXT NOT NULL DEFAULT '',
  at INTEGER NOT NULL
);
CREATE INDEX calls_recipient ON calls (recipient, id);
CREATE INDEX calls_unread ON calls (recipient, at);
CREATE INDEX calls_post ON calls (post_id);

------------------------------------------------------------- mail --------

-- 쪽지 (g5_memo), kept for both sides: each box hides it on its own, and it
-- is deleted once both have. read_at is when the recipient first read it.
-- gift is a gift's or money's note ({"kind": "item", ...}), no 쪽지 of the
-- day's limit.
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender TEXT NOT NULL,
  recipient TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  sent_at INTEGER NOT NULL,
  read_at INTEGER,
  hidden_by_sender INTEGER NOT NULL DEFAULT 0,
  hidden_by_recipient INTEGER NOT NULL DEFAULT 0,
  gift TEXT
);
-- A member's inbox and unread count, sent box and the day's count; a
-- conversation; and the old ones 쪽지 삭제 clears.
CREATE INDEX messages_recipient ON messages (recipient, sent_at);
CREATE INDEX messages_unread ON messages (recipient) WHERE read_at IS NULL AND hidden_by_recipient = 0;
CREATE INDEX messages_sender ON messages (sender, sent_at);
CREATE INDEX messages_pair ON messages (sender, recipient, id);
CREATE INDEX messages_sent_at ON messages (sent_at);

---------------------------------------------------------- characters -----

-- A character sheet (avo_character) with its official record: experience,
-- stat points (NULL until first saved: the owner's initialStatPoints),
-- stats, its title, purchases (구매 제한) and the day's 탐색. 소속 and 종족
-- are names picked from the owner's lists (or written freely while a list
-- is empty); renaming an entry renames them. fields holds the owner's
-- custom fields by code.
CREATE TABLE characters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  side TEXT NOT NULL DEFAULT '',
  class TEXT NOT NULL DEFAULT '',
  profile TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'main',
  state TEXT NOT NULL DEFAULT 'editing',
  image TEXT,
  head TEXT,
  body TEXT,
  outfit INTEGER,
  fields TEXT NOT NULL DEFAULT '{}',
  exp INTEGER NOT NULL DEFAULT 0
    CHECK (typeof(exp) = 'integer' AND exp BETWEEN 0 AND 9007199254740991),
  points INTEGER
    CHECK (points IS NULL OR (typeof(points) = 'integer' AND points BETWEEN 0 AND 9007199254740991)),
  stats TEXT NOT NULL DEFAULT '{}',
  active_title TEXT,
  purchases TEXT NOT NULL DEFAULT '{}',
  explore_day TEXT,
  explore_count INTEGER NOT NULL DEFAULT 0 CHECK (explore_count >= 0),
  created_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX characters_owner ON characters (owner);
CREATE INDEX characters_state ON characters (state);
CREATE INDEX characters_name ON characters (name);
CREATE INDEX characters_side ON characters (side);
CREATE INDEX characters_class ON characters (class);

-- 프로필 항목 (adm/character_article_list.php), by its code; options a JSON
-- list; size the input's (ar_size).
CREATE TABLE character_fields (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'text',
  options TEXT NOT NULL DEFAULT '[]',
  help TEXT NOT NULL DEFAULT '',
  suffix TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  visibility TEXT NOT NULL DEFAULT 'public',
  required INTEGER NOT NULL DEFAULT 0,
  size INTEGER NOT NULL DEFAULT 0
);

-- 소속 and 종족 (adm/side_list.php, class_list.php): level is the member
-- level that may pick it (si_auth).
CREATE TABLE sides (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  image TEXT,
  level INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE classes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  image TEXT,
  level INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- 타이틀 (avo_title) and the titles each character holds, in order.
CREATE TABLE titles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  image TEXT,
  description TEXT NOT NULL DEFAULT ''
);
CREATE TABLE character_titles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id INTEGER NOT NULL,
  title_id TEXT NOT NULL,
  UNIQUE (character_id, title_id)
);
CREATE INDEX character_titles_title ON character_titles (title_id);

-- 관계 (avo_relation_character): the source character's, kept by its
-- owner; link is addresses one per line.
CREATE TABLE relations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL,
  character_id INTEGER NOT NULL,
  target INTEGER NOT NULL,
  affinity INTEGER NOT NULL DEFAULT 0,
  memo TEXT NOT NULL DEFAULT '',
  link TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX relations_character ON relations (character_id);
CREATE INDEX relations_target ON relations (target);

-- 옷장 (avo_character_closthes): a character's outfits, each a 전신.
CREATE TABLE wardrobe (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL,
  character_id INTEGER NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  image TEXT NOT NULL DEFAULT ''
);
CREATE INDEX wardrobe_character ON wardrobe (character_id);

-- 커플 (avo_couple): two characters and the day it began.
CREATE TABLE couples (
  id TEXT PRIMARY KEY,
  first INTEGER NOT NULL,
  second INTEGER NOT NULL,
  since TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  CHECK (first != second)
);
CREATE INDEX couples_first ON couples (first);
CREATE INDEX couples_second ON couples (second);

-- 능력치 정의 (avo_status), by its key, in sort_order (st_order); use_max
-- is st_use_max.
CREATE TABLE stats (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  initial INTEGER NOT NULL DEFAULT 0,
  max INTEGER NOT NULL DEFAULT 999,
  min INTEGER NOT NULL DEFAULT 0,
  help TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  use_max INTEGER NOT NULL DEFAULT 0
);

-- 랭킹 설정 (avo_level_setting): reaching exp adds bonus_points.
CREATE TABLE levels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  exp INTEGER NOT NULL DEFAULT 0,
  bonus_points INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX levels_exp ON levels (exp);

------------------------------------------------------------ the shop -----

-- 아이템 (avo_item) with its shop listing (avo_shop), by its ID. category
-- is it_category, item_type it_type; display (진열 기간), effect (사용
-- 효과), requirements (구매 조건) and use_requirements (사용 조건) are JSON.
-- stock NULL is no limit, sell_price NULL not for sale back; a personal
-- item (개인 아이템 제작권) is hidden from the shop. Deleting an item
-- deletes its copies, listings, draws and recipes.
CREATE TABLE items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  effect_description TEXT NOT NULL DEFAULT '',
  shop_talk TEXT NOT NULL DEFAULT '',
  image TEXT,
  detail_image TEXT,
  category TEXT NOT NULL DEFAULT 'general',
  item_type TEXT NOT NULL DEFAULT '',
  shop_category TEXT NOT NULL DEFAULT '',
  display TEXT,
  price INTEGER NOT NULL DEFAULT 0 CHECK (typeof(price) = 'integer' AND price >= 0),
  stock INTEGER CHECK (stock IS NULL OR (typeof(stock) = 'integer' AND stock >= 0)),
  sell_price INTEGER CHECK (sell_price IS NULL OR (typeof(sell_price) = 'integer' AND sell_price >= 0)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  sellable INTEGER NOT NULL DEFAULT 1,
  giftable INTEGER NOT NULL DEFAULT 1,
  usable INTEGER NOT NULL DEFAULT 1,
  usable_in_posts INTEGER NOT NULL DEFAULT 0,
  craft_material INTEGER NOT NULL DEFAULT 0,
  reusable INTEGER NOT NULL DEFAULT 0,
  effect TEXT,
  requirements TEXT NOT NULL DEFAULT '{}',
  use_requirements TEXT NOT NULL DEFAULT '{}',
  personal INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX items_hidden ON items (hidden);
CREATE INDEX items_category ON items (category);

-- 상점 진열 (avo_shop): an item sold again in another category or on other
-- terms.
CREATE TABLE shop_entries (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  shop_category TEXT NOT NULL DEFAULT '',
  shop_talk TEXT NOT NULL DEFAULT '',
  display TEXT,
  price INTEGER NOT NULL DEFAULT 0 CHECK (typeof(price) = 'integer' AND price >= 0),
  stock INTEGER CHECK (stock IS NULL OR (typeof(stock) = 'integer' AND stock >= 0)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  requirements TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX shop_entries_item ON shop_entries (item_id);

-- 인벤토리 (avo_inventory): one row a copy, the member's own or one of
-- their characters'. origin is how it came (shop, gacha, craft, explore,
-- item, personal, admin); gift a gift's sender, senderName, memo and
-- receivedAt, or the owner's 지급 사유 as memo.
CREATE TABLE inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL,
  item_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL DEFAULT '',
  character_id INTEGER,
  gift TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX inventory_owner ON inventory (owner, character_id, item_id);
CREATE INDEX inventory_character ON inventory (character_id, item_id);
CREATE INDEX inventory_item ON inventory (item_id);

-- 레시피 (avo_item_recepi): what it makes, for how much, and its materials.
CREATE TABLE recipes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  item_id TEXT NOT NULL,
  cost INTEGER NOT NULL DEFAULT 0 CHECK (typeof(cost) = 'integer' AND cost >= 0),
  hidden INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX recipes_hidden ON recipes (hidden);
CREATE INDEX recipes_item ON recipes (item_id);
CREATE TABLE recipe_ingredients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  count INTEGER NOT NULL CHECK (typeof(count) = 'integer' AND count > 0),
  UNIQUE (recipe_id, item_id)
);
CREATE INDEX recipe_ingredients_item ON recipe_ingredients (item_id);

-- 뽑기 표: a draw ticket's rows (source, the ticket's item) or the paid
-- gacha's (source NULL), each its item (NULL: 꽝) and weight; 탐색 표 what
-- exploring finds (avo_item_explorer).
CREATE TABLE gacha (
  id TEXT PRIMARY KEY,
  source TEXT,
  item_id TEXT,
  weight REAL NOT NULL DEFAULT 1 CHECK (typeof(weight) IN ('integer', 'real') AND weight >= 0 AND weight <= 1e12)
);
CREATE INDEX gacha_source ON gacha (source);
CREATE INDEX gacha_item ON gacha (item_id);
CREATE TABLE explore (
  id TEXT PRIMARY KEY,
  item_id TEXT,
  weight REAL NOT NULL DEFAULT 1 CHECK (typeof(weight) IN ('integer', 'real') AND weight >= 0 AND weight <= 1e12)
);
CREATE INDEX explore_item ON explore (item_id);
