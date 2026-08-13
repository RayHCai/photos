-- Review remediation: indexes for the real query shapes, timestamp/zone
-- modelling, reaper + recluster safety columns.
--
-- Written by hand rather than generated: the pgvector and tsvector columns are
-- now declared in schema.prisma as Unsupported(...), so `prisma migrate diff`
-- against this migration should report no drift.

-- ─── Timeline sort ──────────────────────────────────────────
-- The only index on the sort key was ascending (taken_at), which Postgres can
-- walk backwards only as DESC NULLS FIRST — so it could not satisfy the
-- timeline's ORDER BY taken_at DESC NULLS LAST, created_at DESC, and every
-- listing degraded to a seq scan plus a full sort.
CREATE INDEX IF NOT EXISTS "media_items_taken_at_desc_idx"
    ON "media_items" ("taken_at" DESC NULLS LAST, "created_at" DESC);

CREATE INDEX IF NOT EXISTS "media_items_type_taken_at_desc_idx"
    ON "media_items" ("type", "taken_at" DESC NULLS LAST, "created_at" DESC);

-- Now redundant: covered by the composite above.
DROP INDEX IF EXISTS "media_items_taken_at_idx";
DROP INDEX IF EXISTS "media_items_type_idx";

-- ─── Duplicate check ────────────────────────────────────────
-- checkDuplicateFileNames matches on exact file_name for every upload batch and
-- had no supporting index.
CREATE INDEX IF NOT EXISTS "media_items_file_name_idx"
    ON "media_items" ("file_name");

-- ─── Ordered collection reads ───────────────────────────────
CREATE INDEX IF NOT EXISTS "collection_items_collection_sort_idx"
    ON "collection_items" ("collection_id", "sort_order");
DROP INDEX IF EXISTS "collection_items_collection_id_idx";

-- ─── Person media ───────────────────────────────────────────
-- getPersonMedia selects distinct media_item_id for a person.
CREATE INDEX IF NOT EXISTS "faces_person_media_idx"
    ON "faces" ("person_id", "media_item_id");

-- ─── Share links by collection ──────────────────────────────
CREATE INDEX IF NOT EXISTS "share_links_collection_id_idx"
    ON "share_links" ("collection_id");

-- ─── Location facets ────────────────────────────────────────
-- extractLocations runs SELECT DISTINCT city / country over the whole table.
CREATE INDEX IF NOT EXISTS "media_items_city_idx" ON "media_items" ("city")
    WHERE "city" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "media_items_country_idx" ON "media_items" ("country")
    WHERE "country" IS NOT NULL;

-- ─── Capture time modelling ─────────────────────────────────
-- taken_at holds the true UTC instant. taken_at_local holds the camera's local
-- wall clock, which is what day/month buckets are derived from so a photo does
-- not migrate between days depending on the viewer's timezone.
ALTER TABLE "media_items"
    ADD COLUMN IF NOT EXISTS "taken_at_local" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "taken_at_offset_min" INTEGER,
    ADD COLUMN IF NOT EXISTS "video_rotation" INTEGER;

-- Existing rows: the old pipeline stored the camera's local wall clock while
-- labelling it UTC, so the stored value already *is* the local wall clock.
-- Copying it across preserves current bucketing; a metadata backfill will
-- recompute both columns properly from EXIF.
UPDATE "media_items"
   SET "taken_at_local" = "taken_at"
 WHERE "taken_at" IS NOT NULL
   AND "taken_at_local" IS NULL;

-- ─── Stalled-job reaper ─────────────────────────────────────
ALTER TABLE "media_items"
    ADD COLUMN IF NOT EXISTS "processing_at" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "faces_scanned" BOOLEAN NOT NULL DEFAULT false;

-- Items that already have faces have demonstrably been scanned.
UPDATE "media_items" m
   SET "faces_scanned" = true
 WHERE EXISTS (SELECT 1 FROM "faces" f WHERE f."media_item_id" = m."id");

-- Partial index for the reaper's scan.
CREATE INDEX IF NOT EXISTS "media_items_processing_at_idx"
    ON "media_items" ("processing_at")
    WHERE "processing_status" = 'PROCESSING';

-- ─── Recluster safety ───────────────────────────────────────
-- The recluster job reassigns every non-majority face in a cluster to the modal
-- person and then hard-deletes the losers. Without a marker it cannot tell a
-- human's assignment from a machine guess, so it silently destroyed named
-- people. Faces already attached to a *named* person are treated as manual.
ALTER TABLE "faces"
    ADD COLUMN IF NOT EXISTS "manually_assigned" BOOLEAN NOT NULL DEFAULT false;

UPDATE "faces" f
   SET "manually_assigned" = true
 WHERE f."person_id" IS NOT NULL
   AND EXISTS (
       SELECT 1 FROM "persons" p
        WHERE p."id" = f."person_id" AND p."name" IS NOT NULL
   );

-- ─── Person album lifecycle ─────────────────────────────────
-- collections.person_id was ON DELETE SET NULL, so deleting a person left their
-- auto-generated album and its public share links live and reachable.
ALTER TABLE "collections"
    DROP CONSTRAINT IF EXISTS "collections_person_id_fkey";

ALTER TABLE "collections"
    ADD CONSTRAINT "collections_person_id_fkey"
    FOREIGN KEY ("person_id") REFERENCES "persons"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
