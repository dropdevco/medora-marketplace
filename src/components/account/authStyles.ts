import type { CSSProperties } from 'react';

/**
 * The primary button in the clinic portal.
 *
 * A plain object rather than a class because every consumer is already writing
 * inline styles, and it lives here rather than beside AuthShell so that file
 * exports components and nothing else — fast refresh stops working for a file
 * that mixes the two.
 */
export const authButton: CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
    padding: '0.85rem 1.5rem',
    borderRadius: 'var(--radius-pill)',
    background: 'var(--brand)',
    color: 'var(--on-brand)',
    border: 'none',
    fontWeight: 700,
    fontSize: '0.95rem',
    cursor: 'pointer',
};
