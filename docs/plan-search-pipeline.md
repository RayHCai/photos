# Search Pipeline Enhancement Plan

> **Constraints**: CPU-only (no GPU required), no paid third-party APIs.
> **Goal**: Richer searchable metadata, faster inference, better ranking.

---

## Current State

| Component | Technology | Notes |
|---|---|---|
| Image embeddings | OpenAI CLIP ViT-B-32 (PyTorch) | 512-dim vectors, slow on CPU |
| Face detection | InsightFace buffalo_l (ONNX) | Already ONNX, but large model |
| Text search | PostgreSQL tsvector | Indexes: filename, camera, city, country, date |
| Vector search | pgvector HNSW (m=16, ef_construction=200) | Cosine similarity |
| Query parsing | chrono-node dates, name matching, location matching | Smart structured extraction |
| FTS document | `filename + camera_make + camera_model + city + country + YYYY MONTH` | Narrow — no visual content described |

**Key bottleneck**: The FTS document contains only technical metadata. There is no textual description of *what is in the image*. CLIP bridges this gap but only for semantic similarity — there's no way to do exact keyword matches on visual content (e.g., searching "dog" won't match FTS, only CLIP).

---

## Phase 1: CPU-Optimized Inference

**Problem**: PyTorch CLIP on CPU is slow (~2-5s per image). This blocks the entire pipeline.

### 1.1 — Switch CLIP to ONNX Runtime

Replace `open_clip` + PyTorch with pre-exported ONNX model running on `onnxruntime`.

**Why**: ONNX Runtime on CPU is 3-10x faster than PyTorch for inference. It supports INT8 quantization, multi-threaded execution, and platform-specific optimizations (AVX2/AVX-512) out of the box.

**What changes**:
- `worker/src/worker/clip_encoder.py` — rewrite to use `onnxruntime.InferenceSession`
- Export ViT-B-32 to ONNX (one-time, or use pre-exported from `clip-as-service` / HuggingFace)
- Preprocessing stays the same (PIL + torchvision transforms → numpy)
- Remove `torch` as a runtime dependency for CLIP (keep only for export if needed)

**Model options** (all free, no API):

| Model | Dims | ONNX CPU Speed | Accuracy | Notes |
|---|---|---|---|---|
| ViT-B-32 (current) | 512 | ~200-400ms/img | Baseline | Just convert to ONNX |
| ViT-B-16 | 512 | ~400-700ms/img | Better | Moderate upgrade |
| MobileCLIP-S2 | 512 | ~50-100ms/img | ~ViT-B-32 | Apple's mobile-optimized CLIP, best CPU perf |

**Recommendation**: Start with ONNX export of current ViT-B-32 for immediate speedup. Evaluate MobileCLIP-S2 as a follow-up — it's specifically designed for CPU and matches ViT-B-32 quality at 4-5x the speed.

**Embedding migration**: If we stay at 512 dims, no schema change needed. If we change model, all images need re-encoding (add a batch retry stage for `missing_clip` or a `clip_model_version` column to track which model generated the embedding).

```
Files to change:
  worker/src/worker/clip_encoder.py     — rewrite (ONNX inference)
  worker/src/worker/config.py           — add onnx model path settings
  worker/pyproject.toml / requirements  — swap torch → onnxruntime
  Dockerfile (worker)                   — smaller image without CUDA/torch
```

### 1.2 — Optimize InsightFace for CPU

InsightFace already uses ONNX internally, but buffalo_l is large. Options:

- **buffalo_s** (smaller variant): Faster detection, slightly lower accuracy. Good for most photo libraries.
- Explicitly set `onnxruntime` execution providers to `["CPUExecutionProvider"]` and configure thread count.
- Set `ctx_id=-1` to force CPU (already done based on CUDA availability).

```
Files to change:
  worker/src/worker/face_detect.py      — configure CPU providers explicitly
  worker/src/worker/config.py           — add face_model setting (buffalo_l vs buffalo_s)
```

