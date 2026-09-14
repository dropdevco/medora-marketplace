import { useTranslation } from 'react-i18next';
import type { Provider } from '../../types/provider';
import { ratingOf } from '../../utils/rating';
import { hueOf } from '../../utils/images';
import { usePortraitPhoto } from '../../hooks/usePortraitPhoto';
import { IconStar, IconClipboard, SpecialtyIcon } from '../icons/Icons';

interface ProviderTileProps {
    provider: Provider;
    onClick: (p: Provider) => void;
}

/**
 * The browse-row card: image first, words second.
 *
 * Airbnb's home page works because the photo does the persuading and the text
 * only confirms it. Two thirds of this directory has no usable portrait, so the
 * fallback has to carry the same weight — a specialty-tinted panel with the
 * clinic's monogram, coloured deterministically from its id. It reads as a
 * designed cover rather than as a missing image.
 */
export function ProviderTile({ provider, onClick }: ProviderTileProps) {
    const rating = ratingOf(provider);
    const { t } = useTranslation();
    // Falls back to a live Google Places photo when there is no usable
    // `imageUrl` — see usePortraitPhoto. Without it, a tile in the Discover
    // rows showed the specialty monogram for a clinic whose own drawer
    // already had a real photo.
    const { url: photo } = usePortraitPhoto(provider);
    const accent = provider.country === 'MX' ? 'var(--mx)' : 'var(--us)';
    const side = provider.country === 'MX' ? t('drawer.ciudadJuarez') : t('drawer.elPaso');

    return (
        <button
            onClick={() => onClick(provider)}
            className="ms-tile"
            style={{
                width: '100%', textAlign: 'left', background: 'none',
                color: 'var(--white)', padding: 0,
                display: 'flex', flexDirection: 'column', gap: '0.6rem',
            }}
        >
            <div
                className="ms-tile-media"
                style={{
                    position: 'relative', width: '100%', aspectRatio: '1 / 1',
                    borderRadius: 'var(--radius)', overflow: 'hidden',
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                }}
            >
                {photo ? (
                    <img
                        src={photo}
                        alt=""
                        loading="lazy"
                        className="ms-tile-img"
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        onError={(e) => {
                            // A dead CDN link would otherwise leave a torn-image
                            // glyph on the cover; drop back to the monogram.
                            const img = e.currentTarget;
                            img.style.display = 'none';
                            const fallback = img.nextElementSibling as HTMLElement | null;
                            if (fallback) fallback.style.display = 'flex';
                        }}
                    />
                ) : null}

                <Monogram provider={provider} hidden={Boolean(photo)} />

                {provider.promoted && (
                    <span style={{
                        position: 'absolute', top: 10, left: 10,
                        padding: '0.2rem 0.6rem', borderRadius: 'var(--radius-pill)',
                        background: 'var(--navy-800)', color: 'var(--gold)',
                        fontSize: '0.66rem', fontWeight: 800,
                        letterSpacing: '0.06em', textTransform: 'uppercase',
                        border: '1px solid var(--border)',
                    }}>
                        {t('drawer.promoted')}
                    </span>
                )}

                {/*
                  No verified/licensed mark on the photo itself. Verified is a
                  paid feature — stamping it on the cover for free, in the one
                  slot everyone sees before they read a word of text, gave
                  away the thing a plan is meant to buy. The same fact still
                  shows as a text badge on the card and the drawer; it just
                  doesn't ride on the image here.
                */}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.18rem', minWidth: 0 }}>
                <div style={{
                    display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '0.5rem',
                }}>
                    <p style={{
                        fontWeight: 700, fontSize: '0.95rem', lineHeight: 1.3, minWidth: 0,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                        {provider.name}
                    </p>
                    {/* A tile is narrow enough that "New" is the whole badge,
                        but printing 0.0 here was the same lie as on the card. */}
                    {rating !== null ? (
                        <span style={{
                            display: 'flex', alignItems: 'center', gap: '0.22rem',
                            fontSize: '0.82rem', flexShrink: 0,
                        }}>
                            <IconStar size={13} filled style={{ color: 'var(--star)' }} />
                            <strong style={{ fontWeight: 700 }}>{rating.toFixed(1)}</strong>
                        </span>
                    ) : (
                        <span style={{
                            fontSize: '0.74rem', flexShrink: 0, fontWeight: 700,
                            color: 'var(--gray-500)',
                        }}>
                            {t('card.new')}
                        </span>
                    )}
                </div>

                <p style={{
                    fontSize: '0.84rem', color: 'var(--gray-400)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                    {provider.specialty
                        .slice(0, 2)
                        .map((s) => t(`specialties.${s}`, { defaultValue: s }))
                        .join(' · ')}
                </p>

                <p style={{
                    fontSize: '0.84rem', color: 'var(--gray-500)',
                    display: 'flex', alignItems: 'center', gap: '0.35rem',
                }}>
                    <span style={{
                        width: 6, height: 6, borderRadius: '50%',
                        background: accent, flexShrink: 0,
                    }} />
                    {side}
                </p>

                {(provider.priceFromMxn != null || provider.bookingUrl) && (
                    <p style={{
                        marginTop: '0.15rem', fontSize: '0.84rem',
                        display: 'flex', alignItems: 'center', gap: '0.45rem',
                    }}>
                        {provider.priceFromMxn != null && (
                            <span style={{ fontWeight: 700 }}>
                                {t('card.priceFrom', {
                                    price: `$${provider.priceFromMxn.toLocaleString()}`,
                                    defaultValue: `From $${provider.priceFromMxn.toLocaleString()}`,
                                })}
                            </span>
                        )}
                        {provider.bookingUrl && (
                            <span style={{
                                display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                                color: 'var(--gray-500)', fontSize: '0.78rem', fontWeight: 600,
                            }}>
                                <IconClipboard size={12} weight={2} />
                                {t('filters.bookable')}
                            </span>
                        )}
                    </p>
                )}
            </div>
        </button>
    );
}

/**
 * The no-photo cover. A specialty glyph bled off the corner at low contrast,
 * with the clinic's initials on top — enough shape and colour to make a row
 * of them scan as a set of distinct places.
 */
function Monogram({ provider, hidden }: { provider: Provider; hidden: boolean }) {
    const hue = hueOf(provider.id);
    const initials = provider.name
        .replace(/^(Dr|Dra|Lic|Mtro|Mtra)\.?\s+/i, '')
        .split(/\s+/)
        .filter((w) => /[\p{L}]/u.test(w))
        .slice(0, 2)
        .map((w) => w[0].toUpperCase())
        .join('');

    return (
        <span
            className="ms-mono"
            style={{
                // The hue is the only per-provider part; the theme supplies the
                // rest, so the cover follows a light/dark flip.
                ['--mono-h' as string]: `${hue}deg`,
                position: 'absolute', inset: 0,
                display: hidden ? 'none' : 'flex',
                alignItems: 'center', justifyContent: 'center',
                overflow: 'hidden',
            } as React.CSSProperties}
        >
            <span style={{
                position: 'absolute', right: '-14%', bottom: '-16%',
                opacity: 0.22, display: 'flex',
            }}>
                <SpecialtyIcon specialty={provider.specialty[0]} size={132} weight={1.1} />
            </span>
            <span style={{
                position: 'relative',
                fontSize: '1.9rem', fontWeight: 800, letterSpacing: '0.04em',
            }}>
                {initials || '·'}
            </span>
        </span>
    );
}
