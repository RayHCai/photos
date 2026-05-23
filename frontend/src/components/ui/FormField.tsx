import type { ReactNode } from 'react';

interface FormFieldProps {
    label: string;
    children: ReactNode;
}

export function FormField({ label, children }: FormFieldProps) {
    return (
        <div>
            <label className="block text-sm text-stone-700 mb-1">{label}</label>
            {children}
        </div>
    );
}
