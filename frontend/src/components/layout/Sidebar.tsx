'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { navItems } from '@/lib/constants/navigation';
import { useQuery } from '@tanstack/react-query';
import { getIconButtonStyles } from '@/components/ui/IconButton';
import { getWorkerStatus } from '@/lib/api/jobs';

/**
 * Worker liveness, from its heartbeat. Grey until the first answer arrives so a
 * page load never flashes red.
 */
function WorkerStatusDot() {
    const { data, isError } = useQuery({
        queryKey: ['worker-status'],
        queryFn: getWorkerStatus,
        refetchInterval: 30_000,
        refetchOnWindowFocus: true,
    });

    const online = data?.online === true;
    const known = data !== undefined || isError;
    const color = !known ? 'bg-stone-300' : online ? 'bg-emerald-500' : 'bg-red-500';
    const label = !known ? 'Worker status unknown' : online ? 'Worker online' : 'Worker offline';

    return (
        <span
            title={label}
            aria-label={label}
            role="status"
            className={`absolute top-1 right-1 w-2 h-2 rounded-full ring-2 ring-white ${color}`}
        />
    );
}

export function Sidebar() {
    const pathname = usePathname();
    const [open, setOpen] = useState(false);

    return (
        <>
            {/* Click-outside overlay */}
            {open && (
                <div
                    className="fixed inset-0 z-40"
                    onClick={() => setOpen(false)}
                />
            )}

            <div className={`fixed top-4 left-4 z-50 flex flex-col items-center gap-1 rounded-xl p-1 transition-all duration-300 ${
                open ? 'bg-white/80 backdrop-blur-lg shadow-lg shadow-stone-200/50' : 'bg-transparent'
            }`}>
                {/* Hamburger / X toggle */}
                <button
                    onClick={() => setOpen(!open)}
                    className="relative w-9 h-9 flex items-center justify-center rounded-lg hover:bg-stone-100 transition-colors duration-200"
                    aria-label={open ? 'Close menu' : 'Open menu'}
                >
                    <div className="w-4 h-3 relative">
                        <span
                            className={`absolute left-0 w-full h-[1.5px] bg-stone-500 transition-all duration-300 origin-center ${
                                open ? 'top-[5px] rotate-45' : 'top-0 rotate-0'
                            }`}
                        />
                        <span
                            className={`absolute left-0 top-[5px] w-full h-[1.5px] bg-stone-500 transition-all duration-300 ${
                                open ? 'opacity-0 scale-x-0' : 'opacity-100 scale-x-100'
                            }`}
                        />
                        <span
                            className={`absolute left-0 w-full h-[1.5px] bg-stone-500 transition-all duration-300 origin-center ${
                                open ? 'top-[5px] -rotate-45' : 'top-[10px] rotate-0'
                            }`}
                        />
                    </div>
                    <WorkerStatusDot />
                </button>

                {/* Nav icons - slide down */}
                {navItems.map((item, i) => {
                    const isActive =
                        item.href === '/'
                            ? pathname === '/'
                            : pathname.startsWith(item.href);
                    const styles = getIconButtonStyles({ size: 'lg', variant: 'surface', active: isActive });
                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            onClick={() => setOpen(false)}
                            title={item.label}
                            className={`${styles.button} ${
                                open
                                    ? 'opacity-100 translate-y-0'
                                    : 'opacity-0 -translate-y-2 pointer-events-none'
                            }`}
                            style={{
                                transitionDelay: open ? `${(i + 1) * 60}ms` : '0ms',
                            }}
                        >
                            <item.icon className={styles.icon} />
                        </Link>
                    );
                })}
            </div>
        </>
    );
}
