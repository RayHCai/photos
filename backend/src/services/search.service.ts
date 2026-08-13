import * as chrono from 'chrono-node';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { redisConnection } from '../config/redis.js';
import { logger } from '../utils/logger.js';
import { toVectorLiteral } from '../utils/embeddings.js';
import { MEDIA_ITEM_SUMMARY_SELECT } from '../utils/select.js';
import { HIDDEN_EXCLUSION, HIDDEN_NOT_EXISTS } from '../utils/filters.js';

// ── Types ──────────────────────────────────────────────────────────────

interface SearchParams {
    q: string;
    page: number;
    limit: number;
    /**
     * Explicit media-type filter from the UI. This was accepted by the client and
     * threaded into the query key, but the route's zod schema did not declare it —
     * and `validate` replaces req.query with the parsed object, so zod stripped it
     * silently and the controller never saw it. Media-type filtering existed only
     * as a regex over the query text.
     */
    type?: 'PHOTO' | 'VIDEO';
}

interface SearchResult {
    id: string;
    type: string;
    file_name: string;
    thumbnail_key: string | null;
    blur_hash: string | null;
    taken_at: Date | null;
    taken_at_local: Date | null;
    created_at: Date;
    width: number | null;
    height: number | null;
    duration_seconds: number | null;
    processing_status: string;
    similarity?: number;
    rank?: number;
}

interface ParsedQuery {
    personIds: string[];
    dateRange: { start: Date; end: Date } | null;
    locations: { cities: string[]; countries: string[] };
    mediaType: 'PHOTO' | 'VIDEO' | null;
    clipText: string;
}

// ── Query Parsing ──────────────────────────────────────────────────────

function extractMediaType(query: string): { mediaType: 'PHOTO' | 'VIDEO' | null; remaining: string } {
    let remaining = query;
    let mediaType: 'PHOTO' | 'VIDEO' | null = null;

    const photoPattern = /\bphotos?\b\s*(?:of\b)?/i;
    const videoPattern = /\bvideos?\b\s*(?:of\b)?/i;

    if (photoPattern.test(remaining)) {
        mediaType = 'PHOTO';
        remaining = remaining.replace(photoPattern, ' ').trim();
    }
    else if (videoPattern.test(remaining)) {
        mediaType = 'VIDEO';
        remaining = remaining.replace(videoPattern, ' ').trim();
    }

    return { mediaType, remaining };
}

const PERSON_NAME_CACHE_KEY = 'search:person-names:v1';
const PERSON_NAME_CACHE_TTL = 300;

/**
 * Named people, cached.
 *
 * This was an unfiltered `person.findMany` on **every** search request.
 */
async function getNamedPersons(): Promise<Array<{ id: string; name: string }>> {
    const cached = await redisConnection.get(PERSON_NAME_CACHE_KEY);
    if (cached) return JSON.parse(cached) as Array<{ id: string; name: string }>;

    const rows = await prisma.person.findMany({
        where: { name: { not: null } },
        select: { id: true, name: true },
    });
    const named = rows.filter((p): p is { id: string; name: string } => p.name !== null);

    await redisConnection.setex(
        PERSON_NAME_CACHE_KEY,
        PERSON_NAME_CACHE_TTL,
        JSON.stringify(named)
    );
    return named;
}

export async function invalidatePersonNameCache() {
    await redisConnection.del(PERSON_NAME_CACHE_KEY);
}

