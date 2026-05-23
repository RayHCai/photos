-- AlterTable
ALTER TABLE "collections" ADD COLUMN "system_type" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "collections_system_type_key" ON "collections"("system_type");
