-- 비밀 댓글 (wr_option secret, bbs/view_comment.php): a comment only the
-- staff, the post's writer and its own writer read.
ALTER TABLE comments ADD COLUMN secret INTEGER NOT NULL DEFAULT 0;
