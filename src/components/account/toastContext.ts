import { createContext, useContext } from 'react';

export type ToastKind = 'success' | 'error';
export type PushToast = (message: string, kind?: ToastKind) => void;

export const ToastContext = createContext<PushToast>(() => {});

/** Show a small confirmation. Safe to call outside a provider (no-op). */
export function useToast(): PushToast {
    return useContext(ToastContext);
}
