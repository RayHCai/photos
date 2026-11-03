-- Guest uploads now become media items as soon as they finish, in their album
-- but out of the library until the owner approves them. Additive only.

-- AlterTable
ALTER TABLE "media_items" ADD COLUMN "pending_review" BOOLEAN NOT NULL DEFAULT false;
