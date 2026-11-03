/**
 * The email that tells the owner guests have uploaded, built from the uploads it
 * covers. Pure, so the wording can be tested without a database or Resend.
 */

export interface DigestUpload {
    collectionId: string;
    collectionName: string;
    /** The link's label, when the owner gave it one. */
    linkName: string | null;
    contributorName: string | null;
    mimeType: string;
    /** ContributionStatus; anything but PENDING has been reviewed already. */
    status: string;
}

export interface AlbumSummary {
    collectionId: string;
    collectionName: string;
    photos: number;
    videos: number;
    contributors: string[];
    /** Some uploads came from a guest who left the name blank. */
    hasAnonymous: boolean;
    links: string[];
    waiting: number;
}

export interface UploadDigest {
    subject: string;
    text: string;
    html: string;
}

/** Uploads grouped per album, busiest album first. */
export function summarizeUploads(uploads: DigestUpload[]): AlbumSummary[] {
    const albums = new Map<string, AlbumSummary & { names: Set<string>; linkSet: Set<string> }>();

    for (const upload of uploads) {
        let album = albums.get(upload.collectionId);
        if (!album) {
            album = {
                collectionId: upload.collectionId,
                collectionName: upload.collectionName,
                photos: 0,
                videos: 0,
                contributors: [],
                hasAnonymous: false,
                links: [],
                waiting: 0,
                names: new Set(),
                linkSet: new Set(),
            };
            albums.set(upload.collectionId, album);
        }

        if (upload.mimeType.startsWith('video/')) album.videos++;
        else album.photos++;
        if (upload.contributorName) album.names.add(upload.contributorName);
        else album.hasAnonymous = true;
        if (upload.linkName) album.linkSet.add(upload.linkName);
        if (upload.status === 'PENDING') album.waiting++;
    }

    return [...albums.values()]
        .map(({ names, linkSet, ...album }) => ({
            ...album,
            contributors: [...names],
            links: [...linkSet],
        }))
        .sort((a, b) => b.photos + b.videos - (a.photos + a.videos));
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "3 photos and 1 video". */
export function describeCounts(photos: number, videos: number): string {
    if (photos && videos) return `${plural(photos, 'photo')} and ${plural(videos, 'video')}`;
    if (videos) return plural(videos, 'video');
    return plural(photos, 'photo');
}

/** Joins a short list as prose: "A", "A and B", "A, B and C". */
function joinNames(names: string[]): string {
    if (names.length <= 1) return names[0] ?? '';
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

const MAX_NAMED = 3;

/** "Sam", "Sam and someone else", "Sam, Alex, Jo and 2 others", "Someone". */
export function describeContributors(names: string[], hasAnonymous: boolean): string {
    if (names.length === 0) return 'Someone';

    const shown = names.slice(0, MAX_NAMED);
    const hidden = names.length - shown.length;
    if (hidden > 0) return joinNames([...shown, plural(hidden, 'other')]);
    return joinNames(hasAnonymous ? [...shown, 'someone else'] : shown);
}

export function describeAlbum(album: AlbumSummary): string {
    const who = describeContributors(album.contributors, album.hasAnonymous);
    const via = album.links.length > 0 ? ` via ${joinNames(album.links)}` : '';
    return `${who} uploaded ${describeCounts(album.photos, album.videos)} to ${album.collectionName}${via}.`;
}

function describeWaiting(album: AlbumSummary): string {
    const total = album.photos + album.videos;
    if (album.waiting === 0) return 'All of them have been reviewed already.';
    const subject = total === 1 ? 'It is' : album.waiting === total ? 'They are' : `${album.waiting} are`;
    return `${subject} in the album now, waiting for you to approve them into your library.`;
}

/** The album, with its change log open: where uploads are reviewed. */
export function reviewUrl(appUrl: string, collectionId: string): string {
    return `${appUrl.replace(/\/+$/, '')}/collections/${encodeURIComponent(collectionId)}?activity=1`;
}

/**
 * Album names and contributor names reach the HTML part verbatim from the owner
 * and from anonymous guests respectively, so both are escaped — a guest must not
 * be able to put a link or markup into the owner's inbox.
 */
export function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function buildUploadDigest(uploads: DigestUpload[], opts: { appUrl: string }): UploadDigest {
    const albums = summarizeUploads(uploads);
    const total = uploads.length;

    const subject =
        albums.length === 1
            ? `${plural(total, 'new upload')} to ${albums[0]!.collectionName}`
            : `${plural(total, 'new upload')} across ${albums.length} albums`;

    const text = albums
        .flatMap((album) => [
            describeAlbum(album),
            describeWaiting(album),
            `Review: ${reviewUrl(opts.appUrl, album.collectionId)}`,
            '',
        ])
        .join('\n')
        .trimEnd();

    const sections = albums
        .map(
            (album) => `
        <div style="margin:0 0 24px">
            <p style="margin:0 0 4px;font-size:15px;color:#1c1917">${escapeHtml(describeAlbum(album))}</p>
            <p style="margin:0 0 12px;font-size:13px;color:#78716c">${escapeHtml(describeWaiting(album))}</p>
            <a href="${escapeHtml(reviewUrl(opts.appUrl, album.collectionId))}"
               style="display:inline-block;padding:8px 14px;border-radius:6px;background:#1c1917;color:#fafaf9;font-size:13px;text-decoration:none">
                Review uploads
            </a>
        </div>`
        )
        .join('');

    const html = `<!doctype html>
<html>
    <body style="margin:0;padding:24px;background:#fafaf9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
        <div style="max-width:520px;margin:0 auto">${sections}
        </div>
    </body>
</html>`;

    return { subject, text, html };
}
