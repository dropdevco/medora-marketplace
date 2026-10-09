import { useEffect } from 'react';

/**
 * Asks search engines to skip the current page, for as long as it is mounted.
 *
 * The forums are deployed but unlisted, and a crawler that somehow found one
 * would otherwise index it. A meta tag rather than robots.txt: a Disallow
 * line would publish the very path we are trying not to advertise.
 */
export function useNoIndex() {
    useEffect(() => {
        const meta = document.createElement('meta');
        meta.name = 'robots';
        meta.content = 'noindex, nofollow';
        document.head.appendChild(meta);
        return () => { meta.remove(); };
    }, []);
}
