-- 답변글 (wr_reply, bbs/write.php w=r): a reply's thread is its first
-- post, and its path places it there: three digits a level, its parent's
-- path first, so a thread lists in order by it (wr_num, wr_reply).
ALTER TABLE posts ADD COLUMN thread INTEGER;
ALTER TABLE posts ADD COLUMN reply_path TEXT NOT NULL DEFAULT '';
CREATE INDEX posts_thread ON posts (thread, reply_path);
