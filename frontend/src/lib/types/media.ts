export type MediaType = 'PHOTO' | 'VIDEO';
export type ProcessingStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export interface TimelineMonth {
    month: string; // yyyy-MM
    count: number;
}

export interface MediaShellItem {
    id: string;
    type: MediaType;
    thumbnailKey: string | null;
    blurHash: string | null;
    width: number | null;
    height: number | null;
    durationSeconds: number | null;
    /** True UTC instant of capture. */
    takenAt: string | null;
    /**
     * Capture-local wall clock. Day and month grouping is derived from this, not
     * from takenAt, so a photo does not migrate between days depending on the
     * viewer's timezone.
     */
    takenAtLocal: string | null;
    processingStatus: ProcessingStatus;
    createdAt: string;
    /** Present on list responses; the shell projection omits it to stay small. */
    fileName?: string;
}

/** Narrow payload from /media/processing-updates. */
export interface ProcessingUpdate {
    id: string;
    processingStatus: ProcessingStatus;
    thumbnailKey: string | null;
    blurHash: string | null;
    width: number | null;
    height: number | null;
    durationSeconds: number | null;
    takenAt: string | null;
    updatedAt: string;
}

export interface MediaListItem extends MediaShellItem {
    fileName: string;
}

export interface MediaItem extends MediaListItem {
    originalKey: string;
    mimeType: string;
    /**
     * Serialised as a decimal string, not a number: Prisma returns BigInt and the
     * backend's json replacer emits `value.toString()`. (It previously patched
     * BigInt.prototype.toJSON to Number(), which silently lost precision above
     * 2^53 and mutated a global built-in.)
     */
    fileSize: string;
    takenAtOffsetMin: number | null;
    videoRotation: number | null;
    latitude: number | null;
    longitude: number | null;
    city: string | null;
    country: string | null;
    cameraMake: string | null;
    cameraModel: string | null;
    processingError: string | null;
    faces: FaceWithPerson[];
}

interface FaceWithPerson {
    id: string;
    mediaItemId: string;
    personId: string | null;
    boxX: number;
    boxY: number;
    boxWidth: number;
    boxHeight: number;
    confidence: number | null;
    cropKey: string | null;
    person: {
        id: string;
        name: string | null;
    } | null;
}
