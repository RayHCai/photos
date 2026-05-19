import { Spinner } from './Spinner';

interface CenteredSpinnerProps {
    className?: string;
}

export function CenteredSpinner({ className = 'min-h-[50vh]' }: CenteredSpinnerProps) {
    return (
        <div className={`flex items-center justify-center ${className}`}>
            <Spinner className="w-8 h-8" />
        </div>
    );
}
