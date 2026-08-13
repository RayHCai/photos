'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from './Button';

interface Props {
    children: ReactNode;
    /** Shown instead of the default panel. */
    fallback?: (error: Error, reset: () => void) => ReactNode;
    /** Label for the region that failed, e.g. "gallery". */
    label?: string;
}

interface State {
    error: Error | null;
}

/**
 * Catches render-time exceptions in a subtree.
 *
 * There was no error boundary anywhere in the app and no app/error.tsx, so a single
 * throw in the gallery — a malformed item, a layout-math edge case — unmounted the
 * entire React tree and left a blank white page with no way back except a manual
 * reload.
 */
export class ErrorBoundary extends Component<Props, State> {
    state: State = { error: null };

    static getDerivedStateFromError(error: Error): State {
        return { error };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        // No error-reporting service is wired up yet; the console is the only sink.
        console.error(`[ErrorBoundary${this.props.label ? `: ${this.props.label}` : ''}]`, error, info.componentStack);
    }

    private reset = () => this.setState({ error: null });

    render() {
        const { error } = this.state;
        if (!error) return this.props.children;

        if (this.props.fallback) return this.props.fallback(error, this.reset);

        return (
            <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
                <AlertTriangle className="w-8 h-8 text-amber-500" aria-hidden="true" />
                <p className="text-sm font-medium text-stone-800">
                    Something went wrong{this.props.label ? ` loading the ${this.props.label}` : ''}.
                </p>
                <p className="max-w-md text-xs text-stone-500">{error.message}</p>
                <Button onClick={this.reset}>Try again</Button>
            </div>
        );
    }
}
