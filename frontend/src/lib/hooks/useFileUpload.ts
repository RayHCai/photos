import { useCallback } from 'react';
import { useUpload } from './useUpload';

export function useFileUpload() {
    const { addFiles } = useUpload();

    const openFilePicker = useCallback((collectionId?: string) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.accept = 'image/*,video/*';
        input.onchange = () => {
            if (input.files && input.files.length > 0) {
                addFiles(input.files, collectionId ? { collectionId } : undefined);
            }
        };
        input.click();
    }, [addFiles]);

    return { openFilePicker };
}
