-- Members' roles, the site's own now that Naru keeps none: staff for
-- moderators, group-<id> for a members-only board group's members.
CREATE TABLE member_roles (
  member TEXT NOT NULL,
  role TEXT NOT NULL,
  PRIMARY KEY (member, role)
) WITHOUT ROWID;
CREATE INDEX member_roles_role ON member_roles (role, member);
