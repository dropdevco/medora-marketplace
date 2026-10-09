const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 365 * 24 * 3600],
    ['month', 30 * 24 * 3600],
    ['week', 7 * 24 * 3600],
    ['day', 24 * 3600],
    ['hour', 3600],
    ['minute', 60],
];

/** "3 hours ago" / "hace 3 horas", in the UI language. */
export function timeAgo(iso: string, language: string): string {
    const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    const rtf = new Intl.RelativeTimeFormat(language.startsWith('es') ? 'es' : 'en', { numeric: 'auto' });
    for (const [unit, size] of STEPS) {
        if (seconds >= size) return rtf.format(-Math.floor(seconds / size), unit);
    }
    return rtf.format(0, 'minute');
}