### 1.3 — Pipeline Concurrency Tuning

With CPU-only inference, a single image ties up a CPU core. Adjust:

- Set `media_concurrency` based on CPU core count (e.g., `max(1, cores - 2)`)
- Consider separating I/O-bound work (S3 download, metadata extraction) from CPU-bound work (CLIP, faces) into separate thread/process pools
- Use ONNX Runtime's `intra_op_num_threads` and `inter_op_num_threads` to control parallelism per-model

---

## Phase 2: Image Captioning Pipeline

**Problem**: CLIP gives you similarity but not keywords. Searching "birthday party" only works if CLIP's latent space happens to encode that concept near your query. A caption like *"group of people around a cake with candles"* would make this searchable via FTS too.

### 2.1 — Add a Captioning Model

**Model choice**: **BLIP-base** (Salesforce) or **Florence-2-base** (Microsoft)

| Model | Size | CPU Speed | Quality | License |
|---|---|---|---|---|
| BLIP-base | ~450MB | ~1-3s/img | Good captions | BSD-3 |
| Florence-2-base | ~460MB | ~2-4s/img | Better captions + more tasks | MIT |
| GIT-base (Microsoft) | ~350MB | ~1-2s/img | Decent captions | MIT |

**Recommendation**: **Florence-2-base**. It's MIT licensed, runs on CPU via ONNX/transformers, and supports multiple tasks (captioning, OCR, object detection) from a single model — meaning we get Phase 2 and Phase 3 from one model load.

If Florence-2 is too slow on CPU, fall back to **GIT-base** (smallest, fastest, still decent).

All of these run locally via HuggingFace `transformers` — no API calls.

### 2.2 — New Worker Module: `captioner.py`

```python
# worker/src/worker/captioner.py

# Lazy-loaded model (same pattern as clip_encoder.py)
# On first call: load model + processor from HuggingFace cache
# Input:  PIL.Image
# Output: str (caption text, typically 10-30 words)
```

### 2.3 — Integrate into Pipeline

```
pipeline.py changes:

  process_photo():
    ... existing metadata, thumbnail, CLIP, face steps ...
    + caption = captioner.generate_caption(image)

  process_video():
    + caption = captioner.generate_caption(thumbnail_frame)
    (just caption the representative frame, not all frames)
```

### 2.4 — Store and Index Captions

**Database changes**:
```sql
ALTER TABLE media_items ADD COLUMN caption TEXT;
```

**FTS document update** — append caption to existing `fts_document`:
```
fts_document = filename + camera + city + country + date + caption
```

The existing PostgreSQL trigger on `fts_document` will automatically rebuild `fts_vector`.

**Search impact**: Immediate. Any FTS query now matches against caption text. Searching "dog on beach" will match a caption like *"a golden retriever playing on a sandy beach"*.

```
Files to change:
  worker/src/worker/captioner.py         — new file
  worker/src/worker/pipeline.py          — add captioning step
  worker/src/worker/backend_client.py    — include caption in persist_content()
  backend/prisma/schema.prisma           — add caption column
  backend/prisma/migrations/             — new migration
  backend/src/services/search.service.ts — caption now searchable via existing FTS path
```

---

## Phase 3: OCR Pipeline

**Problem**: Photos of documents, signs, screenshots, whiteboards — the text in them is invisible to search.

### 3.1 — Add OCR

**Options**:

| Tool | Speed | Quality | Languages | Install |
|---|---|---|---|---|
| Tesseract (pytesseract) | Fast | Good for clean text | 100+ | System package + pip |
| EasyOCR | Moderate | Better on scene text | 80+ | pip (includes models) |
| Florence-2 (OCR task) | Moderate | Good | English-focused | Already loaded if using for captions |
| PaddleOCR | Fast | Excellent | Multi-lang | pip |

**Recommendation**: If using Florence-2 for captioning, use its `<OCR>` task for free — no additional model. Otherwise, **PaddleOCR** or **Tesseract** as standalone.

