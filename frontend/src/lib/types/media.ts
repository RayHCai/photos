type MediaType = 'PHOTO' | 'VIDEO';
type ProcessingStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export interface MediaShellItem {
    id: string;
    type: MediaType;
    thumbnailKey: string | null;
    blurHash: string | null;
    width: number | null;
    height: number | null;
    durationSeconds: number | null;
    takenAt: string | null;
    processingStatus: ProcessingStatus;
    createdAt: string;
}

export interface MediaListItem extends MediaShellItem {
    fileName: string;
}

export interface MediaItem extends MediaListItem {
    originalKey: string;
    mimeType: string;
    fileSize: string;
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
