import { type ReactNode } from 'react';
import { Button, type ButtonProps } from './Button';

interface DialogFooterProps {
    onCancel: () => void;
    submitLabel?: string;
    loading?: boolean;
    disabled?: boolean;
    /** Variant for the submit button (defaults to "primary") */
    submitVariant?: ButtonProps['variant'];
    /** Size for both buttons (defaults to "md") */
    size?: ButtonProps['size'];
    /** Custom content to render on the left side */
    left?: ReactNode;
}

export function DialogFooter({
    onCancel,
    submitLabel = 'Save',
    loading,
    disabled,
    submitVariant = 'primary',
    size,
    left,
}: DialogFooterProps) {
    return (
        <div className={`flex ${left ? 'justify-between' : 'justify-end'} gap-2`}>
            {left ?? <div />}
            <div className="flex gap-2">
                <Button variant="secondary" size={size} onClick={onCancel} type="button" disabled={loading}>
                    Cancel
                </Button>
                <Button variant={submitVariant} size={size} type="submit" loading={loading} disabled={disabled}>
                    {submitLabel}
                </Button>
            </div>
        </div>
    );
}
