'use client';

import { useMemo, useState, useCallback } from 'react';
import { usePersons, useDeletePerson } from '@/lib/hooks/usePersons';
import { useMediaSelection } from '@/lib/hooks/useMediaSelection';
import { useSearchFilter } from '@/lib/hooks/useSearchFilter';
import { PersonCard } from '@/components/persons/PersonCard';
import { PersonDetailModal } from '@/components/persons/PersonDetailModal';
import { SelectionToolbar } from '@/components/gallery/SelectionToolbar';
import { PageContainer } from '@/components/layout/PageContainer';
import { SearchInput } from '@/components/ui/SearchInput';
import { toast } from 'sonner';
import type { Person } from '@/lib/types/persons';

export default function PersonsPage() {
    const { data: persons, isLoading } = usePersons();
    const [search, setSearch] = useState('');
    const [selectedPerson, setSelectedPerson] = useState<Person | null>(null);
    const selection = useMediaSelection();
    const deletePerson = useDeletePerson();

    const filteredPersons = useSearchFilter(persons, search, useCallback((p) => p.name, []));
    const personIds = useMemo(() => filteredPersons.map((p) => p.id), [filteredPersons]);

    // Keep selected person in sync with latest data
    const activePerson = useMemo(() => {
        if (!selectedPerson || !persons) return null;
        return persons.find((p) => p.id === selectedPerson.id) || null;
    }, [selectedPerson, persons]);

    const handleDeletePersons = useCallback(async (ids: string[]) => {
        try {
            await Promise.all(ids.map((id) => deletePerson.mutateAsync(id)));
            toast.success(`Deleted ${ids.length} person${ids.length !== 1 ? 's' : ''}`);
        } catch {
            toast.error('Failed to delete');
        }
    }, [deletePerson]);

    return (
        <PageContainer
            isLoading={isLoading}
            isEmpty={!filteredPersons || filteredPersons.length === 0}
            emptyMessage="No people"
            toolbar={
                <>
                    <div className="w-9 flex-shrink-0" />
                    <div className="flex-1 flex justify-center">
                        <SearchInput
                            value={search}
                            onChange={setSearch}
                            placeholder="Search people"
                        />
                    </div>
                    <SelectionToolbar
                        selection={selection}
                        onDelete={handleDeletePersons}
                        deleteConfirmMessage={`Delete ${selection.count} selected person${selection.count !== 1 ? 's' : ''}? This cannot be undone.`}
                    />
                    <div className="w-9 flex-shrink-0" />
                </>
            }
        >
            <div className="px-[34px] pb-6 flex flex-wrap justify-center gap-3">
                {filteredPersons.map((p) => (
                    <PersonCard
                        key={p.id}
                        person={p}
                        onClick={() => setSelectedPerson(p)}
                        isSelected={selection.selectedIds.has(p.id)}
                        isSelecting={selection.isSelecting}
                        onSelect={(e: React.MouseEvent) => {
                            if (!selection.isSelecting) selection.startSelecting();
                            if (e.shiftKey) {
                                selection.addRange(p.id, personIds);
                            } else {
                                selection.toggle(p.id);
                            }
                        }}
                    />
                ))}
            </div>
            {activePerson && (
                <PersonDetailModal
                    person={activePerson}
                    onClose={() => setSelectedPerson(null)}
                />
            )}
        </PageContainer>
    );
}
