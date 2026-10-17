-- 추천인 (g5_member.mb_recommend): the member a new member named when
-- joining, while 추천인제도 사용 (cf_use_recommend) is on.
ALTER TABLE members ADD COLUMN recommender TEXT;
