'use client';

interface FilterTab<T extends string> {
    value: T;
    label: string;
}

interface FilterTabsProps<T extends string> {
    options: FilterTab<T>[];
    selected: T;
    onChange: (value: T) => void;
}

export function FilterTabs<T extends string>({
    options,
    selected,
    onChange,
}: FilterTabsProps<T>) {
    return (
        <div className="flex gap-1">
            {options.map((opt) => (
                <button
                    key={opt.value}
                    onClick={() => onChange(opt.value)}
                    className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                        opt.value === selected
                            ? 'bg-stone-900 text-stone-50'
                            : 'bg-stone-200 text-stone-600 hover:bg-stone-300'
                    }`}
                >
                    {opt.label}
                </button>
            ))}
        </div>
    );
}
