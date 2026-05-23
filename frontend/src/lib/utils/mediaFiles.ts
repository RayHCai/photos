import { SUPPORTED_EXTENSIONS } from '../constants/mediaFormats';

function getExtension(name: string): string {
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function isMediaFile(file: File): boolean {
    // Skip dotfiles (.DS_Store, thumbs.db, etc.)
    if (file.name.startsWith('.')) return false;

    const ext = getExtension(file.name);

    // If MIME type is present, check it's image/video and extension is supported
    if (file.type) {
        return (file.type.startsWith('image/') || file.type.startsWith('video/'))
            && SUPPORTED_EXTENSIONS.has(ext);
    }

    // No MIME type (common for .heic, .mkv) — rely on extension only
    return SUPPORTED_EXTENSIONS.has(ext);
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
