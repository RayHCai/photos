/** All supported media file extensions */
export const SUPPORTED_EXTENSIONS = new Set([
    'jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'tiff', 'avif',
    'mp4', 'mov', 'avi', 'webm', 'mkv',
]);

/**
 * Fallback MIME types for formats where the browser doesn't provide one.
 */
export const EXT_TO_MIME: Record<string, string> = {
    heic: 'image/heic',
    heif: 'image/heif',
    tiff: 'image/tiff',
    avif: 'image/avif',
    mkv: 'video/x-matroska',
    mov: 'video/quicktime',
    avi: 'video/x-msvideo',
};
