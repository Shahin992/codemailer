-- A super admin approves every sign-up; until then a new account can't sign in. The super admin signs in on
-- /superadmin/login and has no workspace of its own. It starts with a temporary password, changed by hand in
-- the super admin panel after the first sign-in. Only the scrypt hash of that password is stored here.
ALTER TABLE "users" ALTER COLUMN "status" SET DEFAULT 'pending';--> statement-breakpoint
-- Approving and removing accounts moves to the super admin, so earlier admins become ordinary members.
UPDATE "users" SET "role" = 'member' WHERE "role" = 'admin';--> statement-breakpoint
INSERT INTO "users" ("email", "name", "password_hash", "role", "status")
VALUES ('shahin.khan.dev@gmail.com', 'Super admin', 'scrypt$16384$8$1$qZP86OwHjX45d/K2CaK6/Q==$cGvY490t/ZhIL0/4i2PSoXBybYkfWg+4HmAGu+r2nfG4MLiXUZf1qzwHjgj/ZINX4QrZPtOI99/a8ITSxuSptQ==', 'superadmin', 'active')
ON CONFLICT ("email") DO UPDATE SET "role" = 'superadmin', "status" = 'active', "password_hash" = EXCLUDED."password_hash";
