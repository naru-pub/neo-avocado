-- The foundation: who belongs to the community and the site's frame.
-- Members and their profiles, who is here and each day's visits, the
-- owner's settings and pages, and the wallets and history that joining and
-- the day's first visit pay into (the economy area adds the rest).

-- A member's standing (AvocadoEdition's g5_member): level 1–10, 2 unless the
-- owner says otherwise. Moderators are the Naru role `staff`, members-only
-- board groups the roles `group-<name>`. A member who left (member_leave.php)
-- keeps the Korean day in left_on until the owner clears it.
CREATE TABLE members (
  member TEXT PRIMARY KEY,
  level INTEGER NOT NULL DEFAULT 2,
  adult INTEGER NOT NULL DEFAULT 0,
  warnings INTEGER NOT NULL DEFAULT 0,
  warning_note TEXT NOT NULL DEFAULT '',
  left_on TEXT,
  note TEXT NOT NULL DEFAULT '',
  agreed_at INTEGER,
  requested_at INTEGER
);

-- What joining makes: the nickname posts show, and the member's own
-- preferences.
CREATE TABLE profiles (
  member TEXT PRIMARY KEY,
  nick TEXT NOT NULL UNIQUE,
  accept_messages INTEGER NOT NULL DEFAULT 1,
  comment_alerts INTEGER NOT NULL DEFAULT 1,
  calls_seen_at INTEGER,
  main_character TEXT,
  deleted_at INTEGER
);

-- 관심로그: the posts a member marked, newest (highest id) first.
CREATE TABLE favorites (
  id INTEGER PRIMARY KEY,
  member TEXT NOT NULL,
  post INTEGER NOT NULL,
  UNIQUE (member, post)
);
CREATE INDEX favorites_post ON favorites (post);

-- 현재접속자: where each member was last, and when.
CREATE TABLE presence (
  member TEXT PRIMARY KEY,
  place TEXT NOT NULL DEFAULT '',
  at INTEGER NOT NULL
);
CREATE INDEX presence_at ON presence (at);

-- 접속자 집계: a Korean day's counts; the breakdowns are JSON maps of counts.
CREATE TABLE visits (
  day TEXT PRIMARY KEY,
  total INTEGER NOT NULL DEFAULT 0,
  guests INTEGER NOT NULL DEFAULT 0,
  members TEXT NOT NULL DEFAULT '{}',
  hours TEXT NOT NULL DEFAULT '{}',
  browsers TEXT NOT NULL DEFAULT '{}',
  os TEXT NOT NULL DEFAULT '{}',
  devices TEXT NOT NULL DEFAULT '{}',
  domains TEXT NOT NULL DEFAULT '{}'
);

-- The owner's settings, one JSON row each: community (커뮤니티 설정),
-- profile (프로필 기본 항목) and design (디자인).
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '{}'
);

-- 내용 페이지 (bbs/content.php), by the ID the owner gives it (co_id);
-- site_main takes the home's place.
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

-- 메뉴 (adm/menu_list.php); a child names its parent's ID.
CREATE TABLE menus (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  link TEXT NOT NULL DEFAULT '',
  parent TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1,
  mobile INTEGER NOT NULL DEFAULT 1,
  new_window INTEGER NOT NULL DEFAULT 0
);

-- 메인 슬라이드·인트로 (adm/banner_list.php, intro_list.php). Times are
-- Korean local "YYYY-MM-DDTHH:mm", as the owner enters them.
CREATE TABLE banners (
  id TEXT PRIMARY KEY,
  place TEXT NOT NULL DEFAULT 'main',
  image TEXT NOT NULL DEFAULT '',
  mobile_image TEXT,
  alt TEXT NOT NULL DEFAULT '',
  url TEXT,
  new_window INTEGER NOT NULL DEFAULT 0,
  starts_at TEXT,
  ends_at TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1
);

-- 퀘스트 (adm/quest_list.php); images is a JSON list of addresses.
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

-- A member's money and the Korean day the login reward was last paid.
CREATE TABLE wallets (
  member TEXT PRIMARY KEY,
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  last_daily TEXT
);

-- Everything that moved a member's money, items or a character's experience.
-- What no query filters on (a gift's recipient, a grant's count) is in
-- details, a JSON object.
CREATE TABLE history (
  id INTEGER PRIMARY KEY,
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
  inventory_id TEXT,
  character_id TEXT,
  details TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX history_owner ON history (owner, kind);
CREATE INDEX history_character ON history (character_id, kind);
CREATE INDEX history_actor ON history (actor);
