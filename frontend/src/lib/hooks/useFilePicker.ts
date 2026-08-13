'use client';

import { useCallback } from 'react';
import { toast } from 'sonner';
import { useUpload } from './useUpload';
import { filterMediaFiles } from '../utils/mediaFiles';
import { FILE_INPUT_ACCEPT } from '../constants/mediaFormats';
import { pluralize } from '../utils/pluralize';

/**
 * Opens a native picker and hands the selection to the upload queue.
 *
 * Both pickers now run the same `filterMediaFiles` acceptance test. The file picker
 * previously relied solely on `accept="image/*,video/*"`, which is a *hint*: the OS
 * dialog lets the user override it, and several platforms ignore it. So a `.psd` or
 * `.zip` chosen through the file picker was uploaded and then rejected by the server,
 * while the same file chosen through the folder picker was rejected client-side.
 *
 * `accept` also now lists concrete extensions as well as MIME types, because Safari and
 * some Android pickers honour only one or the other — with `image/*` alone, HEIC files
 * are greyed out and unselectable on some Android builds.
 */
export function useFilePicker() {
    const { addFiles } = useUpload();

    const pick = useCallback(
        (options: { directory: boolean; collectionId?: string }) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.multiple = true;
            input.accept = FILE_INPUT_ACCEPT;
            if (options.directory) input.setAttribute('webkitdirectory', '');

            input.onchange = () => {
                const allFiles = Array.from(input.files ?? []);
                if (allFiles.length === 0) return;

                const mediaFiles = filterMediaFiles(allFiles);

                if (mediaFiles.length === 0) {
                    toast.info(
                        options.directory
                            ? 'No supported photos or videos found in folder'
                            : 'No supported photos or videos selected'
                    );
                    return;
                }

                const skipped = allFiles.length - mediaFiles.length;
                if (skipped > 0) {
                    toast.info(`Skipped ${pluralize(skipped, 'unsupported file')}`);
                }

                addFiles(
                    mediaFiles,
                    options.collectionId ? { collectionId: options.collectionId } : undefined
                );
            };

            input.click();
        },
        [addFiles]
    );

    const openFilePicker = useCallback(
        (collectionId?: string) =>
            pick({ directory: false, ...(collectionId ? { collectionId } : {}) }),
        [pick]
    );

    const openFolderPicker = useCallback(
        (collectionId?: string) =>
            pick({ directory: true, ...(collectionId ? { collectionId } : {}) }),
        [pick]
    );

    return { openFilePicker, openFolderPicker };
}