### 3.2 — New Worker Module: `ocr.py`

```python
# worker/src/worker/ocr.py

# Input:  PIL.Image
# Output: str (extracted text, empty string if no text found)
# Only run if image likely contains text (optional: use a classifier or always run)
```

### 3.3 — Store and Index OCR Text

```sql
ALTER TABLE media_items ADD COLUMN ocr_text TEXT;
```

Append to `fts_document` alongside caption:
```
fts_document = filename + camera + city + country + date + caption + ocr_text
```

**Search impact**: Searching "meeting notes" or "recipe" now finds photos of handwritten notes, screenshots of recipes, etc.

```
Files to change:
  worker/src/worker/ocr.py              — new file
  worker/src/worker/pipeline.py         — add OCR step
  worker/src/worker/backend_client.py   — include ocr_text in persist_content()
  backend/prisma/schema.prisma          — add ocr_text column
  backend/prisma/migrations/            — new migration
```

---

## Phase 4: Zero-Shot Tagging (via CLIP)

**Problem**: You already have CLIP. You can use it for more than just search-time similarity.

### 4.1 — CLIP Zero-Shot Classification at Ingest Time

At processing time, compare each image's CLIP embedding against a predefined set of category text embeddings. This is purely local — encode the category labels once, then it's just a matrix multiply per image.

**Tag taxonomy** (example — customizable):

```
Scenes:    beach, mountain, forest, city, indoor, garden, park, snow, desert, underwater
Events:    wedding, birthday, concert, graduation, holiday, travel, sports, party
Objects:   car, food, pet, dog, cat, flower, book, phone, computer
People:    selfie, group photo, portrait, crowd
Mood:      sunset, night, rainy, foggy, sunny
Activities: cooking, hiking, swimming, cycling, reading, dancing
```

For each image, compute cosine similarity against all ~50-100 labels. Store tags where similarity > threshold (e.g., 0.25).

### 4.2 — Tag Storage

**Option A** — Dedicated tags table (normalized, queryable):
```sql
CREATE TABLE media_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  media_item_id UUID NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  confidence FLOAT NOT NULL,
  UNIQUE(media_item_id, tag)
);
CREATE INDEX idx_media_tags_tag ON media_tags(tag);
CREATE INDEX idx_media_tags_media ON media_tags(media_item_id);
```

**Option B** — Text array column on media_items (simpler):
```sql
ALTER TABLE media_items ADD COLUMN tags TEXT[] DEFAULT '{}';
CREATE INDEX idx_media_tags_gin ON media_items USING GIN(tags);
```

**Recommendation**: **Option B** (array column) is simpler and sufficient. GIN index supports `@>` (contains) operator for fast lookups. Add tags to `fts_document` too.

### 4.3 — Pre-compute Category Embeddings

```python
# worker/src/worker/tagger.py

CATEGORIES = ["beach", "mountain", "wedding", ...]

# On startup: encode all category labels → cache matrix (N x 512)
# Per image: dot product image_embedding @ category_matrix.T → scores
# Return tags where score > threshold
```

This is extremely fast — just a matrix multiply, no model inference per image. ~1ms per image.

### 4.4 — Search Integration

```typescript
// In search.service.ts parseQuery():
// After extracting persons/dates/locations, check for known tags
// "beach photos" → tag filter: tags @> '{beach}' + CLIP search for remaining text
```

```
Files to change:
  worker/src/worker/tagger.py           — new file
  worker/src/worker/pipeline.py         — add tagging step (after CLIP encoding)
  worker/src/worker/backend_client.py   — include tags in persist_content()
  backend/prisma/schema.prisma          — add tags column
  backend/prisma/migrations/            — new migration
  backend/src/services/search.service.ts — add tag extraction + filtering
```

---

## Phase 5: Search Ranking Improvements

### 5.1 — Hybrid Scoring (CLIP + FTS)

Currently search falls through: semantic → FTS → filters. Instead, combine scores:

