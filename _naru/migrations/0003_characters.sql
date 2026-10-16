-- Characters: the sheets members register (mypage/character), the owner's
-- lists they pick from and the custom fields they fill, each character's
-- official record (experience, stat points, stats, titles, purchases, the
-- day's exploration), its relations, outfits and couples, and the rank table.

-- A character sheet (AvocadoEdition's avo_character) with its official record
-- (the former character_state) in the same row. 소속 and 종족 are the names
-- picked from the owner's lists, or written freely while a list is empty,
-- so they are text, not keys. The owner's custom fields' values are one JSON
-- object by field code: nothing filters on them, and what a reader sees of
-- them is decided in code by each field's visibility. points is NULL until
-- the record is first saved: until then it is the owner's starting points
-- (initialStatPoints), as the old record was made on first use. version
-- counts writes, a page's revision.
CREATE TABLE characters (
  id INTEGER PRIMARY KEY,
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
  exp INTEGER NOT NULL DEFAULT 0,
  points INTEGER,
  stats TEXT NOT NULL DEFAULT '{}',
  active_title TEXT,
  purchases TEXT NOT NULL DEFAULT '{}',
  explore_day TEXT,
  explore_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX characters_owner ON characters (owner);
CREATE INDEX characters_state ON characters (state);
CREATE INDEX characters_name ON characters (name);

-- 프로필 항목 (adm/character_article_list.php), by the code the owner gives
-- it; options is a JSON list.
CREATE TABLE character_fields (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'text',
  options TEXT NOT NULL DEFAULT '[]',
  help TEXT NOT NULL DEFAULT '',
  suffix TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  visibility TEXT NOT NULL DEFAULT 'public',
  required INTEGER NOT NULL DEFAULT 0
);

-- 소속 and 종족 (adm/side_list.php, class_list.php): level is si_auth, the
-- member level that may pick it.
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

-- 타이틀 (adm/title_list.php); enabled is ti_use.
CREATE TABLE titles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  image TEXT,
  description TEXT NOT NULL DEFAULT ''
);

-- The titles a character holds, in the order given.
CREATE TABLE character_titles (
  id INTEGER PRIMARY KEY,
  character_id INTEGER NOT NULL,
  title_id TEXT NOT NULL,
  UNIQUE (character_id, title_id)
);
CREATE INDEX character_titles_title ON character_titles (title_id);

-- 관계 (mypage/character/relation_list.php): the source character's, kept by
-- its owner; link is addresses one per line.
CREATE TABLE relations (
  id INTEGER PRIMARY KEY,
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

-- 옷장 (mypage/character/closet.php): a character's outfits, each a 전신.
CREATE TABLE wardrobe (
  id INTEGER PRIMARY KEY,
  owner TEXT NOT NULL,
  character_id INTEGER NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  image TEXT NOT NULL DEFAULT ''
);
CREATE INDEX wardrobe_character ON wardrobe (character_id);

-- 커플 (adm/couple_list.php): two characters and the day it began.
CREATE TABLE couples (
  id TEXT PRIMARY KEY,
  first INTEGER NOT NULL,
  second INTEGER NOT NULL,
  since TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX couples_first ON couples (first);
CREATE INDEX couples_second ON couples (second);

-- 능력치 정의 (adm/status_list.php), by the key the owner gives it.
CREATE TABLE stats (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  initial INTEGER NOT NULL DEFAULT 0,
  max INTEGER NOT NULL DEFAULT 999,
  min INTEGER NOT NULL DEFAULT 0,
  help TEXT NOT NULL DEFAULT ''
);

-- 랭킹 설정 (adm/level_list.php): reaching exp adds bonus_points (lv_add_state).
CREATE TABLE levels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  exp INTEGER NOT NULL DEFAULT 0,
  bonus_points INTEGER NOT NULL DEFAULT 0
);
