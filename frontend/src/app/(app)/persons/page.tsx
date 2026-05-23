'use client';

import { useMemo, useState, useCallback } from 'react';
import { usePersons, useDeletePerson } from '@/lib/hooks/usePersons';
import { useMediaSelection } from '@/lib/hooks/useMediaSelection';
import { useLocalFilter } from '@/lib/hooks/useLocalFilter';
import { useEscapeKey } from '@/lib/hooks/useEscapeKey';
import { PersonCard } from '@/components/persons/PersonCard';
import { PersonDetailModal } from '@/components/persons/PersonDetailModal';
import { SelectionToolbar } from '@/components/gallery/SelectionToolbar';
import { PageContainer } from '@/components/layout/PageContainer';
import { SearchInput } from '@/components/ui/SearchInput';
import { pluralize } from '@/lib/utils/pluralize';
import { toast } from 'sonner';
import type { Person } from '@/lib/types/persons';

export default function PersonsPage() {
    const { data: persons, isLoading } = usePersons();
    const [search, setSearch] = useState('');
    const [selectedPerson, setSelectedPerson] = useState<Person | null>(null);
    const selection = useMediaSelection();
    const deletePerson = useDeletePerson();

    useEscapeKey(selection.clearSelection, selection.isSelecting);
    const filteredPersons = useLocalFilter(persons, search, useCallback((p) => p.name, []));
    const personIds = useMemo(() => filteredPersons.map((p) => p.id), [filteredPersons]);

    // Keep selected person in sync with latest data
    const activePerson = useMemo(() => {
        if (!selectedPerson || !persons) return null;
        return persons.find((p) => p.id === selectedPerson.id) || null;
    }, [selectedPerson, persons]);

    const handleDeletePersons = useCallback(async (ids: string[]) => {
        try {
            await Promise.all(ids.map((id) => deletePerson.mutateAsync(id)));
            toast.success(`Deleted ${pluralize(ids.length, 'person', 'people')}`);
        }
        catch {
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
                    <div className="w-9 flex-shrink-0 hidden sm:block" />
                    <div className="sm:flex-1 flex sm:justify-center">
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
                    <div className="w-9 flex-shrink-0 hidden sm:block" />
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
                        onSelect={(e: React.MouseEvent) => selection.handleSelect(p.id, personIds, e)}
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
