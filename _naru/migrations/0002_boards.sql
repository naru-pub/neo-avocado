-- Boards: the owner's board groups and boards (adm/boardgroup_list.php,
-- board_list.php), the posts and comments written on them, their tags, the
-- calls ([[nick]]) and comment notices they send, and the emoticons comments
-- show. Posts, comments and calls are numbered by AUTOINCREMENT, so a
-- deleted row's number is never given again: favorites, calls and history
-- name them.

-- 게시판 그룹 (g5_group): a members-only group's boards (gr_use_access) are
-- for the members with the Naru role group-<id>, and the staff.
CREATE TABLE board_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  members_only INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- 게시판 (g5_board), by the ID the owner gives it (bo_table). kind is the
-- skin: image (mmb), text, qna or settlement (caculate). secret is off,
-- optional or required. What no query filters on (bo_content_head as
-- description, categories, html, actions, insertContent) is in options, a
-- JSON object.
CREATE TABLE boards (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  group_id TEXT,
  kind TEXT NOT NULL DEFAULT 'image',
  enabled INTEGER NOT NULL DEFAULT 1,
  list_level INTEGER NOT NULL DEFAULT 2,
  read_level INTEGER NOT NULL DEFAULT 2,
  write_level INTEGER NOT NULL DEFAULT 2,
  comment_level INTEGER NOT NULL DEFAULT 2,
  anonymous INTEGER NOT NULL DEFAULT 0,
  secret TEXT NOT NULL DEFAULT 'optional',
  write_reward INTEGER NOT NULL DEFAULT 0,
  comment_reward INTEGER NOT NULL DEFAULT 0,
  write_min INTEGER NOT NULL DEFAULT 0,
  write_max INTEGER NOT NULL DEFAULT 0,
  comment_min INTEGER NOT NULL DEFAULT 0,
  comment_max INTEGER NOT NULL DEFAULT 0,
  edit_lock INTEGER NOT NULL DEFAULT 1,
  page_rows INTEGER NOT NULL DEFAULT 15,
  fold_height INTEGER NOT NULL DEFAULT 600,
  options TEXT NOT NULL DEFAULT '{}'
);

-- A post (g5_write_*): number is its board's (wr_num), the board's highest
-- plus one. owner is NULL for a guest's, who signs with guest_name and
-- proves it theirs with the password guest_hash keeps. speaker (who it
-- speaks as, fixed when posted), rolls (its dice), actions (탐색, 조합, an
-- item used), settlement (정산: state, at, exp, money) and called (the
-- members it called, not to call again) are JSON. version counts writes:
-- a page's revision.
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
  speaker TEXT,
  dice INTEGER NOT NULL DEFAULT 0,
  rolls TEXT,
  actions TEXT NOT NULL DEFAULT '[]',
  called TEXT NOT NULL DEFAULT '[]',
  reward INTEGER NOT NULL DEFAULT 0,
  settlement TEXT,
  guest_name TEXT,
  guest_hash TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE (board, number)
);
-- A board's list: notices first, newest first; and by 분류. Its newest.
CREATE INDEX posts_board ON posts (board, notice, id);
CREATE INDEX posts_latest ON posts (board, id);
CREATE INDEX posts_category ON posts (board, category, notice, id);
CREATE INDEX posts_owner ON posts (owner);
CREATE INDEX posts_character ON posts (character_id);

-- A post's #tags (mmb's autolink), at most five, searched by tag.
CREATE TABLE post_tags (
  post_id INTEGER NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY (post_id, tag)
);
CREATE INDEX post_tags_tag ON post_tags (tag, post_id);

-- A comment (a g5_write_* row with wr_is_comment), the same way: a guest's
-- with guest_name and guest_hash; admin is the site owner's mark,
-- settlement a settlement's reply.
CREATE TABLE comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  owner TEXT,
  body TEXT NOT NULL DEFAULT '',
  dice INTEGER NOT NULL DEFAULT 0,
  rolls TEXT,
  anonymous INTEGER NOT NULL DEFAULT 0,
  character_id INTEGER,
  speaker TEXT,
  actions TEXT NOT NULL DEFAULT '[]',
  called TEXT NOT NULL DEFAULT '[]',
  reward INTEGER NOT NULL DEFAULT 0,
  admin INTEGER NOT NULL DEFAULT 0,
  settlement INTEGER NOT NULL DEFAULT 0,
  guest_name TEXT,
  guest_hash TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX comments_post ON comments (post_id);
CREATE INDEX comments_owner ON comments (owner);
CREATE INDEX comments_character ON comments (character_id);

-- 알림 (ajax/board_call.php's alarm table): a call ([[nick]]) or a comment
-- notice to recipient, from sender (NULL: a guest or 익명), with the nick
-- and speaker it showed and the start of the text.
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
CREATE INDEX calls_recipient ON calls (recipient);
CREATE INDEX calls_post ON calls (post_id);

-- 이모티콘: the text a comment writes (name) and the picture it shows.
CREATE TABLE emoticons (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  image TEXT NOT NULL DEFAULT ''
);
