import { type LucideIcon, Images, FolderOpen, Users } from 'lucide-react';

export interface NavItem {
    href: string;
    label: string;
    icon: LucideIcon;
}

export const navItems: NavItem[] = [
    { href: '/', label: 'Gallery', icon: Images },
    { href: '/collections', label: 'Collections', icon: FolderOpen },
    { href: '/persons', label: 'People', icon: Users },
];
