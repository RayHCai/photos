import { type LucideIcon, Images, FolderOpen, Users, EyeOff, Settings } from 'lucide-react';

interface NavItem {
    href: string;
    label: string;
    icon: LucideIcon;
}

export const navItems: NavItem[] = [
    { href: '/', label: 'Gallery', icon: Images },
    { href: '/collections', label: 'Collections', icon: FolderOpen },
    { href: '/persons', label: 'People', icon: Users },
    { href: '/hidden', label: 'Hidden', icon: EyeOff },
    { href: '/settings', label: 'Settings', icon: Settings },
];
