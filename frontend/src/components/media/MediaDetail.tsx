'use client';

import { useQuery } from '@tanstack/react-query';
import { getMediaById } from '@/lib/api/media';
import { formatDate, formatFileSize } from '@/lib/utils/format';
import {
    Calendar,
    MapPin,
    Camera,
    HardDrive,
    Image,
    User,
} from 'lucide-react';


interface MediaDetailProps {
    mediaId: string;
}

export function MediaDetail({ mediaId }: MediaDetailProps) {
    const { data: item } = useQuery({
        queryKey: ['media', mediaId],
        queryFn: () => getMediaById(mediaId),
    });

    if (!item) return null;

    return (
        <div className="space-y-4 text-sm">
            <h3 className="font-serif text-stone-900 truncate">
                {item.fileName}
            </h3>

            <div className="space-y-3 text-stone-600">
                {item.takenAt && (
                    <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-stone-400" />
                        <span>{formatDate(item.takenAt)}</span>
                    </div>
                )}

                {(item.city || item.country) && (
                    <div className="flex items-center gap-2">
                        <MapPin className="w-4 h-4 text-stone-400" />
                        <span>
                            {[item.city, item.country]
                                .filter(Boolean)
                                .join(', ')}
                        </span>
                    </div>
                )}

                {(item.cameraMake || item.cameraModel) && (
                    <div className="flex items-center gap-2">
                        <Camera className="w-4 h-4 text-stone-400" />
                        <span>
                            {[item.cameraMake, item.cameraModel]
                                .filter(Boolean)
                                .join(' ')}
                        </span>
                    </div>
                )}

                <div className="flex items-center gap-2">
                    <HardDrive className="w-4 h-4 text-stone-400" />
                    <span>{formatFileSize(item.fileSize)}</span>
                </div>

                {item.width && item.height && (
                    <div className="flex items-center gap-2">
                        <Image className="w-4 h-4 text-stone-400" />
                        <span>
                            {item.width} x {item.height}
                        </span>
                    </div>
                )}
            </div>

            {item.faces.length > 0 && (
                <div>
                    <h4 className="text-xs font-medium text-stone-500 uppercase tracking-wide mb-2">
                        People
                    </h4>
                    <div className="flex flex-wrap gap-2">
                        {item.faces.map((face) => (
                            <span
                                key={face.id}
                                className="flex items-center gap-1.5 px-2 py-1 bg-stone-100 rounded text-xs text-stone-700"
                            >
                                <User className="w-3 h-3" />
                                {face.person?.name || 'Unknown'}
                            </span>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
