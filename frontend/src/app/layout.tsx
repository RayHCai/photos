import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
    title: 'Photos',
    description: 'Personal photo and video library',
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="en">
            <body className="bg-stone-50 text-stone-900">
                <Providers>{children}</Providers>
            </body>
        </html>
    );
}
