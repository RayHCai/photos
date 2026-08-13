/**
 * Accepted media formats.
 *
 * A mirror of backend/src/constants/mediaFormats.ts, kept in sync by a test there
 * (`mediaFormats.test.ts > frontend mirror`) because the frontend cannot import from
 * the backend package.
 *
 * The two lists previously diverged: `tif` was missing here while `image/tiff` was
 * present on the backend, so dropping a folder containing `photo.tif` silently skipped
 * it ("No supported photos or videos found") while selecting the same file through the
 * file picker uploaded it fine. Declaring one table of (mime, extensions) pairs and
 * deriving both lists from it makes that class of drift impossible within this file.
 */

interface FormatSpec {
    mime: string;
    /** All extensions that map to this MIME type, lowercase, without a dot. */
    extensions: readonly string[];
}

const PHOTO_FORMATS: readonly FormatSpec[] = [
    { mime: 'image/jpeg', extensions: ['jpg', 'jpeg', 'jpe'] },
    { mime: 'image/png', extensions: ['png'] },
    { mime: 'image/webp', extensions: ['webp'] },
    { mime: 'image/heic', extensions: ['heic'] },
    { mime: 'image/heif', extensions: ['heif'] },
    { mime: 'image/tiff', extensions: ['tif', 'tiff'] },
    { mime: 'image/avif', extensions: ['avif'] },
];

const VIDEO_FORMATS: readonly FormatSpec[] = [
    { mime: 'video/mp4', extensions: ['mp4', 'm4v'] },
    { mime: 'video/quicktime', extensions: ['mov', 'qt'] },
    { mime: 'video/x-msvideo', extensions: ['avi'] },
    { mime: 'video/webm', extensions: ['webm'] },
    { mime: 'video/x-matroska', extensions: ['mkv'] },
];

const ALL_FORMATS: readonly FormatSpec[] = [...PHOTO_FORMATS, ...VIDEO_FORMATS];

export const SUPPORTED_MIME_TYPES: readonly string[] = ALL_FORMATS.map((f) => f.mime);

export const SUPPORTED_EXTENSIONS: readonly string[] = ALL_FORMATS.flatMap(
    (f) => f.extensions
);

const EXTENSION_SET = new Set(SUPPORTED_EXTENSIONS);
const MIME_SET = new Set(SUPPORTED_MIME_TYPES);

/**
 * `accept` attribute for a file input.
 *
 * Includes both MIME types and extensions, because Safari and some Android pickers
 * honour only one or the other.
 */
export const FILE_INPUT_ACCEPT = [
    ...SUPPORTED_MIME_TYPES,
    ...SUPPORTED_EXTENSIONS.map((ext) => `.${ext}`),
].join(',');

export function normalizeExtension(value: string): string {
    return value.toLowerCase().replace(/^\./, '');
}

export function isSupportedExtension(ext: string): boolean {
    return EXTENSION_SET.has(normalizeExtension(ext));
}

export function isSupportedMimeType(mime: string): boolean {
    return MIME_SET.has(mime.toLowerCase());
}

/**
 * Browsers frequently report an empty or wrong `File.type` for HEIC, and for files
 * arriving from a folder drop, so extension is the more reliable signal.
 */
export function mimeForExtension(ext: string): string | undefined {
    const normalized = normalizeExtension(ext);
    for (const format of ALL_FORMATS) {
        if (format.extensions.includes(normalized)) return format.mime;
    }
    return undefined;
}

/** @deprecated Use mimeForExtension. Retained for existing callers. */
export const EXT_TO_MIME: Record<string, string> = Object.fromEntries(
    ALL_FORMATS.flatMap((f) => f.extensions.map((ext) => [ext, f.mime]))
);
