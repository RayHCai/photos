import { isSupportedExtension, mimeForExtension } from '../constants/mediaFormats';

export function getExtension(name: string): string {
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/**
 * The single acceptance test for an incoming file.
 *
 * There were four intake paths with three different behaviours: `openFilePicker`
 * relied only on the `accept` hint (so anything the OS dialog let through was
 * uploaded), while `openFolderPicker` and the drop-zone ran this filter. Every path now
 * goes through here, so a file is accepted or rejected identically however it arrived.
 */
export function isMediaFile(file: File): boolean {
    // Skip dotfiles (.DS_Store, thumbs.db, etc.).
    if (file.name.startsWith('.')) return false;

    const ext = getExtension(file.name);
    if (!isSupportedExtension(ext)) return false;

    /**
     * Extension is authoritative; a reported MIME type only has to be non-contradictory.
     *
     * Browsers report an empty `File.type` for HEIC and MKV routinely, and folder drops
     * frequently omit it entirely — so requiring a MIME match would reject valid files.
     * But a file claiming `application/zip` with a `.jpg` name is not a photo.
     */
    if (file.type && !file.type.startsWith('image/') && !file.type.startsWith('video/')) {
        return false;
    }

    return true;
}

/**
 * The MIME type to send with the presign request.
 *
 * Prefers the extension mapping over `File.type`, because the browser's value is empty
 * for HEIC on several platforms and the backend's allowlist check would then reject a
 * perfectly valid upload.
 */
export function resolveUploadMimeType(file: File): string {
    return mimeForExtension(getExtension(file.name)) ?? file.type ?? 'application/octet-stream';
}

export function filterMediaFiles(files: File[]): File[] {
    return files.filter(isMediaFile);
}

/**
 * Reads all entries from a FileSystemDirectoryReader.
 * Must be called repeatedly because readEntries() returns batches.
 */
function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
    return new Promise((resolve, reject) => {
        const all: FileSystemEntry[] = [];
        const readBatch = () => {
            reader.readEntries((entries) => {
                if (entries.length === 0) {
                    resolve(all);
                }
                else {
                    all.push(...entries);
                    readBatch();
                }
            }, reject);
        };
        readBatch();
    });
}

function fileEntryToFile(entry: FileSystemFileEntry): Promise<File> {
    return new Promise((resolve, reject) => entry.file(resolve, reject));
}

/**
 * Recursively reads a FileSystemEntry (from drag-and-drop) and returns all media files.
 */
export async function readEntriesRecursive(entry: FileSystemEntry): Promise<File[]> {
    if (entry.isFile) {
        const file = await fileEntryToFile(entry as FileSystemFileEntry);
        return isMediaFile(file) ? [file] : [];
    }

    if (entry.isDirectory) {
        const reader = (entry as FileSystemDirectoryEntry).createReader();
        const children = await readAllEntries(reader);
        const nested = await Promise.all(children.map(readEntriesRecursive));
        return nested.flat();
    }

    return [];
}