async function extractPersons(query: string): Promise<{ personIds: string[]; remaining: string }> {
    const allPersons = await getNamedPersons();

    let remaining = query.toLowerCase();
    const personIds: string[] = [];

    // Match longest names first to handle multi-word names.
    const sorted = [...allPersons].sort((a, b) => b.name.length - a.name.length);

    for (const person of sorted) {
        const name = person.name.toLowerCase();
        /**
         * Word-boundary match rather than a bare substring.
         *
         * `includes` matched a person named "Al" inside "Alaska" or "always", and a
         * city named "Nice" inside "a nice sunset" — so unrelated queries silently
         * became person/location filters and returned nothing.
         */
        const pattern = new RegExp(`\\b${escapeRegExp(name)}\\b`, 'i');
        if (pattern.test(remaining)) {
            personIds.push(person.id);
            remaining = remaining.replace(pattern, ' ').trim();
        }
    }

    return { personIds, remaining };
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractDateRange(query: string): { dateRange: ParsedQuery['dateRange']; remaining: string } {
    const results = chrono.parse(query, new Date(), { forwardDate: false });

    if (results.length > 0) {
        const result = results[0];
        let start: Date;
        let end: Date;

        if (result.end) {
            // Explicit range like "june to august"
            start = result.start.date();
            end = result.end.date();
        }
        else {
            const known = result.start;
            const hasDay = known.isCertain('day');
            const hasMonth = known.isCertain('month');
            const d = result.start.date();

            if (hasDay) {
                // Specific day: "may 4th"
                start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
                end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
            }
            else if (hasMonth) {
                // Month-level: "june" or "january 2024"
                start = new Date(d.getFullYear(), d.getMonth(), 1);
                end = new Date(d.getFullYear(), d.getMonth() + 1, 1);
            }
            else {
                // Year-level from chrono (unlikely but handle it)
                start = new Date(d.getFullYear(), 0, 1);
                end = new Date(d.getFullYear() + 1, 0, 1);
            }
        }

        const remaining = (
            query.slice(0, result.index) + query.slice(result.index + result.text.length)
        ).trim();

        return { dateRange: { start, end }, remaining };
    }

    // Fallback: bare 4-digit year that chrono may miss
    const yearMatch = query.match(/\b(20\d{2})\b/);
    if (yearMatch) {
        const year = parseInt(yearMatch[1], 10);
        const remaining = query.replace(yearMatch[0], ' ').trim();
        return {
            dateRange: {
                start: new Date(year, 0, 1),
                end: new Date(year + 1, 0, 1),
            },
            remaining,
        };
    }

    return { dateRange: null, remaining: query };
}

const FACET_CACHE_KEY = 'search:facets:v1';
const FACET_CACHE_TTL = 600;

interface LocationFacets {
    cities: string[];
    countries: string[];
}

/**
 * Distinct city/country values used to recognise place names in a query.
 *
 * Previously a module-level variable with a 5-minute expiry and no single-flight
 * protection: every process refreshed independently, and on expiry several
 * concurrent searches each ran two `SELECT DISTINCT` full scans (neither column
 * was indexed) at the same time. Now Redis-backed so all processes share one
 * refresh, and the columns have partial indexes (migration 0007).
 */
async function getLocationValues(): Promise<LocationFacets> {
    const cached = await redisConnection.get(FACET_CACHE_KEY);
    if (cached) return JSON.parse(cached) as LocationFacets;

    const [cityRows, countryRows] = await Promise.all([
        prisma.$queryRaw<Array<{ city: string }>>`
            SELECT DISTINCT city FROM media_items WHERE city IS NOT NULL`,
        prisma.$queryRaw<Array<{ country: string }>>`
            SELECT DISTINCT country FROM media_items WHERE country IS NOT NULL`,
    ]);

    const facets: LocationFacets = {
        cities: cityRows.map((r) => r.city),
        countries: countryRows.map((r) => r.country),
    };

    await redisConnection.setex(FACET_CACHE_KEY, FACET_CACHE_TTL, JSON.stringify(facets));
    return facets;
}

export async function invalidateSearchFacets() {
    await redisConnection.del(FACET_CACHE_KEY);
}

async function extractLocations(query: string): Promise<{
    locations: ParsedQuery['locations'];
    remaining: string;
}> {
    const { cities, countries } = await getLocationValues();

    let remaining = query.toLowerCase();
    const matchedCities: string[] = [];
    const matchedCountries: string[] = [];

    // Countries first (longer names like "United States" before "States").
    // Word-boundary matched: a bare substring test made a city called "Nice" match
    // inside "a nice sunset".
    for (const country of [...countries].sort((a, b) => b.length - a.length)) {
        const pattern = new RegExp(`\\b${escapeRegExp(country.toLowerCase())}\\b`, 'i');
        if (pattern.test(remaining)) {
            matchedCountries.push(country);
            remaining = remaining.replace(pattern, ' ').trim();
        }
    }

    for (const city of [...cities].sort((a, b) => b.length - a.length)) {
        const pattern = new RegExp(`\\b${escapeRegExp(city.toLowerCase())}\\b`, 'i');
        if (pattern.test(remaining)) {
            matchedCities.push(city);
            remaining = remaining.replace(pattern, ' ').trim();
        }
    }

    return {
        locations: { cities: matchedCities, countries: matchedCountries },
        remaining,
    };
}

async function parseSearchQuery(rawQuery: string): Promise<ParsedQuery> {
    const { mediaType, remaining: r1 } = extractMediaType(rawQuery);
    const { personIds, remaining: r2 } = await extractPersons(r1);
    const { dateRange, remaining: r3 } = extractDateRange(r2);
    const { locations, remaining: r4 } = await extractLocations(r3);

    // Strip filler words left over from connecting extracted tokens
    const clipText = r4
        .replace(/\b(with|in|at|and|of|from|during|near|the)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    return { personIds, dateRange, locations, mediaType, clipText };
}

// ── SQL Helpers ────────────────────────────────────────────────────────

function buildFilterConditions(parsed: ParsedQuery): Prisma.Sql[] {
    const conditions: Prisma.Sql[] = [];

    if (parsed.personIds.length > 0) {
        conditions.push(Prisma.sql`m.id IN (
            SELECT DISTINCT f.media_item_id FROM faces f
            WHERE f.person_id IN (${Prisma.join(parsed.personIds)})
        )`);
    }

    if (parsed.dateRange) {
        conditions.push(Prisma.sql`m.taken_at >= ${parsed.dateRange.start} AND m.taken_at < ${parsed.dateRange.end}`);
    }

    const locParts: Prisma.Sql[] = [];
    if (parsed.locations.cities.length > 0) {
        locParts.push(Prisma.sql`m.city IN (${Prisma.join(parsed.locations.cities)})`);
    }
    if (parsed.locations.countries.length > 0) {
        locParts.push(Prisma.sql`m.country IN (${Prisma.join(parsed.locations.countries)})`);
    }
    if (locParts.length > 0) {
        conditions.push(Prisma.sql`(${Prisma.join(locParts, ' OR ')})`);
    }

    if (parsed.mediaType) {
        conditions.push(Prisma.sql`m.type = ${parsed.mediaType}::"MediaType"`);
    }

    return conditions;
}

/**
 * Shapes a raw row into the same DTO the rest of the API returns.
 *
 * `processingStatus` and `createdAt` are now included. They were omitted, so the
 * client fabricated them: it hard-coded `processingStatus: 'COMPLETED'` (making a
 * still-processing match render as a clickable tile that opened a permanent
 * spinner) and `createdAt: takenAt || new Date()` (filing a taken_at-null match
 * under "Today" in search but under its real upload date in the timeline).
 */
function mapSearchResult(r: SearchResult) {
    return {
        id: r.id,
        type: r.type,
        fileName: r.file_name,
        thumbnailKey: r.thumbnail_key,
        blurHash: r.blur_hash,
        width: r.width,
        height: r.height,
        durationSeconds: r.duration_seconds,
        takenAt: r.taken_at,
        takenAtLocal: r.taken_at_local,
        createdAt: r.created_at,
        processingStatus: r.processing_status,
        ...(r.similarity !== undefined && { similarity: r.similarity }),
        ...(r.rank !== undefined && { rank: r.rank }),
    };
}

// ── CLIP Embedding ─────────────────────────────────────────────────────

/**
 * Fetch (and cache) a CLIP text embedding for a query.
 *
 * Semantic search is gated on SEMANTIC_SEARCH_ENABLED rather than the `return
 * null` that used to sit at the top of this function. That early return left
 * everything below it unreachable, made `searchWithClipAndFilters` dead code, and
 * silently degraded every semantic query to FTS while the frontend still
 * advertised `searchType: 'semantic'`. It also meant the worker kept computing and
 * storing a 512-dim embedding for every photo that nothing could ever read.
 */
async function getQueryEmbedding(queryText: string): Promise<number[] | null> {
    if (!env.SEMANTIC_SEARCH_ENABLED) return null;

    // Case-insensitive so "Beach" and "beach" share one cache row; the column has
    // a unique constraint, so the key must be normalised before lookup and insert.
    const cacheKey = queryText.trim().toLowerCase();

    const cached = await prisma.$queryRaw<Array<{ embedding: string }>>`
        SELECT embedding::text AS embedding FROM query_embeddings
        WHERE query_text = ${cacheKey}
    `;

    if (cached.length > 0 && cached[0]!.embedding) {
        return JSON.parse(cached[0]!.embedding) as number[];
    }

    try {
        const response = await fetch(`${env.WORKER_URL}/embed/text`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Service-Secret': env.WORKER_SECRET,
            },
            body: JSON.stringify({ text: cacheKey }),
            signal: AbortSignal.timeout(5000),
        });

        if (!response.ok) {
            logger.warn({ status: response.status }, 'CLIP encoder returned non-OK status');
            return null;
        }

        const data = (await response.json()) as { embedding: number[] };

        if (!Array.isArray(data.embedding) || data.embedding.length !== 512) {
            logger.warn('CLIP encoder returned a malformed embedding');
            return null;
        }

        const embeddingStr = toVectorLiteral(data.embedding);
        await prisma.$executeRaw`
            INSERT INTO query_embeddings (id, query_text, embedding)
            VALUES (gen_random_uuid(), ${cacheKey}, ${embeddingStr}::vector)
            ON CONFLICT (query_text) DO UPDATE SET embedding = ${embeddingStr}::vector
        `;

        return data.embedding;
    }
    catch (error) {
        logger.warn({ error }, 'CLIP encoder unavailable, falling back to FTS');
        return null;
    }
}

