-- 임시 저장 (g5_autosave, bbs/ajax.autosave.php): a member's drafts of a
-- post, saved as they write and opened again from the write form.
CREATE TABLE drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  saved_at INTEGER NOT NULL
);
CREATE INDEX drafts_owner ON drafts (owner, id);
