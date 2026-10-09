import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FORUM_PATH } from '../../lib/forumRoutes';
import { AuthShell } from '../account/AuthShell';
import { authButton } from '../account/authStyles';
import { IconLock } from '../icons/Icons';

/**
 * What a non-clinician sees at the Med Society path. Not a 404 and not a bare "access
 * denied": Med Society is a reason to claim a listing, so the door says what
 * is behind it and how to get the key.
 */
export function ClinicianGate({ signedIn }: { signedIn: boolean }) {
    const { t } = useTranslation();
    return (
        <AuthShell title={t('forum.society.gateTitle')} subtitle={t('forum.society.gateBody')}>
            <div style={{ display: 'flex', justifyContent: 'center', color: 'var(--gray-500)', marginBottom: '1.4rem' }}>
                <IconLock size={34} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
                <Link to="/" className="press" style={{ ...authButton, textDecoration: 'none' }}>
                    {t('forum.society.gateClaim')}
                </Link>
                {!signedIn && (
                    <Link
                        to={`/login?next=${encodeURIComponent(FORUM_PATH.society)}`}
                        style={{ textAlign: 'center', fontSize: '0.88rem', fontWeight: 700, color: 'var(--accent)' }}
                    >
                        {t('forum.society.gateSignIn')}
                    </Link>
                )}
                <Link to={FORUM_PATH.patients} style={{ textAlign: 'center', fontSize: '0.84rem', color: 'var(--gray-500)', textDecoration: 'underline' }}>
                    {t('forum.society.gatePatients')}
                </Link>
            </div>
        </AuthShell>
    );
}
