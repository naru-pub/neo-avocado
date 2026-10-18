-- 출생년도 (mb_birth, register_form.skin.php:75): the year a member gives,
-- shown on their 계정정보 as "( 1999 년생 )".
ALTER TABLE profiles ADD COLUMN birth_year INTEGER;
