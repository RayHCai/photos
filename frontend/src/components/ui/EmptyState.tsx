import { Spinner } from './Spinner';

interface EmptyStateProps {
    isLoading?: boolean;
    message?: string;
}

export function EmptyState({ isLoading, message = 'Nothing here' }: EmptyStateProps) {
    return (
        <div className="flex-1 flex items-center justify-center">
            {isLoading ? (
                <Spinner className="w-6 h-6" />
            ) : (
                <p className="font-serif text-stone-400 select-none">{message}</p>
            )}
        </div>
    );
}
