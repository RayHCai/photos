import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export default function NotFound() {
    return (
        <div className="min-h-screen flex flex-col items-center justify-center gap-4">
            <h1 className="text-5xl font-serif text-stone-900">404</h1>
            <p className="text-stone-500">Page not found</p>
            <Link
                href="/"
                className="flex items-center gap-1 text-sm text-stone-600 hover:text-stone-900 transition-colors"
            >
                <ArrowLeft className="w-4 h-4" />
                Home
            </Link>
        </div>
    );
}
