-- 댓글 답변 (wr_comment_reply, basic/view_comment.skin.php): a reply's
-- thread is the comment that began it, and its path places it there, three
-- digits a level, so a post's comments list in order by them.
ALTER TABLE comments ADD COLUMN thread INTEGER;
ALTER TABLE comments ADD COLUMN reply_path TEXT NOT NULL DEFAULT '';
CREATE INDEX comments_thread ON comments (post_id, thread, reply_path);
