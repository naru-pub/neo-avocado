-- Mail: 쪽지 between members (bbs/memo_*.php, mypage/memo/), and the notes a
-- gift or money sent tells its recipient of (send_memo). Numbered by
-- AUTOINCREMENT, so a deleted message's number is never given again: a
-- page's address (#/messages/<id>) names it.

-- One message, kept for both sides: the sender's and the recipient's boxes
-- hide it on their own (GnuBoard 5.4's me_send_id / me_recv_id copies), and
-- it is deleted once both have. read_at is when the recipient first read it.
-- gift is NULL for a 쪽지 a member wrote; a gift's or money's note keeps
-- what it was for as a JSON object ({"kind": "item", "inventory": ...} or
-- {"kind": "money", "amount": ...}), and is no 쪽지 of the day's limit.
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
-- A member's inbox and unread count, and their sent box and the day's count.
CREATE INDEX messages_recipient ON messages (recipient, sent_at);
CREATE INDEX messages_sender ON messages (sender, sent_at);
