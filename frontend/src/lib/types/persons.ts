import type { MediaListItem } from './media';

export interface Person {
    id: string;
    name: string | null;
    avatarKey: string | null;
    createdAt: string;
    updatedAt: string;
    _count: { faces: number };
}

export type PersonMediaItem = Pick<
    MediaListItem,
    'id' | 'type' | 'fileName' | 'thumbnailKey' | 'width' | 'height' | 'durationSeconds' | 'takenAt'
>;
