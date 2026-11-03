-- Group buckets: guest uploads through share links land in a review queue
-- (contributions) apart from media_items, and every album gets a change log
-- (collection_events). Approved uploads remember their source album.

-- CreateEnum
CREATE TYPE "ContributionStatus" AS ENUM ('UPLOADING', 'PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'REMOVED');

-- CreateEnum
CREATE TYPE "CollectionEventType" AS ENUM ('UPLOADED', 'APPROVED', 'REJECTED', 'EXPIRED', 'REMOVED', 'ITEMS_ADDED', 'ITEMS_REMOVED', 'RENAMED', 'LINK_CREATED', 'LINK_REVOKED');

-- CreateEnum
CREATE TYPE "CollectionEventActor" AS ENUM ('OWNER', 'GUEST', 'SYSTEM');

-- AlterTable
ALTER TABLE "media_items" ADD COLUMN     "source_collection_id" TEXT;

-- AlterTable
ALTER TABLE "share_links" ADD COLUMN     "allow_uploads" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "label" TEXT;

-- CreateTable
CREATE TABLE "contributions" (
    "id" TEXT NOT NULL,
    "share_link_id" TEXT NOT NULL,
    "collection_id" TEXT NOT NULL,
    "object_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "file_size" BIGINT NOT NULL,
    "contributor_name" TEXT,
    "status" "ContributionStatus" NOT NULL DEFAULT 'UPLOADING',
    "media_item_id" TEXT,
    "uploaded_at" TIMESTAMP(3),
    "reviewed_at" TIMESTAMP(3),
    "notified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_events" (
    "id" TEXT NOT NULL,
    "collection_id" TEXT NOT NULL,
    "type" "CollectionEventType" NOT NULL,
    "actor" "CollectionEventActor" NOT NULL,
    "share_link_id" TEXT,
    "contributor_name" TEXT,
    "media_item_ids" TEXT[],
    "contribution_ids" TEXT[],
    "detail" JSONB,
    "undo_of_id" TEXT,
    "undone_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collection_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contributions_object_key_key" ON "contributions"("object_key");

-- CreateIndex
CREATE UNIQUE INDEX "contributions_media_item_id_key" ON "contributions"("media_item_id");

-- CreateIndex
CREATE INDEX "contributions_collection_id_status_uploaded_at_idx" ON "contributions"("collection_id", "status", "uploaded_at");

-- CreateIndex
CREATE INDEX "contributions_share_link_id_status_idx" ON "contributions"("share_link_id", "status");

-- CreateIndex
CREATE INDEX "contributions_status_uploaded_at_idx" ON "contributions"("status", "uploaded_at");

-- CreateIndex
CREATE INDEX "collection_events_collection_id_created_at_idx" ON "collection_events"("collection_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "collection_events_share_link_id_idx" ON "collection_events"("share_link_id");

-- AddForeignKey
ALTER TABLE "media_items" ADD CONSTRAINT "media_items_source_collection_id_fkey" FOREIGN KEY ("source_collection_id") REFERENCES "collections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_share_link_id_fkey" FOREIGN KEY ("share_link_id") REFERENCES "share_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_media_item_id_fkey" FOREIGN KEY ("media_item_id") REFERENCES "media_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_events" ADD CONSTRAINT "collection_events_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_events" ADD CONSTRAINT "collection_events_share_link_id_fkey" FOREIGN KEY ("share_link_id") REFERENCES "share_links"("id") ON DELETE SET NULL ON UPDATE CASCADE;

