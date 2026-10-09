import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { countUnanswered, listAnswersByProvider } from '../../lib/forum';
import { FORUM_PATH } from '../../lib/forumRoutes';
import { IconReviews, IconArrowRight } from '../icons/Icons';
import { timeAgo } from '../../utils/timeAgo';
import './forum.css';

type Answers = Awaited<ReturnType<typeof listAnswersByProvider>>;

/**
 * "Answers on MedSociety" on a provider's public page — the other half of the
 * deal a doctor makes by answering: the answer links to the profile, and the
 * profile shows the answers. Renders nothing until there is one.
 */
export function DoctorAnswers({ providerId }: { providerId: string }) {
    const { t, i18n } = useTranslation();
    const [data, setData] = useState<Answers & { for: string } | null>(null);

    useEffect(() => {
        let cancelled = false;
        void listAnswersByProvider(providerId).then((res) => {
            if (!cancelled) setData({ ...res, for: providerId });
        });
        return () => { cancelled = true; };
    }, [providerId]);

    if (!data || data.for !== providerId || data.total === 0) return null;

    return (
        <section style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div>
                <h3 style={{ fontSize: '1.05rem', fontWeight: 800 }}>{t('forum.answersFromDoctor')}</h3>
                <p style={{ fontSize: '0.84rem', color: 'var(--gray-500)' }}>
                    {t('forum.answersFromDoctorCount', { count: data.total })}
                </p>
            </div>
            {data.answers.map((a) => (
                <Link key={a.id} to={`${FORUM_PATH.patients}/${a.thread.id}`} className="forum-card press" style={{ gap: '0.35rem' }}>
                    <span className="forum-card-title" style={{ fontSize: '0.95rem' }}>{a.thread.title}</span>
                    <span className="forum-card-body">{a.body}</span>
                    <span className="forum-when" style={{ fontSize: '0.76rem', color: 'var(--gray-500)' }}>
                        {timeAgo(a.created_at, i18n.language)}
                    </span>
                </Link>
            ))}
        </section>
    );
}

/** The dashboard nudge: unanswered patient questions in this clinic's field. */
export function ForumDashCard({ specialties }: { specialties: string[] }) {
    const { t } = useTranslation();
    const key = specialties.join(',');
    const [count, setCount] = useState<{ key: string; n: number } | null>(null);

    useEffect(() => {
        let cancelled = false;
        void countUnanswered(key ? key.split(',') : []).then((n) => {
            if (!cancelled) setCount({ key, n });
        });
        return () => { cancelled = true; };
    }, [key]);

    const n = count?.key === key ? count.n : 0;

    return (
        <div className="forum-banner" style={{ alignItems: 'flex-start' }}>
            <IconReviews size={20} />
            <div>
                <strong>{n > 0 ? t('forum.dashTitle', { count: n }) : t('forum.ask.doctorBannerTitle')}</strong>
                <p>{t('forum.dashBody')}</p>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
                    <Link to={`${FORUM_PATH.patients}?sort=unanswered`} className="forum-btn press" style={{ textDecoration: 'none' }}>
                        {t('forum.dashCta')} <IconArrowRight size={15} weight={2} />
                    </Link>
                    <Link to={FORUM_PATH.society} className="forum-btn-ghost press">{t('forum.dashSociety')}</Link>
                </div>
            </div>
        </div>
    );
}
