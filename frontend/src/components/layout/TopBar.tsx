'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Menu, X, Upload } from 'lucide-react';
import { useFileUpload } from '@/lib/hooks/useFileUpload';
import { navItems } from '@/lib/constants/navigation';
import { IconButton, getIconButtonStyles } from '@/components/ui/IconButton';

interface TopBarProps {
    sidebarOpen: boolean;
    onToggleSidebar: () => void;
}

export function TopBar({ sidebarOpen, onToggleSidebar }: TopBarProps) {
    const pathname = usePathname();
    const { openFilePicker } = useFileUpload();

    return (
        <>
            <header className="fixed top-0 left-0 right-0 h-14 bg-stone-50 z-20 flex items-center px-4 gap-3">
                {/* Hamburger / X toggle */}
                <button
                    onClick={onToggleSidebar}
                    className="p-2 rounded hover:bg-stone-100 text-stone-400 transition-all duration-200"
                >
                    <div className={`transition-transform duration-200 ${sidebarOpen ? 'rotate-90' : 'rotate-0'}`}>
                        {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
                    </div>
                </button>

                <div className="flex-1" />

                <IconButton
                    icon={Upload}
                    size="lg"
                    iconClassName="w-5 h-5"
                    onClick={openFilePicker}
                    title="Upload"
                />
            </header>

            {/* Vertical nav dropdown below hamburger */}
            <div
                className={`fixed top-14 left-4 z-20 flex flex-col gap-1 py-2 transition-all duration-200 ease-out ${
                    sidebarOpen
                        ? 'opacity-100 translate-y-0'
                        : 'opacity-0 -translate-y-2 pointer-events-none'
                }`}
            >
                {navItems.filter((item) => item.href !== '/settings').map((item) => {
                    const isActive =
                        item.href === '/'
                            ? pathname === '/'
                            : pathname.startsWith(item.href);
                    const styles = getIconButtonStyles({ size: 'md', variant: 'surface', active: isActive });
                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            title={item.label}
                            className={styles.button}
                        >
                            <item.icon className={styles.icon} />
                        </Link>
                    );
                })}
            </div>
        </>
    );
}
