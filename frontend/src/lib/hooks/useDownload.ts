'use client';

import { DownloadContext } from '../providers/DownloadProvider';
import { createContextHook } from '../utils/createContextHook';

export const useDownload = createContextHook(DownloadContext, 'useDownload');
