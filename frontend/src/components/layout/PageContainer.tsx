import { ReactNode } from 'react';
import { EmptyState } from '@/components/ui/EmptyState';

interface PageContainerProps {
    toolbar: ReactNode;
    children: ReactNode;
    isLoading?: boolean;
    isEmpty?: boolean;
    emptyMessage?: string;
}

export function PageContainer({
    toolbar,
    children,
    isLoading,
    isEmpty,
    emptyMessage = 'Nothing here',
}: PageContainerProps) {
    return (
        <div className="h-screen flex flex-col">
            {/* Toolbar */}
            <div className="relative flex items-center justify-center gap-2 px-[30px] pt-3 pb-9">
                {toolbar}
            </div>

            {/* Content */}
            {isLoading || isEmpty ? (
                <EmptyState isLoading={isLoading} message={emptyMessage} />
            ) : (
                <div className="flex-1 min-h-0 overflow-y-auto">
                    {children}
                </div>
            )}
        </div>
    );
}
