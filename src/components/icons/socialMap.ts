import type { ProviderSocials } from '../../types/provider';
import {
    IconFacebook, IconInstagram, IconTikTok, IconYouTube, IconX, IconLinkedIn, IconWhatsApp,
    type SocialIconProps,
} from './SocialIcons';

export type SocialKey = keyof ProviderSocials;

export const SOCIAL_ORDER: SocialKey[] = ['whatsapp', 'instagram', 'facebook', 'tiktok', 'youtube', 'x', 'linkedin'];

export const SOCIAL_ICONS: Record<SocialKey, (p: SocialIconProps) => React.JSX.Element> = {
    facebook: IconFacebook, instagram: IconInstagram, tiktok: IconTikTok,
    youtube: IconYouTube, x: IconX, linkedin: IconLinkedIn, whatsapp: IconWhatsApp,
};
