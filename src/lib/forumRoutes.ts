/**
 * Where the two forums live, and whether the rest of the site points at them.
 *
 * Both forums are deployed but unlisted: they sit under random slugs, nothing
 * links to them, and their pages are `noindex`. Only someone handed the URL
 * gets in. That is obscurity, not access control: the slugs ship in the
 * client bundle, and anyone who finds one can read the patient forum and
 * (signed in) post to it. Fine for a team soft-launch; not a substitute for
 * a real gate if the content ever becomes sensitive.
 *
 * To launch publicly:
 *   1. set FORUMS_LISTED to true — the nav links, the "Answers on MedSociety"
 *      block on provider pages and the dashboard card all switch on;
 *   2. change the paths to '/ask' and '/society';
 *   3. change the same two paths in api/forum-notify.ts and
 *      scripts/society-prompt.ts, which cannot import from src/ and so carry
 *      their own copy (they build the links inside emails).
 *
 * The slugs are not secrets in the credentials sense, but do not paste them
 * anywhere public: that is the whole of the protection.
 */
import type { ForumKind } from './forum';

export const FORUMS_LISTED = false;

export const FORUM_PATH: Record<ForumKind, string> = {
    patients: '/q-vj2ggfdrw',
    society: '/s-p4bm06qny',
};
