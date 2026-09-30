import { useCallback, useRef, useState, type ReactNode } from 'react';
import { IconCheck, IconClose } from '../icons/Icons';
import { ToastContext, type PushToast, type ToastKind } from './toastContext';

interface ToastItem { id: number; message: string; kind: ToastKind }

/** Bottom-centre confirmation toasts for the clinic portal. */
export function ToastProvider({ children }: { children: ReactNode }) {
    const [items, setItems] = useState<ToastItem[]>([]);
    const nextId = useRef(1);

    const push = useCallback<PushToast>((message, kind = 'success') => {
        const id = nextId.current++;
        setItems((prev) => [...prev.slice(-2), { id, message, kind }]);
        window.setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3200);
    }, []);

    return (
        <ToastContext.Provider value={push}>
            {children}
            <div className="acct-toasts" role="status" aria-live="polite">
                {items.map((it) => (
                    <div key={it.id} className={`acct-toast acct-toast--${it.kind}`}>
                        {it.kind === 'success'
                            ? <IconCheck size={16} weight={2.4} />
                            : <IconClose size={16} weight={2.4} />}
                        <span>{it.message}</span>
                    </div>
                ))}
            </div>
        </ToastContext.Provider>
    );
}
