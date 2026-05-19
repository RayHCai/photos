import { ReactNode } from 'react';
import { Spinner } from '@/components/ui/Spinner';

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
            <div className="relative flex items-center gap-2 px-[30px] pt-3 pb-9">
                {toolbar}
            </div>

            {/* Content */}
            {isLoading ? (
                <div className="flex-1 flex items-center justify-center">
                    <Spinner className="w-6 h-6" />
                </div>
            ) : isEmpty ? (
                <div className="flex-1 flex items-center justify-center">
                    <p className="font-serif text-stone-400">{emptyMessage}</p>
                </div>
            ) : (
                <div className="flex-1 min-h-0 overflow-y-auto">
                    {children}
                </div>
            )}
        </div>
    );
}