```typescript
// For queries with both text and structured filters:
// 1. Run CLIP semantic search → get top N with similarity scores
// 2. Run FTS on same items → get relevance scores
// 3. Combined score = (w1 * clip_similarity) + (w2 * fts_rank)
//    where w1=0.7, w2=0.3 (tunable)

// This means "Canon beach sunset" matches both:
//   - CLIP: visual beach + sunset scene
//   - FTS: "Canon" in camera make, "beach" in caption/tags
```

**Implementation**: Single SQL query using CTE:

```sql
WITH semantic AS (
  SELECT id, 1 - (clip_embedding <=> $embedding) AS clip_score
  FROM media_items
  WHERE processing_status = 'COMPLETED'
  ORDER BY clip_embedding <=> $embedding
  LIMIT 200
),
fts AS (
  SELECT id, ts_rank(fts_vector, plainto_tsquery('english', $query)) AS fts_score
  FROM media_items
  WHERE fts_vector @@ plainto_tsquery('english', $query)
)
SELECT
  COALESCE(s.id, f.id) AS id,
  COALESCE(s.clip_score, 0) * 0.7 + COALESCE(f.fts_score, 0) * 0.3 AS score
FROM semantic s
FULL OUTER JOIN fts f ON s.id = f.id
ORDER BY score DESC
LIMIT $limit OFFSET $offset;
```

### 5.2 — Pre-Filter Before Vector Search

Current flow scans all vectors then filters. Better:

```sql
-- Instead of: scan all vectors → filter results
-- Do: filter first → scan filtered vectors

WITH candidates AS (
  SELECT id, clip_embedding
  FROM media_items
  WHERE taken_at BETWEEN $start AND $end  -- date filter narrows set
    AND type = $type                       -- type filter
    AND processing_status = 'COMPLETED'
)
SELECT id, 1 - (clip_embedding <=> $embedding) AS score
FROM candidates
ORDER BY clip_embedding <=> $embedding
LIMIT $limit;
```

**Caveat**: pgvector HNSW index only accelerates ORDER BY on the full table. Pre-filtering forces a sequential scan on the subset. This is only faster when the filter is very selective (e.g., a specific month). For broad filters, keep the current approach.

**Strategy**: Use pre-filtering when estimated result set < 10% of total, otherwise use post-filtering. Estimate via `COUNT(*)` on filters or maintain approximate counts.

### 5.3 — Boost Recent Results

For ambiguous queries, slightly boost recent photos:

```
final_score = relevance_score + (recency_weight * recency_factor)
recency_factor = 1 / (1 + days_since_taken / 365)
```

This makes "beach" favor last summer's beach photos over a decade-old one, all else being equal.

```
Files to change:
  backend/src/services/search.service.ts — hybrid scoring, pre-filtering, recency boost
```

---

## Phase 6: Database & Index Tuning

### 6.1 — HNSW Parameter Tuning

```sql
-- Current: m=16, ef_construction=200 (reasonable defaults)

-- For <50k images: current settings are fine
-- For 50k-500k images: consider m=24, ef_construction=256
-- For >500k images: consider m=32, ef_construction=400

-- Search-time tuning (most impactful):
SET hnsw.ef_search = 100;  -- Default is 40. Higher = more accurate, slower.
                           -- Sweet spot for most libraries: 64-100
```

### 6.2 — Add Composite Indexes

```sql
-- Common query pattern: completed items sorted by date
CREATE INDEX idx_media_completed_date
  ON media_items (taken_at DESC)
  WHERE processing_status = 'COMPLETED';

-- Filter by type + date (common in UI)
CREATE INDEX idx_media_type_date
  ON media_items (type, taken_at DESC)
  WHERE processing_status = 'COMPLETED';

-- Tag lookups
CREATE INDEX idx_media_tags_gin ON media_items USING GIN(tags);
```

### 6.3 — Query Embedding Cache TTL

Currently query embeddings are cached forever. If we change the CLIP model, stale embeddings would return wrong results. Add:

