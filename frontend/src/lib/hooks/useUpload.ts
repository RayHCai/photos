'use client';

import { UploadContext } from '../providers/UploadProvider';
import { createContextHook } from '../utils/createContextHook';

export const useUpload = createContextHook(UploadContext, 'useUpload');
