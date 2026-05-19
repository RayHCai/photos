'use client';

import { useState } from 'react';
import { useUnassignedFaces, useAssignFace } from '@/lib/hooks/useFaces';
import { usePersons } from '@/lib/hooks/usePersons';
import { useInfiniteScroll } from '@/lib/hooks/useInfiniteScroll';
import { faceCropUrl } from '@/lib/api/faces';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { User } from 'lucide-react';
import { toast } from 'sonner';
import { Spinner } from '@/components/ui/Spinner';
import type { Face } from '@/lib/types/persons';

export function UnassignedFaces() {
    const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } =
        useUnassignedFaces();
    const { data: persons = [] } = usePersons();
    const assignFace = useAssignFace();
    const [selectedFace, setSelectedFace] = useState<Face | null>(null);
    const [selectedPersonId, setSelectedPersonId] = useState('');

    const faces = data?.pages.flatMap((p) => p.items) || [];

    const sentinelRef = useInfiniteScroll(
        () => fetchNextPage(),
        !!hasNextPage && !isFetchingNextPage
    );

    const handleAssign = () => {
        if (!selectedFace || !selectedPersonId) return;
        assignFace.mutate(
            { faceId: selectedFace.id, personId: selectedPersonId },
            {
                onSuccess: () => {
                    toast.success('Face assigned');
                    setSelectedFace(null);
                    setSelectedPersonId('');
                },
            }
        );
    };

    if (isLoading) {
        return (
            <div className="flex justify-center py-8">
                <Spinner className="w-6 h-6" />
            </div>
        );
    }

    if (faces.length === 0) return null;

    return (
        <div>
            <h3 className="text-sm font-serif text-stone-700 mb-3 px-4">
                Unassigned faces ({faces.length})
            </h3>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(80px,1fr))] gap-2 px-4">
                {faces.map((face) => (
                    <button
                        key={face.id}
                        className="aspect-square rounded overflow-hidden bg-stone-100 hover:ring-1 hover:ring-stone-300 transition-all"
                        onClick={() => setSelectedFace(face)}
                    >
                        {face.cropKey ? (
                            <img
                                src={faceCropUrl(face.id)}
                                alt=""
                                loading="lazy"
                                className="w-full h-full object-cover"
                            />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center">
                                <User className="w-6 h-6 text-stone-400" />
                            </div>
                        )}
                    </button>
                ))}
            </div>
            <div ref={sentinelRef} className="h-2" />

            <Dialog
                open={!!selectedFace}
                onClose={() => setSelectedFace(null)}
                title="Assign face"
            >
                <div className="space-y-4">
                    <select
                        value={selectedPersonId}
                        onChange={(e) => setSelectedPersonId(e.target.value)}
                        className="w-full px-3 py-2 border border-stone-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-stone-300"
                    >
                        <option value="">Select a person...</option>
                        {persons.map((p) => (
                            <option key={p.id} value={p.id}>
                                {p.name || `Unknown (${p._count.faces} faces)`}
                            </option>
                        ))}
                    </select>
                    <div className="flex justify-end gap-2">
                        <Button
                            variant="secondary"
                            onClick={() => setSelectedFace(null)}
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={handleAssign}
                            loading={assignFace.isPending}
                            disabled={!selectedPersonId}
                        >
                            Assign
                        </Button>
                    </div>
                </div>
            </Dialog>
        </div>
    );
}
