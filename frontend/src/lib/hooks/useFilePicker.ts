import { useCallback } from 'react';
import { useUpload } from './useUpload';
import { filterMediaFiles } from '../utils/mediaFiles';
import { toast } from 'sonner';

export function useFilePicker() {
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

    const openFolderPicker = useCallback((collectionId?: string) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.setAttribute('webkitdirectory', '');
        input.onchange = () => {
            if (!input.files || input.files.length === 0) return;

            const allFiles = Array.from(input.files);
            const mediaFiles = filterMediaFiles(allFiles);

            if (mediaFiles.length === 0) {
                toast.info('No supported photos or videos found in folder');
                return;
            }

            const skipped = allFiles.length - mediaFiles.length;
            if (skipped > 0) {
                toast.info(`Skipped ${skipped} unsupported file${skipped !== 1 ? 's' : ''}`);
            }

            addFiles(mediaFiles, collectionId ? { collectionId } : undefined);
        };
        input.click();
    }, [addFiles]);

    return { openFilePicker, openFolderPicker };
}
