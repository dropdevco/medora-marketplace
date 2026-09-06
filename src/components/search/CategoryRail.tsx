import { useTranslation } from 'react-i18next';
import type { Specialty } from '../../types/provider';
import { SpecialtyIcon } from '../icons/Icons';

interface CategoryRailProps {
    /** Specialties in directory order, largest first. */
    order: Specialty[];
    active: Specialty[];
    onToggle: (s: Specialty) => void;
}

/**
 * The icon rail across the top, and the fastest path through the whole app.
 *
 * Airbnb puts its categories above the search box because most arrivals are
 * one word away from what they want — and so are these. A tap sets the
 * specialty filter directly, which means the shortest possible query is one
 * click, no typing, no map.
 */
export function CategoryRail({ order, active, onToggle }: CategoryRailProps) {
    const { t } = useTranslation();

    return (
        <div className="ms-cats" role="tablist" aria-label={t('filters.specialtyGroup')}>
            {order.map((s) => {
                const on = active.includes(s);
                return (
                    <button
                        key={s}
                        role="tab"
                        aria-selected={on}
                        onClick={() => onToggle(s)}
                        className={`ms-cat${on ? ' is-active' : ''}`}
                    >
                        <SpecialtyIcon specialty={s} size={22} weight={1.7} />
                        <span>{t(`specialties.${s}`)}</span>
                    </button>
                );
            })}
        </div>
    );
}
