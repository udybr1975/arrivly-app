import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { isCronAuthorized } from './_lib/cron.js'
import { sendNtfy } from './_lib/ntfy.js'

// Daily cron (04:00 UTC, ahead of the 05:00 message sweep). Data-retention cleanup for everything
// EXCEPT messages, which `cron-cleanup-messages.ts` owns.
//
// THESE PERIODS ARE A PUBLISHED PROMISE, NOT A TUNING KNOB. Each one is stated in
// docs/legal-guest-privacy-notice-DRAFT.md §6. Changing a constant here without changing the
// notice — or the reverse — makes the notice FALSE, which is materially worse than having no
// notice at all. Change both, in the same commit, or neither.
//
// Every sweep is a HARD DELETE (data minimisation): rows are removed, not flagged. Each runs as a
// single set-based statement inside a SECURITY DEFINER function, so the work is one server-side
// statement rather than a per-row loop. All four were service-role only when verified against the
// live ACL on 11 Aug 2026 (`{postgres=X/postgres,service_role=X/postgres}`; anon and authenticated
// both false) — a DATED observation about live DB state, not a standing guarantee. It matters
// because Supabase auto-grants EXECUTE to anon+authenticated on every new public function and
// these functions delete guest data irreversibly. Re-check the ACL, not this comment.
//
// THE PREDICATES ARE NOT IN THIS REPO. The four functions were applied via MCP and appear in no
// commit, so what they DELETE cannot be reviewed from a diff. Verified against the live DB on
// 11 Aug 2026, before first deploy: identities null `bookings.guest_id` then delete orphaned
// guests; greetings join `bookings` and anchor on `b.check_out` (NOT `local_date`); push filters
// `role = 'guest'` FIRST, so host account-level subs — the `apartment_id IS NULL` rows — are
// excluded by role (and a NULL role would be excluded too, since NULL never satisfies equality);
// audit is plain `created_at` age. None carries a demo/exempt/host/apartment filter.
// ONE EXCEPTION TO "AFTER CHECK-OUT", stated because §6 says check-out and this branch does not:
// the push sweep has a second leg for `booking_id IS NULL` guest rows anchored on `created_at`,
// not check-out. It cannot cut a live stay short — `api/guest-subscribe.ts` always sets
// `booking_id`, and the host path is only ever called with a hostId — so it is a legacy safety net
// for orphans rather than a path §6 describes. Re-verify all of this after any change to them.
//
// NO EXEMPTIONS, EVER — not for test fixtures, not for a host, not for an apartment. A retention
// sweep with a carve-out makes the notice false for everyone. Fixtures survive by having their
// DATES refreshed, never by being skipped here.

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// notice §6: "Your name, surname, email — 30 days after check-out, then permanently erased".
// Erasure is of the IDENTITY, not the booking: the RPC nulls `bookings.guest_id` on bookings past
// the window and then deletes only guest rows no booking still references, so the booking survives
// with no name attached — which is what §6 promises ("stay dates ... with no name attached"). The
// host keeps their calendar and their revenue history.
//
// THERE IS NO "RETURNING GUEST" CASE TO PROTECT, and do not add reasoning that assumes one. ALL
// THREE `guests` writers insert fresh with no cross-booking dedup — `api/create-booking.ts`,
// `api/import-airbnb-csv.ts` (updates the row in place, never reuses one across bookings) and
// `api/demo-create.ts` — so a row is tied to exactly ONE booking and is erased 30 days after THAT
// booking's check-out. An earlier draft of this comment claimed a recent stay keeps an older
// identity alive; under this schema it cannot. **Adding cross-booking dedup is the one schema
// change that would silently alter what this 30-day sweep means** — re-read §6 if it is ever
// proposed.
const GUEST_IDENTITY_DAYS = 30
// notice §6: "Automatically generated daily suggestions — 30 days after check-out".
const GREETING_DAYS = 30
// notice §6: "Notification registration — 7 days after check-out". Shortest period here: a push
// subscription is useless once the stay has ended, so it is the easiest thing to stop holding.
const GUEST_PUSH_DAYS = 7
// Bemgu as CONTROLLER in its own right (admin actions on host accounts) — contains NO guest data,
// which is why it is a year rather than a month. Not covered by the guest notice §6.
const ADMIN_AUDIT_DAYS = 365

