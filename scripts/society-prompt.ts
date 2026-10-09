/**
 * Post a MedSociety team question into a forum, or moderate one.
 *
 * Team prompts are `is_prompt` threads with no author, which no client can
 * create (see supabase/migrations/0015_forums.sql), so this runs with the
 * service-role key and must stay local / CI only.
 *
 *   # Ask the doctors something (pinned by default)
 *   npx tsx --env-file=.env.local scripts/society-prompt.ts post "What's the one question patients from the US always ask you?" "Tell us how you answer it."
 *
 *   # Posting to Med Society also emails every clinician (pass --no-email to skip).
 *
 *   # Same, into the patient forum, tagged, not pinned
 *   npx tsx --env-file=.env.local scripts/society-prompt.ts post "Can I get a dental cleaning while pregnant?" "" --forum=patients --topic=dentist --no-pin
 *
 *   # List recent threads (both forums, hidden included)
 *   npx tsx --env-file=.env.local scripts/society-prompt.ts list
 *
 *   # Pin / unpin / hide / unhide a thread, or hide a reply
 *   npx tsx --env-file=.env.local scripts/society-prompt.ts pin <thread-id>
 *   npx tsx --env-file=.env.local scripts/society-prompt.ts hide <thread-id>
 *   npx tsx --env-file=.env.local scripts/society-prompt.ts hide-reply <reply-id>
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const [command, ...rest] = process.argv.slice(2);
const flags = Object.fromEntries(
  rest.filter((a) => a.startsWith('--')).map((a) => {
    const [k, v] = a.slice(2).split('=');
    return [k, v ?? 'true'];
  }),
);
const args = rest.filter((a) => !a.startsWith('--'));

function fail(message: string): never {
  console.error('❌', message);
  process.exit(1);
}

async function setFlag(table: 'forum_threads' | 'forum_replies', id: string, patch: Record<string, boolean>) {
  if (!id) fail('Missing id.');
  const { error } = await supabase.from(table).update(patch).eq('id', id);
  if (error) fail(error.message);
  console.log(`✅ ${table} ${id}:`, patch);
}

switch (command) {
  case 'post': {
    const [title, body = ''] = args;
    if (!title || title.length < 5) fail('Give a title of at least 5 characters.');
    const forum = flags.forum ?? 'society';
    if (forum !== 'society' && forum !== 'patients') fail('--forum must be society or patients.');
    const { data, error } = await supabase
      .from('forum_threads')
      .insert({
        forum,
        author_id: null,
        author_name: 'MedSociety',
        title,
        body,
        specialty: flags.topic ?? null,
        is_prompt: true,
        pinned: flags['no-pin'] !== 'true',
      })
      .select('id')
      .single();
    if (error) fail(error.message);
    const site = (process.env.PUBLIC_SITE_URL || 'https://medsociety.one').replace(/\/$/, '');
    // Keep in sync with src/lib/forumRoutes.ts (unlisted until launch).
    const path = forum === 'society'
      ? (process.env.FORUM_SOCIETY_PATH || '/s-p4bm06qny')
      : (process.env.FORUM_ASK_PATH || '/q-vj2ggfdrw');
    console.log(`✅ Posted. ${site}${path}/${data.id}`);

    // Emails every clinician (Med Society prompts only; see api/forum-notify.ts).
    // Goes through the deployed function, which holds the Resend key. If this
    // fails, the daily cron sweep sends it instead.
    if (forum === 'society' && flags['no-email'] !== 'true') {
      const res = await fetch(`${site}/api/forum-notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'thread', id: data.id }),
      }).catch((e: Error) => ({ ok: false, status: 0, json: async () => ({ error: e.message }) }));
      const out = await res.json().catch(() => ({}));
      console.log(res.ok
        ? `📧 Emailed ${out.sent ?? 0} clinician(s).`
        : `⚠️  Email not sent now (${res.status}); the daily sweep will retry.`);
    }
    break;
  }
  case 'list': {
    const { data, error } = await supabase
      .from('forum_threads')
      .select('id, forum, title, author_name, reply_count, doctor_reply_count, pinned, hidden, is_prompt, created_at')
      .order('created_at', { ascending: false })
      .limit(Number(flags.limit ?? 30));
    if (error) fail(error.message);
    for (const t of data ?? []) {
      const marks = [t.pinned && 'pinned', t.hidden && 'HIDDEN', t.is_prompt && 'prompt'].filter(Boolean).join(',');
      console.log(
        `${t.id}  [${t.forum}${marks ? ` ${marks}` : ''}] ${t.title}\n` +
        `    by ${t.author_name} · ${t.reply_count} replies (${t.doctor_reply_count} from doctors) · ${new Date(t.created_at).toLocaleString()}`,
      );
    }
    break;
  }
  case 'pin': await setFlag('forum_threads', args[0], { pinned: true }); break;
  case 'unpin': await setFlag('forum_threads', args[0], { pinned: false }); break;
  case 'hide': await setFlag('forum_threads', args[0], { hidden: true }); break;
  case 'unhide': await setFlag('forum_threads', args[0], { hidden: false }); break;
  case 'hide-reply': await setFlag('forum_replies', args[0], { hidden: true }); break;
  case 'unhide-reply': await setFlag('forum_replies', args[0], { hidden: false }); break;
  default:
    fail('Usage: society-prompt.ts post|list|pin|unpin|hide|unhide|hide-reply|unhide-reply …');
}