// ── Search Strategies ──────────────────────────────────────────────────

/**
 * Shared projection for every raw-SQL search branch.
 *
 * This nine-column list was copied verbatim into four separate queries while a
 * fifth branch used MEDIA_ITEM_SUMMARY_SELECT, so adding a column (e.g.
 * processing_status, which the client needs and previously had to fabricate)
 * required four identical edits and the copies had already diverged in shape.
 */
const SEARCH_PROJECTION = Prisma.sql`
    m.id, m.type, m.file_name, m.thumbnail_key, m.blur_hash,
    m.taken_at, m.taken_at_local, m.created_at, m.width, m.height,
    m.duration_seconds, m.processing_status
`;

async function searchWithClipAndFilters(
    parsed: ParsedQuery,
    embedding: number[],
    limit: number,
    offset: number,
    page: number,
) {
    const embeddingStr = toVectorLiteral(embedding);
    const conditions = buildFilterConditions(parsed);
    const filterSql = conditions.length > 0
        ? Prisma.sql`AND ${Prisma.join(conditions, ' AND ')}`
        : Prisma.empty;

    /**
     * `set_config(..., is_local => true)` is transaction-scoped, and $executeRaw
     * runs standalone — so the value reverted the instant that statement committed
     * and the following query could land on a different pooled connection. ANN
     * search therefore always ran at pgvector's default ef_search regardless of
     * HNSW_EF_SEARCH. Running both statements inside one interactive transaction
     * pins them to the same connection and keeps the setting in scope.
     *
     * The candidate pool is also widened when filters are present, because the
     * filters are post-applied to the ANN result: without this a selective filter
     * returns far fewer than `limit` rows.
     */
    const candidateLimit = conditions.length > 0 ? Math.min((limit + offset) * 10, 2000) : limit + offset;

    const results = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('hnsw.ef_search', ${String(env.HNSW_EF_SEARCH)}, true)`;

        return tx.$queryRaw<SearchResult[]>`
            WITH candidates AS (
                SELECT m.id, m.clip_embedding <=> ${embeddingStr}::vector AS distance
                FROM media_items m
                WHERE m.clip_embedding IS NOT NULL
                ORDER BY m.clip_embedding <=> ${embeddingStr}::vector
                LIMIT ${candidateLimit}
            )
            SELECT ${SEARCH_PROJECTION}, 1 - c.distance AS similarity
            FROM candidates c
            JOIN media_items m ON m.id = c.id
            WHERE TRUE
              ${filterSql}
              AND ${HIDDEN_NOT_EXISTS}
            ORDER BY c.distance
            LIMIT ${limit} OFFSET ${offset}
        `;
    });

    return {
        items: results.map(mapSearchResult),
        // Approximate by construction: an ANN search has no exact total.
        total: offset + results.length + (results.length === limit ? 1 : 0),
        page,
        limit,
        searchType: 'semantic' as const,
    };
}

async function searchWithFtsAndFilters(
    parsed: ParsedQuery,
    limit: number,
    offset: number,
    page: number,
) {
    const conditions = buildFilterConditions(parsed);
    const filterSql = conditions.length > 0
        ? Prisma.sql`AND ${Prisma.join(conditions, ' AND ')}`
        : Prisma.empty;

    const [results, countResult] = await Promise.all([
        prisma.$queryRaw<SearchResult[]>`
            SELECT ${SEARCH_PROJECTION},
                   ts_rank(m.fts_vector, plainto_tsquery('english', ${parsed.clipText})) AS rank
            FROM media_items m
            WHERE m.fts_vector @@ plainto_tsquery('english', ${parsed.clipText})
              ${filterSql}
              AND ${HIDDEN_NOT_EXISTS}
            -- m.id breaks rank ties so pagination is stable; without it two pages
            -- could return the same row or skip one.
            ORDER BY rank DESC, m.id
            LIMIT ${limit} OFFSET ${offset}
        `,
        prisma.$queryRaw<[{ count: bigint }]>`
            SELECT COUNT(*) AS count FROM media_items m
            WHERE m.fts_vector @@ plainto_tsquery('english', ${parsed.clipText})
              ${filterSql}
              AND ${HIDDEN_NOT_EXISTS}
        `,
    ]);

    return {
        items: results.map(mapSearchResult),
        total: Number(countResult[0]!.count),
        page,
        limit,
        searchType: 'fts' as const,
    };
}

async function searchWithFiltersOnly(
    parsed: ParsedQuery,
    limit: number,
    offset: number,
    page: number,
) {
    const conditions = buildFilterConditions(parsed);
    const mainWhere = conditions.length > 0
        ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')} AND ${HIDDEN_NOT_EXISTS}`
        : Prisma.sql`WHERE ${HIDDEN_NOT_EXISTS}`;

    const [results, countResult] = await Promise.all([
        prisma.$queryRaw<SearchResult[]>`
            SELECT ${SEARCH_PROJECTION}
            FROM media_items m
            ${mainWhere}
            ORDER BY m.taken_at DESC NULLS LAST, m.created_at DESC, m.id
            LIMIT ${limit} OFFSET ${offset}
        `,
        prisma.$queryRaw<[{ count: bigint }]>`
            SELECT COUNT(*) AS count FROM media_items m
            ${mainWhere}
        `,
    ]);

    return {
        items: results.map(mapSearchResult),
        total: Number(countResult[0]!.count),
        page,
        limit,
        searchType: 'filter' as const,
    };
}

