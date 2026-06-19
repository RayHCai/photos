// Fields the gallery shell needs per item. Deliberately omits `fileName`, which
// the virtualized timeline never renders — keeping the unpaginated /media/shell
// payload as small as possible.
export const MEDIA_ITEM_SHELL_SELECT = {
    id: true,
    type: true,
    thumbnailKey: true,
    blurHash: true,
    width: true,
    height: true,
    durationSeconds: true,
    takenAt: true,
    processingStatus: true,
    createdAt: true,
} as const;

// The list endpoint additionally needs `fileName` (MediaListItem). Defined as a
// strict superset of the shell select so the two can't drift.
export const MEDIA_ITEM_SUMMARY_SELECT = {
    ...MEDIA_ITEM_SHELL_SELECT,
    fileName: true,
} as const;
