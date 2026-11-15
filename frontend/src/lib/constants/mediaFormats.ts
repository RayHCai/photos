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

import { isIOS } from '../utils/platform';

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
    { mime: 'image/x-adobe-dng', extensions: ['dng'] },
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

/**
 * `accept` for iOS and iPadOS, where the explicit list above is what keeps the photo
 * picker on screen after the user taps Add.
 *
 * When `accept` names concrete types, WebKit treats them as the formats the page can
 * take and converts the selection into one of them before `change` fires — HEIC
 * photos to JPEG (it is listed first) and HEVC `.mov` videos to H.264 — and the
 * picker stays open with a progress indicator until every file is converted. For a
 * few videos that is minutes, where Android hands the originals over at once.
 * Wildcards give WebKit nothing to convert towards, so it passes the originals
 * through, which the backend accepts as-is (HEIC and QuickTime are both supported).
 *
 * Not used elsewhere: `image/*` alone leaves HEIC unselectable on some Android
 * builds. The selection still goes through `filterMediaFiles` either way.
 */
const IOS_FILE_INPUT_ACCEPT = 'image/*,video/*';

/** The `accept` value for this platform's file picker. */
export function fileInputAccept(): string {
    return isIOS() ? IOS_FILE_INPUT_ACCEPT : FILE_INPUT_ACCEPT;
}

/**
 * `accept` for the "Browse files" picker on Android, which exists to get past the
 * Photo Picker's 100-item cap.
 *
 * Chrome on Android opens the Photo Picker only when every accepted type is an image
 * or video type. Anything else, the any-type wildcard below included, sends it to the system document
 * picker instead, which has no cap: the user can long-press and select a whole folder
 * such as DCIM/Camera. What comes back is filtered by `filterMediaFiles` like every
 * other selection, so non-media files are skipped rather than uploaded.
 */
export const BROWSE_FILES_ACCEPT = '*/*';

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
