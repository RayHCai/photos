'use client';

import { useMemo, useState, useCallback } from 'react';
import { usePersons } from '@/lib/hooks/usePersons';
import { useSearchFilter } from '@/lib/hooks/useSearchFilter';
import { PersonCard } from '@/components/persons/PersonCard';
import { PersonDetailModal } from '@/components/persons/PersonDetailModal';
import { UnassignedFaces } from '@/components/persons/UnassignedFaces';
import { PageContainer } from '@/components/layout/PageContainer';
import { SearchInput } from '@/components/ui/SearchInput';
import type { Person } from '@/lib/types/persons';

export default function PersonsPage() {
    const { data: persons, isLoading } = usePersons();
    const [search, setSearch] = useState('');
    const [selectedPerson, setSelectedPerson] = useState<Person | null>(null);

    const filteredPersons = useSearchFilter(persons, search, useCallback((p) => p.name, []));

    // Keep selected person in sync with latest data
    const activePerson = useMemo(() => {
        if (!selectedPerson || !persons) return null;
        return persons.find((p) => p.id === selectedPerson.id) || null;
    }, [selectedPerson, persons]);

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
                    />
                ))}
            </div>
            <div className="max-w-5xl mx-auto pb-6">
                <UnassignedFaces />
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
