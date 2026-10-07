import { useTranslation } from 'react-i18next';
import { IconSearch, IconSparkle } from '../icons/Icons';

export type SearchMode = 'regular' | 'smart';

interface SearchModeToggleProps {
    mode: SearchMode;
    onChange: (mode: SearchMode) => void;
}

/**
 * Switches the results toolbar between the two searches. It only swaps which
 * box is showing; nothing runs until the patient submits the box they chose.
 */
export function SearchModeToggle({ mode, onChange }: SearchModeToggleProps) {
    const { t } = useTranslation();
    return (
        <div className="ms-mode-toggle" role="group" aria-label={t('smart.modeLabel')}>
            <button
                type="button"
                className={`press${mode === 'regular' ? ' is-active' : ''}`}
                aria-pressed={mode === 'regular'}
                onClick={() => onChange('regular')}
            >
                <IconSearch size={14} weight={2} />
                {t('smart.modeRegular')}
            </button>
            <button
                type="button"
                className={`press${mode === 'smart' ? ' is-active' : ''}`}
                aria-pressed={mode === 'smart'}
                onClick={() => onChange('smart')}
            >
                <IconSparkle size={14} weight={2} />
                {t('smart.modeSmart')}
            </button>
        </div>
    );
}