```sql
ALTER TABLE query_embeddings ADD COLUMN model_version TEXT NOT NULL DEFAULT 'ViT-B-32';
```

Cache lookup should match on `(text, model_version)`.

---

## Implementation Order

| Priority | Phase | Effort | Impact | Dependency |
|---|---|---|---|---|
| 1 | 2 — Image Captioning | Medium | **High** — unlocks keyword search for visual content | None |
| 2 | 4 — Zero-Shot Tagging | Low | **High** — near-free since CLIP already runs | Phase 1 helps but not required |
| 3 | 5.1 — Hybrid Scoring | Low | **Medium** — better results when captions exist | Phase 2 |
| 4 | 1 — ONNX Migration | Medium | **High** — 3-10x faster processing | None (can parallelize with Phase 2) |
| 5 | 3 — OCR | Low-Medium | **Medium** — niche but valuable for document photos | None |
| 6 | 6 — DB Tuning | Low | **Low-Medium** — marginal until library is large | None |
| 7 | 5.2 — Pre-filtering | Low | **Low** — only matters at scale | Phase 6 |

**Why captioning first**: It has the highest search quality impact. Every image gets a natural language description that feeds directly into existing FTS infrastructure. Zero marginal search cost — just better FTS documents.

**Why ONNX isn't first**: The current pipeline works on CPU, just slowly. Captioning adds new capability; ONNX makes existing capability faster. Capability > speed for a feature-focused iteration.

---

## Migration Strategy for Existing Images

All new pipeline stages need to backfill existing processed images:

1. Add a `pipeline_version` column (integer, default 1) to `media_items`
2. Each pipeline change bumps the version
3. Retry system already supports `missing_clip`, `missing_faces` filters — extend with:
   - `missing_caption` — `WHERE caption IS NULL AND processing_status = 'COMPLETED'`
   - `missing_tags` — `WHERE tags = '{}' AND processing_status = 'COMPLETED'`
   - `missing_ocr` — `WHERE ocr_text IS NULL AND processing_status = 'COMPLETED'`
   - `outdated_pipeline` — `WHERE pipeline_version < CURRENT_VERSION`
4. Add new pipeline stages: `"caption"`, `"ocr"`, `"tags"` to retry API
5. Batch retry endpoint already exists — just wire up the new filters and stages

---

## New Search Capabilities After All Phases

| Query | Before | After |
|---|---|---|
| `"dog"` | CLIP similarity only | CLIP + FTS on caption ("a dog playing in the yard") + tag match |
| `"meeting notes"` | Nothing useful | OCR text match on whiteboard/document photos |
| `"birthday"` | Weak CLIP match | Tag: "birthday" + caption: "people around a cake with candles" |
| `"Canon beach sunset"` | Either CLIP or FTS, not both | Hybrid: FTS "Canon" on camera + CLIP "beach sunset" visual |
| `"red car"` | CLIP only | CLIP + caption "a red sports car parked on a street" |
| `"recipe"` | Nothing | OCR on photo of recipe card/screenshot |
| `"indoor group photo"` | Weak CLIP | Tags: "indoor" + "group photo" + face count > 3 |

---

## Estimated Model Sizes & Memory (CPU)

| Model | Disk | RAM at Runtime | Per-Image Time (CPU) |
|---|---|---|---|
| CLIP ViT-B-32 (ONNX) | ~350MB | ~400MB | ~200-400ms |
| MobileCLIP-S2 (ONNX) | ~200MB | ~250MB | ~50-100ms |
| Florence-2-base | ~460MB | ~1GB | ~2-4s |
| GIT-base | ~350MB | ~700MB | ~1-2s |
| InsightFace buffalo_s | ~120MB | ~200MB | ~100-300ms |
| Tesseract | ~30MB | ~50MB | ~200-500ms |
| **Total (conservative)** | **~1.5GB** | **~2.5GB** | **~4-8s/image** |

All models are downloaded once and cached locally. No API calls. No GPU required.
