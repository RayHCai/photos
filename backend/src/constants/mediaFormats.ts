/**
 * Single source of truth for accepted media formats.
 *
 * The MIME allowlist previously lived in media.service.ts while the frontend
 * kept an independent extension list, and the two had already drifted: `tif` was
 * missing from the frontend extension list while `image/tiff` was present in the
 * backend MIME set. Dropping a folder containing `photo.tif` silently skipped it
 * ("No supported photos or videos found") while selecting the same file through
 * the file picker uploaded it fine.
 *
 * frontend/src/lib/constants/mediaFormats.ts derives its lists from this table;
 * a test asserts the two stay in sync.
 */

interface FormatSpec {
    mime: string;
    /** All extensions that map to this MIME type, lowercase, without a dot. */
    extensions: readonly string[];
}

export const PHOTO_FORMATS: readonly FormatSpec[] = [
    { mime: 'image/jpeg', extensions: ['jpg', 'jpeg', 'jpe'] },
    { mime: 'image/png', extensions: ['png'] },
    { mime: 'image/webp', extensions: ['webp'] },
    { mime: 'image/heic', extensions: ['heic'] },
    { mime: 'image/heif', extensions: ['heif'] },
    { mime: 'image/tiff', extensions: ['tif', 'tiff'] },
    { mime: 'image/avif', extensions: ['avif'] },
];

export const VIDEO_FORMATS: readonly FormatSpec[] = [
    { mime: 'video/mp4', extensions: ['mp4', 'm4v'] },
    { mime: 'video/quicktime', extensions: ['mov', 'qt'] },
    { mime: 'video/x-msvideo', extensions: ['avi'] },
    { mime: 'video/webm', extensions: ['webm'] },
    { mime: 'video/x-matroska', extensions: ['mkv'] },
];

export const ALL_FORMATS: readonly FormatSpec[] = [...PHOTO_FORMATS, ...VIDEO_FORMATS];

export const SUPPORTED_MIME_TYPES: readonly string[] = ALL_FORMATS.map((f) => f.mime);

export const SUPPORTED_EXTENSIONS: readonly string[] = ALL_FORMATS.flatMap(
    (f) => f.extensions
);

const MIME_SET = new Set(SUPPORTED_MIME_TYPES);
const EXTENSION_TO_MIME = new Map<string, string>(
    ALL_FORMATS.flatMap((f) => f.extensions.map((ext) => [ext, f.mime] as const))
);

export function isSupportedMimeType(mime: string): boolean {
    return MIME_SET.has(mime.toLowerCase());
}

export function isSupportedExtension(ext: string): boolean {
    return EXTENSION_TO_MIME.has(ext.toLowerCase().replace(/^\./, ''));
}

/**
 * Browsers frequently report an empty or wrong `File.type` for HEIC and for
 * files arriving from a folder drop, so extension is the more reliable signal.
 */
export function mimeForExtension(ext: string): string | undefined {
    return EXTENSION_TO_MIME.get(ext.toLowerCase().replace(/^\./, ''));
}
