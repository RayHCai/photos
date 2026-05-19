export interface Person {
    id: string;
    name: string | null;
    avatarKey: string | null;
    createdAt: string;
    updatedAt: string;
    _count: { faces: number };
}

export interface Face {
    id: string;
    mediaItemId: string;
    personId: string | null;
    boxX: number;
    boxY: number;
    boxWidth: number;
    boxHeight: number;
    confidence: number | null;
    cropKey: string | null;
    createdAt: string;
    mediaItem?: {
        id: string;
        fileName: string;
        thumbnailKey: string | null;
    };
}

export interface PersonMediaItem {
    id: string;
    type: 'PHOTO' | 'VIDEO';
    fileName: string;
    thumbnailKey: string | null;
    width: number | null;
    height: number | null;
    durationSeconds: number | null;
    takenAt: string | null;
}
