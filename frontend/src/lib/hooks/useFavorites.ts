'use client';

// Superseded by useSystemCollection, which unified the two near-identical hooks
// (useFavorites/useHidden) that invalidated different key sets for the same kind
// of operation. Re-exported so call sites need no change.
export { useFavorites } from './useSystemCollection';
