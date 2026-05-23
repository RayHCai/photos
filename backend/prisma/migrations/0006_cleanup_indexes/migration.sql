-- Drop redundant indexes (already covered by UNIQUE constraints)
DROP INDEX IF EXISTS "sessions_token_idx";
DROP INDEX IF EXISTS "share_links_slug_idx";

-- Add missing index on collection_items.media_item_id
CREATE INDEX "collection_items_media_item_id_idx" ON "collection_items"("media_item_id");