// ── Main Search ────────────────────────────────────────────────────────

export async function search(params: SearchParams) {
    const { q, page, limit, type } = params;
    const offset = (page - 1) * limit;

    if (!q || q.trim().length === 0) {
        const where = { ...HIDDEN_EXCLUSION, ...(type ? { type } : {}) };
        const [items, total] = await Promise.all([
            prisma.mediaItem.findMany({
                where,
                orderBy: [{ takenAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
                take: limit,
                skip: offset,
                select: MEDIA_ITEM_SUMMARY_SELECT,
            }),
            prisma.mediaItem.count({ where }),
        ]);

        return { items, total, page, limit, searchType: 'filter' as const };
    }

    const parsed = await parseSearchQuery(q);

    // An explicit UI filter wins over one inferred from the query text.
    if (type) parsed.mediaType = type;

    logger.info({
        raw: q,
        persons: parsed.personIds.length,
        dateRange: parsed.dateRange
            ? `${parsed.dateRange.start.toISOString()} → ${parsed.dateRange.end.toISOString()}`
            : null,
        cities: parsed.locations.cities,
        countries: parsed.locations.countries,
        mediaType: parsed.mediaType,
        clipText: parsed.clipText || null,
    }, 'search: parsed query');

    const hasFilters = parsed.personIds.length > 0
        || parsed.dateRange !== null
        || parsed.locations.cities.length > 0
        || parsed.locations.countries.length > 0
        || parsed.mediaType !== null;

    const hasClipText = parsed.clipText.length > 0;

    // Path 1: Descriptive text exists — try CLIP semantic search with DB filters
    if (hasClipText) {
        const embedding = await getQueryEmbedding(parsed.clipText);

        if (embedding) {
            return searchWithClipAndFilters(parsed, embedding, limit, offset, page);
        }

        // CLIP unavailable — fallback to FTS on descriptive text + DB filters
        return searchWithFtsAndFilters(parsed, limit, offset, page);
    }

    // Path 2: No descriptive text, but structured filters matched
    if (hasFilters) {
        return searchWithFiltersOnly(parsed, limit, offset, page);
    }

    /**
     * Path 3: nothing parsed — last-resort FTS on the original query.
     *
     * `total` used to be `results.length`, i.e. the length of the *current page*,
     * so a 500-match query reported "50 results" and pagination was broken. It now
     * runs a real count, and the sort has an id tiebreak so pages are stable.
     */
    const [results, countResult] = await Promise.all([
        prisma.$queryRaw<SearchResult[]>`
            SELECT ${SEARCH_PROJECTION},
                   ts_rank(m.fts_vector, plainto_tsquery('english', ${q})) AS rank
            FROM media_items m
            WHERE m.fts_vector @@ plainto_tsquery('english', ${q})
              AND ${HIDDEN_NOT_EXISTS}
            ORDER BY rank DESC, m.id
            LIMIT ${limit} OFFSET ${offset}
        `,
        prisma.$queryRaw<[{ count: bigint }]>`
            SELECT COUNT(*) AS count FROM media_items m
            WHERE m.fts_vector @@ plainto_tsquery('english', ${q})
              AND ${HIDDEN_NOT_EXISTS}
        `,
    ]);

    return {
        items: results.map(mapSearchResult),
        total: Number(countResult[0]!.count),
        page,
        limit,
        searchType: 'fts' as const,
    };
}