// The one catastrophic failure mode, guarded before anything runs. These deletes are irreversible,
// and a constant of 0 (or a near-zero typo) would not "retain less" — it would empty the table on
// the next run. A floor is cheap; the alternative is a restore from backup.
const MIN_SAFE_DAYS = 7

type Sweep = { key: 'guestIdentities' | 'greetings' | 'guestPush' | 'adminAudit'; fn: string; days: number; label: string }

const SWEEPS: Sweep[] = [
  { key: 'guestIdentities', fn: 'cleanup_guest_identities', days: GUEST_IDENTITY_DAYS, label: 'guest identities' },
  { key: 'greetings', fn: 'cleanup_old_greetings', days: GREETING_DAYS, label: 'daily greetings' },
  { key: 'guestPush', fn: 'cleanup_guest_push', days: GUEST_PUSH_DAYS, label: 'guest push subs' },
  { key: 'adminAudit', fn: 'cleanup_admin_audit', days: ADMIN_AUDIT_DAYS, label: 'admin audit' },
]

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  if (!isCronAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' })

  // SAFETY GUARD — runs BEFORE any RPC, so a bad constant deletes nothing.
  const unsafe = SWEEPS.filter((s) => s.days < MIN_SAFE_DAYS)
  if (unsafe.length > 0) {
    const names = unsafe.map((s) => `${s.fn}=${s.days}`).join(', ')
    console.error('[cron-retention] ABORTED — retention constant below floor:', names)
    await sendNtfy({
      title: 'Bemgu retention cron ABORTED',
      message:
        `A retention constant is below the ${MIN_SAFE_DAYS}-day floor and NOTHING was deleted: ${names}.\n` +
        `These sweeps are irreversible hard deletes. Fix the constant, and check the guest privacy ` +
        `notice section 6 still matches before redeploying.`,
      priority: 'high',
    })
    return res.status(500).json({ error: 'unsafe_retention_constant' })
  }

  // Each sweep is independent: one failing provider/table must not abort the rest, because a
  // skipped sweep means data is retained PAST what the notice promises.
  const swept: Record<string, number> = { guestIdentities: 0, greetings: 0, guestPush: 0, adminAudit: 0 }
  const errors: string[] = []

  for (const s of SWEEPS) {
    try {
      const { data, error } = await supabase.rpc(s.fn, { retention_days: s.days })
      if (error) {
        // Message only, truncated — never a URL, key, guest name or message body.
        console.error(`[cron-retention] ${s.fn} failed —`, error.message?.slice(0, 120))
        errors.push(`${s.fn}: ${error.message?.slice(0, 120) ?? 'unknown'}`)
        continue
      }
      swept[s.key] = typeof data === 'number' ? data : 0
    } catch (e) {
      const msg = (e instanceof Error ? e.message : 'unknown').slice(0, 120)
      console.error(`[cron-retention] ${s.fn} threw —`, msg)
      errors.push(`${s.fn}: ${msg}`)
    }
  }

  const total = Object.values(swept).reduce((a, b) => a + b, 0)

  // Notify on a non-zero sweep OR any error — a quiet day must not generate daily noise, but a
  // silent failure would mean data quietly outliving the promise. sendNtfy never throws.
  if (total > 0 || errors.length > 0) {
    const lines = SWEEPS.map((s) => `${s.label}: ${swept[s.key]} (${s.days}d)`).join('\n')
    await sendNtfy({
      title: errors.length > 0 ? 'Bemgu retention cron — errors' : 'Bemgu retention cron',
      message:
        `Deleted ${total} rows past retention.\n${lines}` +
        (errors.length > 0 ? `\nFAILED: ${errors.join(' | ')}` : ''),
      priority: errors.length > 0 ? 'high' : 'default',
    })
  }

  // 500 only when EVERY sweep failed — a partial run still removed data it was obliged to remove,
  // and reporting that as a failure would hide the sweeps that did work.
  if (errors.length === SWEEPS.length) {
    return res.status(500).json({ ok: false, swept, errors })
  }

  return res.status(200).json({ ok: true, swept, errors })
}
