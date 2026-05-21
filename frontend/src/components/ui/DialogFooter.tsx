import { Button } from './Button';

interface DialogFooterProps {
    onCancel: () => void;
    submitLabel?: string;
    loading?: boolean;
    disabled?: boolean;
}

export function DialogFooter({ onCancel, submitLabel = 'Save', loading, disabled }: DialogFooterProps) {
    return (
        <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onCancel} type="button">
                Cancel
            </Button>
            <Button type="submit" loading={loading} disabled={disabled}>
                {submitLabel}
            </Button>
        </div>
    );
}
