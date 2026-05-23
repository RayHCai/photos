import { forwardRef, type SelectHTMLAttributes } from 'react';

type SelectInputProps = SelectHTMLAttributes<HTMLSelectElement>;

export const SelectInput = forwardRef<HTMLSelectElement, SelectInputProps>(
    function SelectInput({ className = '', ...props }, ref) {
        return (
            <select
                ref={ref}
                className={`w-full px-3 py-2 border border-stone-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-stone-300 ${className}`}
                {...props}
            />
        );
    }
);
