-- 접근차단일 (g5_member.mb_intercept_date): from this Korean day the
-- community treats the member as a guest, as the original refuses their
-- login (bbs/login_check.php). Naru's own ban, on its site members page,
-- keeps them from signing in at all.
ALTER TABLE members ADD COLUMN blocked_on TEXT;
