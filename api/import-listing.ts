import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { scrubErr } from './_lib/scrub.js'
import { aiGenerate, resolveProvider } from './_lib/ai-provider.js'
import { sendNtfy } from './_lib/ntfy.js'
import { SYSTEM_PROMPT, validateImport } from './_lib/import-listing.js'
import { OUTPUT_TOKEN_BUDGET, truncateForImport } from '../src/lib/listingText.js'

// LISTING IMPORTER — "Have it all in one file?"
//
// PROPOSE-ONLY. This endpoint NEVER writes to the database. It reads a host's own guest guide
// (extracted in their browser — the file itself is never uploaded anywhere) and returns a
// proposal the host reviews field by field before anything is applied. Every write happens
// later, from the client, through PropertySetup's existing save functions.
//
// WHY IT IS NOT AN EXTENSION OF api/bulk-import.ts: that endpoint's contract is delete+insert
// with no review, and live code depends on it. Sharing a handler would put a propose-only path
// and a destructive path behind one route. bulk-import is deliberately untouched.
//
// The frame below — method guard, Bearer auth via the anon client, ownership check via the
// admin client, scrubErr on every logged error — is bulk-import's, copied deliberately so both
// routes fail the same way.

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const authHeader = req.headers.authorization
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!)
  const { data: authData, error: authError } = await sb.auth.getUser(token)
  if (authError || !authData.user) return res.status(401).json({ error: 'Unauthorized' })

  if (!req.body) return res.status(400).json({ error: 'content is required' })

  const { apartmentId, content } = req.body as { apartmentId?: string; content?: string }
  if (!apartmentId || typeof apartmentId !== 'string') {
    return res.status(400).json({ error: 'apartmentId is required' })
  }
  if (!content || typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ error: 'content is required' })
  }

  // TRUNCATE, do not 400. bulk-import's 8,000-char cap rejects outright, which is right for a
  // paste-a-paragraph flow and wrong here: a real Booking.com export measured 9,190 chars, and a
  // host who uploads their whole manual should get the first MAX_IMPORT_CHARS sorted plus a
  // warning rather than a dead end. The client truncates too; this is the untrusted-input
  // re-check, not a duplicate feature.
  const { text: capped, truncated } = truncateForImport(content.trim())

  const admin = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const { data: apt } = await admin
    .from('apartments')
    .select('id')
    .eq('id', apartmentId)
    .eq('host_id', authData.user.id)
    .maybeSingle()
  if (!apt) return res.status(403).json({ error: 'forbidden' })

  // SPEND BRAKE. A brake is UNFINISHED until its key is in cron-spend-audit's ROLLING_LIMITS —
  // unlisted endpoints are ignored by BOTH detectors, so the 429 would fire while nothing
  // alarmed. 'import-listing' is registered there at 3x this cap.
  //
  // CALLER-KEYED: the bump follows a PROVEN ownership check on apartments.host_id above, so the
  // named host really is the spender and "block this host" is correct remediation — unlike the
  // victim-keyed guest surfaces.
  //
  // WHY THIS ENDPOINT NEEDS ONE AT ALL: it carries the largest per-call reservation of any
  // host-authenticated surface, and the client offers a manual "Try again" with no ceiling of
  // its own. The Groq minute is ORG-WIDE, so an unbraked loop here starves guest-chat, the
  // greeting, events and the guide for every other tenant.
  //
  // 10/hour is generous for what is a one-off onboarding action: a host importing one manual
  // spends one call, and a host genuinely iterating on a document does not need eleven.
  const IMPORT_HOURLY_LIMIT = 10
  const { data: hourCount, error: counterErr } = await admin.rpc('bump_api_counter', {
    p_host_id: authData.user.id,
    p_endpoint: 'import-listing',
  })
  if (counterErr) {
    // FAIL CLOSED. The blocked behaviour here is the free fallback — the host types the fields
    // into the tabs by hand, which is what they would have done without this feature at all.
    // Fail-open is indefensible when the fallback costs nothing: it would spend uncapped Groq
    // during exactly the burst that broke the counter.
    console.warn('[import-listing] counter bump failed (fail-closed)', scrubErr(counterErr, 120))
    return res.status(503).json({ error: 'busy' })
  }
  if (typeof hourCount !== 'number') {
    console.warn('[import-listing] counter returned a non-number (fail-closed)')
    return res.status(503).json({ error: 'busy' })
  }
  if (hourCount > IMPORT_HOURLY_LIMIT) {
    // Alert INSIDE the over-cap branch and on STRICT EQUALITY, so it is one-shot: a host held at
    // the cap must not be able to fire an alert per request. (Written the other way round it was
    // unreachable — the 429 returns first.)
    if (hourCount === IMPORT_HOURLY_LIMIT + 1) {
      // AWAITED, not fire-and-forget: an un-awaited fetch in a serverless function can be killed
      // when the response returns, which is exactly when this one is sent.
      await sendNtfy({
        title: 'Bemgu — import-listing hourly cap hit',
        message:
          `Host ${authData.user.id} exceeded ${IMPORT_HOURLY_LIMIT}/h on /api/import-listing.\n` +
          `CALLER-KEYED: this host is the spender (ownership proven before the bump), so ` +
          `blocking them is correct remediation.\n` +
          `REVOKE + ROTATE if abuse is confirmed: GROQ_API_KEY (console.groq.com).`,
        priority: 'high',
      }).catch(() => {})
    }
    return res.status(429).json({ error: 'rate_limited' })
  }

  // NO GEMINI BRANCH. This surface is Groq/OpenRouter-only from birth — @google/genai is leaving
  // the stack, so a new endpoint must not add an import of it. A mis-set AI_PROVIDER_IMPORT_LISTING
  // fails loudly here instead of silently routing to a provider this file cannot serve.
  if (resolveProvider('import_listing') === 'gemini') {
    console.error('[import-listing] provider resolved to gemini — this surface has no gemini path')
    return res.status(500).json({ error: 'AI not configured' })
  }

  try {
    // BUDGET ARITHMETIC — the reservation must fit under the verified 8,000 TPM ceiling, because
    // Groq debits promptTokens + max_tokens RESERVED (never the completion actually generated),
    // and a reservation above the ceiling is a PERMANENT failure that NO retry clears:
    //   system    SYSTEM_PROMPT, measured with estimateTokens = 1,077
    //   content   CONTENT_TOKEN_BUDGET (see listingText.ts)   = 3,300
    //   output    maxTokens below                             = 2,800
    //   reservation                                           = 7,177 < 8,000  ✓  (~823 spare)
    //   THE MARGIN IS NOW THIN — 823 against the test's own >= 800 floor. The relocate/
    //   cross-reference/anti-compression rules cost ~236 tokens and were already tightened
    //   once to clear it. The NEXT prompt growth trips the test, which is the test working.
    // The content half is capped in TOKENS, not characters, because SYSTEM_PROMPT tells the model
    // to preserve the document's language and nothing restricts the script a host may upload —
    // 12,000 chars is ~4,000 tokens of Latin but ~7,600 of Greek, and the character-only cap this
    // replaced would have made every dense-script import fail permanently. See listingText.ts.
    // The 2,800 output ceiling covers a JSON RESTATEMENT of a SUBSET of the input — extraction,
    // not generation — plus ~700 reasoning tokens at 'low', which gpt-oss bills INSIDE
    // completion_tokens, i.e. out of this same allowance.
    // retries: 0 — the CLIENT owns the retry decision (one manual button), the same one-shot
    // philosophy as bulk-import. Automatic retries would silently multiply the reservation.
    const raw = await aiGenerate('import_listing', {
      system: SYSTEM_PROMPT,
      prompt: capped,
      json: true,
      // Shared constant, not a hand-copied literal: the reservation arithmetic has one home
      // (listingText.ts) and one test asserting it stays under the ceiling.
      maxTokens: OUTPUT_TOKEN_BUDGET,
      retries: 0,
      timeoutMs: 25_000,
      reasoningEffort: 'low',
      // THIS SURFACE'S model output is a restatement of a house manual, so a Groq
      // `json_validate_failed` 400 echoes credentials in `error.failed_generation`. Opt out of
      // the provider's body echo — see redactErrorBody in ai-provider.ts.
      redactErrorBody: true,
    })

    let parsed: unknown
    try {
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
      parsed = JSON.parse(cleaned)
    } catch {
      // NEVER log `raw` here, not even truncated: on THIS surface the model's output is a
      // restatement of a house manual, so the first characters routinely contain the WiFi
      // password or the door code. Length and shape are enough to diagnose a truncation or a
      // stray code fence; content would put credentials in the Vercel logs.
      console.error(
        '[import-listing] JSON parse failed — length:', raw.length,
        'startsWithFence:', raw.trimStart().startsWith('```'),
      )
      return res.status(502).json({ error: 'parse_failed' })
    }

    // Everything past this point treats `parsed` as untrusted: validateImport whitelists every
    // key, types and trims every value, caps every length, and drops anything it cannot make
    // safe. See api/_lib/import-listing.ts.
    const { proposal, skipped, conflicts, redacted } = validateImport(parsed)

    // An empty proposal is a valid 200 — "nothing found" is an outcome the client renders as an
    // empty state, not an error it should surface as a failure.
    return res.status(200).json({ proposal, truncated, skipped, conflicts, redacted })
  } catch (e) {
    const msg = scrubErr(e, 120)
    console.error('[import-listing] generate failed —', msg)
    return res.status(502).json({ error: 'import_failed' })
  }
}
