DROP INDEX IF EXISTS "embeddingIndex";
--> statement-breakpoint
ALTER TABLE "ingested_items" ALTER COLUMN "embedding" SET DATA TYPE vector(1536);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "embeddingIndex" ON "ingested_items" USING hnsw ("embedding" vector_cosine_ops);
