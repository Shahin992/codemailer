-- An earlier draft of 0011 added users.must_change_password; it isn't used. Remove it from databases that ran
-- that draft (on any other database the column never existed, so this does nothing).
ALTER TABLE "users" DROP COLUMN IF EXISTS "must_change_password";
