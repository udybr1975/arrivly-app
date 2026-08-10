# Spend-abuse hardening — mechanism detail

Moved out of CLAUDE.md, which keeps the live rules and points here.

FOUNDATION: `api_call_counters` table + `bump_api_counter(p_host_id, p_endpoint)` RPC
(SECURITY DEFINER, service-role only, RLS on, all grants revoked from public/anon/authenticated).
Cross-instance atomic per-host/endpoint/UTC-hour counter — the real cap (per-instance Map
limiters are porous on Vercel and do NOT count). Alarms via `_lib/ntfy.ts` sendNtfy (private
topic, ASCII-only, env-var NAME + public project ID only, never a key value).

BRAKES (per host per UTC hour):
- create-booking 30/h, FAIL-OPEN, blocked mints nothing. Caller-keyed (userId). Amplifier
  (mints passes; spends no Gemini itself). (f0a1cb8)
- sync-ical 5 syncs/h + MAX_ICAL_EVENTS=100/sync + MAX_ICAL_URLS=20, FAIL-OPEN, over-cap mints
  NOTHING; dropped/failed/over-cap feeds all treated as "incomplete" so soft-cancel never
  wrongly cancels live bookings. Caller-keyed. Dominant amplifier. (6b33d40)
- generate-guide: real gate is the atomic 1-per-6h claim (guide_claimed_at); counter is
  alarm-only at 10/h. Caller-keyed. Key GEMINI_API_KEY_GUIDES. (5423285)
- daily-greeting 50/h, FAIL-CLOSED, degrades to {suggestion:null}. VICTIM-keyed (apt.host_id).
  Shared GEMINI_API_KEY. (f8952b0)
- guest-chat 40/h, FAIL-CLOSED, 429 -> soft ChatBot copy. VICTIM-keyed. Dearest (grounded)
  call. Key GEMINI_API_KEY_CHAT. (6f915b5)
- city-events public 'city-events-public' 7/h, FAIL-CLOSED. VICTIM-keyed (unauthenticated;
  caller needs only the apartment UUID). Key GEMINI_API_KEY_EVENTS. (66cb385 -> split bcf9396)
- refresh-events host 'city-events-host' 3/h, FAIL-CLOSED. Caller-keyed (ownership check
  precedes bump). Key GEMINI_API_KEY_EVENTS. (66cb385 -> split bcf9396)

DETECTION (cron-spend-audit, `0 */3 * * *`):
- Rolling: sums each host's last-6h usage per endpoint, alarms ~3x the hourly limit
  (guest-chat 120, daily-greeting 150, create-booking 90, sync-ical 15, generate-guide 30,
  city-events-public 21, city-events-host 9). (3b1a128)
- Cross-host (Sybil): sums ALL hosts per endpoint, alarms at GLOBAL_HOST_EQUIVALENT(5) x the
  per-host rolling threshold; logs top contributors. Turns the "N accounts" leak from
  unbounded-in-N into a fixed constant. GLOBAL_HOST_EQUIVALENT is a SUM (not "5 hosts") ->
  false-positives around ~50-150 active hosts; raise from the per-run fleet-totals log. (196f073)
- Retention: prunes counter rows >48h every run (also GDPR minimisation). Prune's `.lt()`
  filter is load-bearing (without it -> full table wipe that resets every current-hour counter).
  Paginated scan (unbounded PostgREST select truncates silently -> would under-count). (3b1a128)

CLIENT FIX: GuestPage daily-greeting fired twice/load (weather-keyed effect) -> fire-once ref
+ 2.5s weather grace (6382174). Lowers real usage, not the ceiling.

DELIVERABLE (outside repo): plain-English risk & response guide for Udy —
Bemgu-AI-spend-risk-and-response-guide.md/.docx (incident cheat-sheet + full measures record).

PRE-BILLING CHECKLIST — **SUPERSEDED Aug 5 2026 by the ZERO-GOOGLE AI PILOT plan above — kept
for history.** (There is no billing flip; surfaces graduate individually instead.)
1. Set a per-project spend cap on Google Cloud for each of the 4 projects above at ~2x the
   in-app limits — the only non-code net for the bounded multi-account residual.
2. Optional polish (none blocking): meter cheap non-grounded host endpoints (host-picks,
   bulk-import, rewrite-rules); add an api/ typecheck to the build; the 3 city-events alert
   refinements (over-asserted innocence, revoke-token vs rotate-QR, log the tripping IP); a
   cron "never ran" heartbeat; raise city-events-host reserve (3/h) before multi-property
   hosts; welcome-chat/guide-assistant abort tidy-ups.
3. Flip GEMINI_API_KEY_CHAT to a billed key once the Google payment issue is resolved.

RESIDUAL (accepted, not holes): bounded (not zero) spend possible for a determined
multi-account attacker -> covered by the Google cap. One remaining blind spot: a single host
at ~49% on all endpoints at once (cross-endpoint, lower value).

COMMIT TRAIL: DB counter migration -> 5423285 -> f0a1cb8 -> 6b33d40 -> f8952b0 -> 6f915b5 ->
66cb385 -> bcf9396 -> 6382174 -> 6259e9e -> 3b1a128 -> 196f073 -> fa8fa32.
