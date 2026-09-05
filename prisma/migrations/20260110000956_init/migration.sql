-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "MemoryCategory" AS ENUM ('persona', 'preference', 'fact', 'context', 'instruction');

-- CreateEnum
CREATE TYPE "MemoryImportance" AS ENUM ('critical', 'high', 'medium', 'low');

-- CreateEnum
CREATE TYPE "MemorySourceType" AS ENUM ('manual', 'inferred', 'imported');

-- CreateEnum
CREATE TYPE "RelationType" AS ENUM ('related_to', 'contradicts', 'supersedes', 'supports', 'derives_from');

-- CreateTable
CREATE TABLE "memories" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "category" "MemoryCategory" NOT NULL,
    "importance" "MemoryImportance" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "source" "MemorySourceType" NOT NULL DEFAULT 'manual',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "access_count" INTEGER NOT NULL DEFAULT 0,
    "last_accessed_at" TIMESTAMP(3),
    "metadata" JSONB,
    "embedding_id" VARCHAR(255),
    "embedding" vector(1536),

    CONSTRAINT "memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memory_tags" (
    "memory_id" UUID NOT NULL,
    "tag" VARCHAR(100) NOT NULL,

    CONSTRAINT "memory_tags_pkey" PRIMARY KEY ("memory_id","tag")
);

-- CreateTable
CREATE TABLE "memory_sources" (
    "id" UUID NOT NULL,
    "memory_id" UUID NOT NULL,
    "source_type" VARCHAR(50),
    "source_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memory_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memory_extractions" (
    "id" UUID NOT NULL,
    "assignment_id" UUID,
    "status" VARCHAR(50),
    "extracted_count" INTEGER,
    "saved_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "metadata" JSONB,

    CONSTRAINT "memory_extractions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extraction_candidates" (
    "id" UUID NOT NULL,
    "extraction_id" UUID,
    "content" TEXT NOT NULL,
    "category" "MemoryCategory" NOT NULL,
    "importance" "MemoryImportance" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "suggested_tags" TEXT[],
    "source_message_ids" UUID[],
    "saved" BOOLEAN NOT NULL DEFAULT false,
    "memory_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "extraction_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memory_access_log" (
    "id" UUID NOT NULL,
    "memory_id" UUID NOT NULL,
    "assignment_id" UUID,
    "relevance_score" DOUBLE PRECISION,
    "accessed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memory_access_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collections" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_memories" (
    "collection_id" UUID NOT NULL,
    "memory_id" UUID NOT NULL,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collection_memories_pkey" PRIMARY KEY ("collection_id","memory_id")
);

-- CreateTable
CREATE TABLE "memory_relations" (
    "id" UUID NOT NULL,
    "source_memory_id" UUID NOT NULL,
    "target_memory_id" UUID NOT NULL,
    "relation_type" "RelationType" NOT NULL,
    "strength" DOUBLE PRECISION,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memory_relations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "memories_user_id_category_idx" ON "memories"("user_id", "category");

-- CreateIndex
CREATE INDEX "memories_user_id_importance_idx" ON "memories"("user_id", "importance");

-- CreateIndex
CREATE INDEX "memories_user_id_is_active_idx" ON "memories"("user_id", "is_active");

-- CreateIndex
CREATE INDEX "memories_created_at_idx" ON "memories"("created_at" DESC);

-- CreateIndex
CREATE INDEX "memories_updated_at_idx" ON "memories"("updated_at" DESC);

-- CreateIndex
CREATE INDEX "memories_embedding_id_idx" ON "memories"("embedding_id");

-- CreateIndex
CREATE INDEX "memory_tags_tag_idx" ON "memory_tags"("tag");

-- CreateIndex
CREATE INDEX "memory_sources_source_type_source_id_idx" ON "memory_sources"("source_type", "source_id");

-- CreateIndex
CREATE INDEX "memory_extractions_assignment_id_idx" ON "memory_extractions"("assignment_id");

-- CreateIndex
CREATE INDEX "extraction_candidates_extraction_id_idx" ON "extraction_candidates"("extraction_id");

-- CreateIndex
CREATE INDEX "memory_access_log_memory_id_accessed_at_idx" ON "memory_access_log"("memory_id", "accessed_at" DESC);

-- AddForeignKey
ALTER TABLE "memory_tags" ADD CONSTRAINT "memory_tags_memory_id_fkey" FOREIGN KEY ("memory_id") REFERENCES "memories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_sources" ADD CONSTRAINT "memory_sources_memory_id_fkey" FOREIGN KEY ("memory_id") REFERENCES "memories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_candidates" ADD CONSTRAINT "extraction_candidates_extraction_id_fkey" FOREIGN KEY ("extraction_id") REFERENCES "memory_extractions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_candidates" ADD CONSTRAINT "extraction_candidates_memory_id_fkey" FOREIGN KEY ("memory_id") REFERENCES "memories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_access_log" ADD CONSTRAINT "memory_access_log_memory_id_fkey" FOREIGN KEY ("memory_id") REFERENCES "memories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_memories" ADD CONSTRAINT "collection_memories_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_memories" ADD CONSTRAINT "collection_memories_memory_id_fkey" FOREIGN KEY ("memory_id") REFERENCES "memories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_relations" ADD CONSTRAINT "memory_relations_source_memory_id_fkey" FOREIGN KEY ("source_memory_id") REFERENCES "memories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_relations" ADD CONSTRAINT "memory_relations_target_memory_id_fkey" FOREIGN KEY ("target_memory_id") REFERENCES "memories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
