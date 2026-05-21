import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { type LucideIcon } from 'lucide-react';

type Size = 'xs' | 'sm' | 'md' | 'lg';
type Variant = 'surface' | 'overlay' | 'ghost';

interface IconButtonStyleOptions {
    size?: Size;
    variant?: Variant;
    danger?: boolean;
    active?: boolean;
    pill?: boolean;
}

const sizes: Record<Size, { button: string; icon: string }> = {
    xs: { button: 'p-1', icon: 'w-3.5 h-3.5' },
    sm: { button: 'p-1.5', icon: 'w-4 h-4' },
    md: { button: 'w-8 h-8', icon: 'w-4 h-4' },
    lg: { button: 'w-9 h-9', icon: 'w-4 h-4' },
};

const variants = {
    surface: {
        base: 'text-stone-400',
        hover: 'hover:bg-stone-100 hover:text-stone-600',
        danger: 'hover:bg-stone-100 hover:text-red-500',
        active: 'bg-stone-100 text-stone-700',
    },
    overlay: {
        base: 'text-white/70',
        hover: 'hover:text-white hover:bg-white/10',
        danger: 'hover:text-red-400 hover:bg-white/10',
        active: 'text-white bg-white/20',
    },
    ghost: {
        base: 'text-stone-500',
        hover: 'hover:bg-stone-200 hover:text-stone-700',
        danger: 'hover:bg-stone-200 hover:text-red-500',
        active: 'bg-stone-200 text-stone-700',
    },
};

/** Returns className strings for icon button styling on non-button elements (Link, a). */
export function getIconButtonStyles(opts: IconButtonStyleOptions = {}) {
    const {
        size = 'md',
        variant = 'surface',
        danger = false,
        active = false,
        pill,
    } = opts;

    const isPill = pill ?? variant === 'overlay';
    const shape = isPill ? 'rounded-full' : 'rounded-lg';
    const v = variants[variant];
    const s = sizes[size];
    const blur = variant === 'overlay' ? 'backdrop-blur-sm' : '';
    const color = active
        ? v.active
        : `${v.base} ${danger ? v.danger : v.hover}`;

    return {
        button: [
            'flex items-center justify-center',
            shape,
            'transition-all duration-200',
            s.button,
            color,
            blur,
        ]
            .filter(Boolean)
            .join(' '),
        icon: s.icon,
    };
}

interface IconButtonProps
    extends ButtonHTMLAttributes<HTMLButtonElement>,
        IconButtonStyleOptions {
    icon: LucideIcon;
    iconClassName?: string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
    function IconButton(
        {
            icon: Icon,
            size,
            variant,
            danger,
            active,
            pill,
            className = '',
            iconClassName,
            ...props
        },
        ref
    ) {
        const styles = getIconButtonStyles({
            size,
            variant,
            danger,
            active,
            pill,
        });

        return (
            <button
                ref={ref}
                className={`${styles.button} ${className}`}
                {...props}
            >
                <Icon className={iconClassName ?? styles.icon} />
            </button>
        );
    }
);
