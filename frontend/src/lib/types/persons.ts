export interface Person {
    id: string;
    name: string | null;
    avatarKey: string | null;
    createdAt: string;
    updatedAt: string;
    _count: { faces: number };
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
