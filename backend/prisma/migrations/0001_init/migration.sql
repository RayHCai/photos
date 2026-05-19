-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Add CLIP embedding column to media_items
ALTER TABLE media_items ADD COLUMN clip_embedding vector(512);

-- Add face embedding column to faces
ALTER TABLE faces ADD COLUMN face_embedding vector(512);

-- Add query embedding column to query_embeddings
ALTER TABLE query_embeddings ADD COLUMN embedding vector(512);

-- Create HNSW indexes for fast ANN search
CREATE INDEX idx_media_clip_embedding_hnsw
    ON media_items USING hnsw (clip_embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 200);

CREATE INDEX idx_face_embedding_hnsw
    ON faces USING hnsw (face_embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 200);

-- Full-text search: add tsvector column and GIN index
ALTER TABLE media_items ADD COLUMN fts_vector tsvector;

CREATE INDEX idx_media_fts ON media_items USING gin(fts_vector);

-- Trigger to auto-update fts_vector when fts_document changes
CREATE OR REPLACE FUNCTION media_fts_update() RETURNS trigger AS $$
BEGIN
    NEW.fts_vector := to_tsvector('english', COALESCE(NEW.fts_document, ''));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_media_fts_update
    BEFORE INSERT OR UPDATE OF fts_document ON media_items
    FOR EACH ROW EXECUTE FUNCTION media_fts_update();
