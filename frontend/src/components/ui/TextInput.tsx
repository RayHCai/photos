import { forwardRef, type InputHTMLAttributes } from 'react';

type TextInputProps = InputHTMLAttributes<HTMLInputElement>;

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
    function TextInput({ className = '', ...props }, ref) {
        return (
            <input
                ref={ref}
                className={`w-full px-3 py-2 border border-stone-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-stone-300 ${className}`}
                {...props}
            />
        );
    }
);
