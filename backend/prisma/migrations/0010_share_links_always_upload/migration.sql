-- Every share link to a user album now takes uploads, so the per-link switch
-- added in 0009 is gone. Safe to apply before or after the code that stops
-- reading it.
ALTER TABLE "share_links" DROP COLUMN "allow_uploads";
