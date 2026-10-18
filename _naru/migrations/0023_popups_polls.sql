-- 팝업레이어 (avo_new_win, adm/newwinlist.php, bbs/newwin.inc.php): a
-- layer over the main page between two times, for PC, mobile or both,
-- placed and sized in pixels, not shown again for so many hours once a
-- reader asks.
CREATE TABLE popups (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  device TEXT NOT NULL DEFAULT 'both',
  starts_at TEXT,
  ends_at TEXT,
  disable_hours INTEGER NOT NULL DEFAULT 24,
  left_px INTEGER NOT NULL DEFAULT 10,
  top_px INTEGER NOT NULL DEFAULT 10,
  width_px INTEGER NOT NULL DEFAULT 450,
  height_px INTEGER NOT NULL DEFAULT 500,
  enabled INTEGER NOT NULL DEFAULT 1
);

-- 설문조사 (avo_poll, adm/poll_list.php, bbs/poll_update.php): a question
-- and up to nine answers (one a line), the level that may vote (po_level),
-- the money a vote pays (po_point) and 기타의견's question (po_etc).
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
-- A member's one vote (mb_ids, po_cnt1…9).
CREATE TABLE poll_votes (
  poll_id TEXT NOT NULL,
  member TEXT NOT NULL,
  choice INTEGER NOT NULL,
  PRIMARY KEY (poll_id, member)
);
-- 기타의견 (avo_poll_etc).
CREATE TABLE poll_comments (
  id INTEGER PRIMARY KEY,
  poll_id TEXT NOT NULL,
  member TEXT NOT NULL,
  idea TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX poll_comments_poll ON poll_comments (poll_id, id);
