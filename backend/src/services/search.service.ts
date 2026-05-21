import * as chrono from 'chrono-node';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { toVectorLiteral } from '../utils/embeddings.js';
import { MEDIA_ITEM_SUMMARY_SELECT } from '../utils/select.js';

// ── Types ──────────────────────────────────────────────────────────────

interface SearchParams {
    q: string;
    page: number;
    limit: number;
}

interface SearchResult {
    id: string;
    type: string;
    file_name: string;
    thumbnail_key: string | null;
    blur_hash: string | null;
    taken_at: Date | null;
    width: number | null;
    height: number | null;
    duration_seconds: number | null;
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
    } else if (videoPattern.test(remaining)) {
        mediaType = 'VIDEO';
        remaining = remaining.replace(videoPattern, ' ').trim();
    }

    return { mediaType, remaining };
}

async function extractPersons(query: string): Promise<{ personIds: string[]; remaining: string }> {
    const allPersons = await prisma.person.findMany({
        where: { name: { not: null } },
        select: { id: true, name: true },
    });

    let remaining = query.toLowerCase();
    const personIds: string[] = [];

    // Match longest names first to handle multi-word names
    const sorted = allPersons
        .filter((p): p is { id: string; name: string } => p.name !== null)
        .sort((a, b) => b.name.length - a.name.length);

    for (const person of sorted) {
        if (remaining.includes(person.name.toLowerCase())) {
            personIds.push(person.id);
            remaining = remaining.replace(person.name.toLowerCase(), ' ').trim();
        }
    }

    return { personIds, remaining };
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
        } else {
            const known = result.start;
            const hasDay = known.isCertain('day');
            const hasMonth = known.isCertain('month');
            const d = result.start.date();

            if (hasDay) {
                // Specific day: "may 4th"
                start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
                end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
            } else if (hasMonth) {
                // Month-level: "june" or "january 2024"
                start = new Date(d.getFullYear(), d.getMonth(), 1);
                end = new Date(d.getFullYear(), d.getMonth() + 1, 1);
            } else {
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

// Location cache (refreshes every 5 minutes)
let locationCache: { cities: string[]; countries: string[]; expiresAt: number } | null = null;

async function getLocationValues() {
    if (locationCache && Date.now() < locationCache.expiresAt) {
        return locationCache;
    }
    const [cityRows, countryRows] = await Promise.all([
        prisma.$queryRaw<Array<{ city: string }>>`
            SELECT DISTINCT city FROM media_items WHERE city IS NOT NULL`,
        prisma.$queryRaw<Array<{ country: string }>>`
            SELECT DISTINCT country FROM media_items WHERE country IS NOT NULL`,
    ]);
    locationCache = {
        cities: cityRows.map((r) => r.city),
        countries: countryRows.map((r) => r.country),
        expiresAt: Date.now() + 5 * 60 * 1000,
    };
    return locationCache;
}

async function extractLocations(query: string): Promise<{
    locations: ParsedQuery['locations'];
    remaining: string;
}> {
    const { cities, countries } = await getLocationValues();

    let remaining = query.toLowerCase();
    const matchedCities: string[] = [];
    const matchedCountries: string[] = [];

    // Match countries first (longer names like "United States" before "States")
    for (const country of [...countries].sort((a, b) => b.length - a.length)) {
        if (remaining.includes(country.toLowerCase())) {
            matchedCountries.push(country);
            remaining = remaining.replace(country.toLowerCase(), ' ').trim();
        }
    }

    for (const city of [...cities].sort((a, b) => b.length - a.length)) {
        if (remaining.includes(city.toLowerCase())) {
            matchedCities.push(city);
            remaining = remaining.replace(city.toLowerCase(), ' ').trim();
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

function buildFilterClauses(parsed: ParsedQuery, paramOffset: number) {
    const clauses: string[] = [];
    const params: unknown[] = [];
    let idx = paramOffset;

    if (parsed.personIds.length > 0) {
        const placeholders = parsed.personIds.map(() => `$${idx++}`).join(',');
        clauses.push(`m.id IN (
            SELECT DISTINCT f.media_item_id FROM faces f
            WHERE f.person_id IN (${placeholders})
        )`);
        params.push(...parsed.personIds);
    }

    if (parsed.dateRange) {
        clauses.push(`m.taken_at >= $${idx++} AND m.taken_at < $${idx++}`);
        params.push(parsed.dateRange.start, parsed.dateRange.end);
    }

    const locParts: string[] = [];
    if (parsed.locations.cities.length > 0) {
        const placeholders = parsed.locations.cities.map(() => `$${idx++}`).join(',');
        locParts.push(`m.city IN (${placeholders})`);
        params.push(...parsed.locations.cities);
    }
    if (parsed.locations.countries.length > 0) {
        const placeholders = parsed.locations.countries.map(() => `$${idx++}`).join(',');
        locParts.push(`m.country IN (${placeholders})`);
        params.push(...parsed.locations.countries);
    }
    if (locParts.length > 0) {
        clauses.push(`(${locParts.join(' OR ')})`);
    }

    if (parsed.mediaType) {
        clauses.push(`m.type = $${idx++}::"MediaType"`);
        params.push(parsed.mediaType);
    }

    return { clauses, params };
}

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
        ...(r.similarity != null && { similarity: r.similarity }),
        ...(r.rank != null && { rank: r.rank }),
    };
}

// ── CLIP Embedding ─────────────────────────────────────────────────────

async function getQueryEmbedding(queryText: string): Promise<number[] | null> {
    const cached = await prisma.$queryRaw<Array<{ embedding: string }>>`
        SELECT embedding::text FROM query_embeddings
        WHERE query_text = ${queryText}
    `;

    if (cached.length > 0 && cached[0].embedding) {
        logger.debug({ queryText }, 'search: CLIP embedding cache hit');
        return JSON.parse(cached[0].embedding);
    }

    try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (env.WORKER_SECRET) {
            headers['X-Service-Secret'] = env.WORKER_SECRET;
        }

        const response = await fetch(`${env.WORKER_URL}/embed/text`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ text: queryText }),
            signal: AbortSignal.timeout(5000),
        });

        if (!response.ok) {
            logger.warn('CLIP encoder returned non-OK status');
            return null;
        }

        const data = await response.json() as { embedding: number[] };

        const embeddingStr = toVectorLiteral(data.embedding);
        await prisma.$executeRaw`
            INSERT INTO query_embeddings (id, query_text, embedding)
            VALUES (gen_random_uuid(), ${queryText}, ${embeddingStr}::vector)
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

async function searchWithClipAndFilters(
    parsed: ParsedQuery,
    embedding: number[],
    limit: number,
    offset: number,
    page: number,
) {
    const embeddingStr = toVectorLiteral(embedding);
    // $1 = embedding, $2 = limit, $3 = offset, filters start at $4
    const { clauses, params: filterParams } = buildFilterClauses(parsed, 4);
    const whereExtra = clauses.length > 0 ? `AND ${clauses.join(' AND ')}` : '';

    await prisma.$executeRaw`SELECT set_config('hnsw.ef_search', ${String(env.HNSW_EF_SEARCH)}, true)`;

    const results = await prisma.$queryRawUnsafe<SearchResult[]>(
        `SELECT m.id, m.type, m.file_name, m.thumbnail_key, m.blur_hash,
                m.taken_at, m.width, m.height, m.duration_seconds,
                1 - (m.clip_embedding <=> $1::vector) AS similarity
         FROM media_items m
         WHERE m.clip_embedding IS NOT NULL
           ${whereExtra}
         ORDER BY m.clip_embedding <=> $1::vector
         LIMIT $2 OFFSET $3`,
        embeddingStr, limit, offset, ...filterParams,
    );

    return {
        items: results.map(mapSearchResult),
        total: results.length,
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
    // $1 = ftsQuery, $2 = limit, $3 = offset, filters start at $4
    const { clauses, params: filterParams } = buildFilterClauses(parsed, 4);
    const whereExtra = clauses.length > 0 ? `AND ${clauses.join(' AND ')}` : '';

    const results = await prisma.$queryRawUnsafe<SearchResult[]>(
        `SELECT m.id, m.type, m.file_name, m.thumbnail_key, m.blur_hash,
                m.taken_at, m.width, m.height, m.duration_seconds,
                ts_rank(m.fts_vector, plainto_tsquery('english', $1)) AS rank
         FROM media_items m
         WHERE m.fts_vector @@ plainto_tsquery('english', $1)
           ${whereExtra}
         ORDER BY rank DESC
         LIMIT $2 OFFSET $3`,
        parsed.clipText, limit, offset, ...filterParams,
    );

    return {
        items: results.map(mapSearchResult),
        total: results.length,
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
    // Main query: $1 = limit, $2 = offset, filters start at $3
    const { clauses: mainClauses, params: mainParams } = buildFilterClauses(parsed, 3);
    const mainWhere = mainClauses.length > 0 ? `WHERE ${mainClauses.join(' AND ')}` : '';

    // Count query: filters start at $1
    const { clauses: countClauses, params: countParams } = buildFilterClauses(parsed, 1);
    const countWhere = countClauses.length > 0 ? `WHERE ${countClauses.join(' AND ')}` : '';

    const [results, countResult] = await Promise.all([
        prisma.$queryRawUnsafe<SearchResult[]>(
            `SELECT m.id, m.type, m.file_name, m.thumbnail_key, m.blur_hash,
                    m.taken_at, m.width, m.height, m.duration_seconds
             FROM media_items m
             ${mainWhere}
             ORDER BY m.taken_at DESC NULLS LAST, m.created_at DESC
             LIMIT $1 OFFSET $2`,
            limit, offset, ...mainParams,
        ),
        prisma.$queryRawUnsafe<[{ count: bigint }]>(
            `SELECT COUNT(*) AS count FROM media_items m ${countWhere}`,
            ...countParams,
        ),
    ]);

    return {
        items: results.map(mapSearchResult),
        total: Number(countResult[0].count),
        page,
        limit,
        searchType: 'filter' as const,
    };
}

// ── Main Search ────────────────────────────────────────────────────────

export async function search(params: SearchParams) {
    const { q, page, limit } = params;
    const offset = (page - 1) * limit;

    if (!q || q.trim().length === 0) {
        const [items, total] = await Promise.all([
            prisma.mediaItem.findMany({
                orderBy: [{ takenAt: 'desc' }, { createdAt: 'desc' }],
                take: limit,
                skip: offset,
                select: MEDIA_ITEM_SUMMARY_SELECT,
            }),
            prisma.mediaItem.count(),
        ]);

        return { items, total, page, limit, searchType: 'filter' as const };
    }

    const parsed = await parseSearchQuery(q);

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

    // Path 3: Nothing parsed — last-resort FTS on the original query
    const results = await prisma.$queryRawUnsafe<SearchResult[]>(
        `SELECT m.id, m.type, m.file_name, m.thumbnail_key, m.blur_hash,
                m.taken_at, m.width, m.height, m.duration_seconds,
                ts_rank(m.fts_vector, plainto_tsquery('english', $1)) AS rank
         FROM media_items m
         WHERE m.fts_vector @@ plainto_tsquery('english', $1)
         ORDER BY rank DESC
         LIMIT $2 OFFSET $3`,
        q, limit, offset,
    );

    return {
        items: results.map(mapSearchResult),
        total: results.length,
        page,
        limit,
        searchType: 'fts' as const,
    };
}
