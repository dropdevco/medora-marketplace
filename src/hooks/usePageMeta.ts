import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { Provider } from '../types/provider';

/**
 * Sets `document.title` and the `<meta name="description">` for the loaded
 * provider, restoring whatever the app had before once the page unmounts —
 * this route is one page in a full SPA nav tree, not a standalone document,
 * so it must give the title back rather than leave the next page wearing it.
 */
export function usePageMeta(provider: Provider | null) {
    const { t, i18n } = useTranslation();

    useEffect(() => {
        if (!provider) return;

        const previousTitle = document.title;
        const metaEl = document.querySelector('meta[name="description"]');
        const previousDescription = metaEl?.getAttribute('content') ?? null;

        document.title = t('providerPage.pageTitle', {
            name: provider.name,
            defaultValue: `${provider.name} — MedSociety`,
        });

        const specialtyLabel = provider.specialty
            .map((s) => t(`specialties.${s}`, { defaultValue: s }))
            .join(', ');
        const description = t('providerPage.pageDescription', {
            name: provider.name,
            specialty: specialtyLabel,
            city: provider.city,
            defaultValue: `${provider.name} — ${specialtyLabel} in ${provider.city}. Ratings, prices, insurance and contact info on MedSociety.`,
        });
        metaEl?.setAttribute('content', description);

        return () => {
            document.title = previousTitle;
            if (metaEl && previousDescription !== null) metaEl.setAttribute('content', previousDescription);
        };
    }, [provider, t, i18n.language]);
}
