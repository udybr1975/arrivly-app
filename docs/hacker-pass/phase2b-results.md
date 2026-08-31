# Bemgu Hacker-Agent Pass — Phase 2b Results (Batch C, APPROVED WRITES)

Probed against production `https://bemgu.app` + Supabase REST on 31 Aug 2026. Freeze
re-confirmed before probing (`git diff 47bb840 origin/master` excl. docs/CLAUDE.md = empty).
No application code edited, no commits. All writes were to TEST assets only and every toggle
was restored. No password / JWT / env value was printed.

**Host A (acted AS):** `udy.bar.yosef+pentest@gmail.com`, host_id `5d6d6fcd…685e`, apartment
`02532a18…d791` ("Jony London home", is_test). Signed in via Supabase password grant; access
token captured to a shell var and deleted after. User-id echo confirmed `5d6d6fcd…685e`.
**Cross-tenant target ("Host B"):** Sweet home test fixture `d9614d11…c2bd` (different test
host). No real host or real apartment was touched.

---

## Group 1 — cross-tenant isolation (Host A's JWT → Host B's apartment / admin)

**Every attempt was refused. No cross-tenant read or write occurred.**

| Target | Probe | Result | Verdict |
|---|---|---|---|
| **T-12** qr-secrets | POST as Host A, body `{}` | Returned ONLY Host A's own apt secret (`02532a18…`); Sweet home absent. Server derives the apt list from `host_id`, ignores any client list. | **CONFIRMED-SAFE** |
| **T-15** admin-overview | GET, Host A JWT | **403 forbidden** | **CONFIRMED-SAFE** |
| **T-15** admin-audit | GET, Host A JWT | **403 forbidden** | **CONFIRMED-SAFE** |
| **T-15** admin-plans | POST, Host A JWT | **403 forbidden** | **CONFIRMED-SAFE** |
| **T-15** admin-update-host | POST, Host A JWT | **403 forbidden** | **CONFIRMED-SAFE** |
| **T-15** admin-impersonate | GET `?host_id=<Sweet home's host>`, Host A JWT | **403 forbidden** | **CONFIRMED-SAFE** |
| **T-17** generate-guide | POST `{apartment_id: Sweet}` | **403 Forbidden** (before any AI spend) | **CONFIRMED-SAFE** |
| **T-17** generate-host-picks | POST `{apartmentId: Sweet, text}` | **403 Forbidden** | **CONFIRMED-SAFE** |
| **T-17** refresh-events | POST `{apartment_id: Sweet}` | **403 Forbidden** (before AI) | **CONFIRMED-SAFE** |
| **T-17** sync-ical | POST `{apartment_id: Sweet}` | **403 Forbidden** (before any fetch) | **CONFIRMED-SAFE** |
| **T-17** city-image | POST `{apartmentId: Sweet}` | **404 Apartment not found** — the lookup uses a USER-SCOPED (RLS) client, so Sweet home is invisible to Host A. Correct refusal. | **CONFIRMED-SAFE** |
| **T-17** create-booking | POST valid `{apartment_id: Sweet, first_name, check_in, check_out}` | **403 Forbidden** (ownership check before insert; no booking created) | **CONFIRMED-SAFE** |
| **T-17** host-message | POST `{bookingId: random}` | **404 not_found** (no message sent) | **CONFIRMED-SAFE** |
| **T-17** cancel-booking | POST `{booking_id: random}` | **403 Forbidden** (no-oracle join; nothing cancelled) | **CONFIRMED-SAFE** |
| **T-18** create-upload-url | POST `{kind:hero, apartmentId: Sweet, ext:jpg}` | **404 Apartment not found** (no signed URL minted for Sweet home) | **CONFIRMED-SAFE** |
| **T-18 control** | Same, but Host A's OWN apt | **200** — signed URL minted at path `5d6d6fcd…/02532a18…/hero-….jpg` (scoped to Host A's uid). Proves the gate is real, not a blanket deny. URL never used (no upload); expires. | control |
| **RLS direct** | GET `/rest/v1/apartments?id=eq.<Sweet>` with Host A JWT | **`[]`** — Host A literally cannot read Sweet home under RLS. DB-layer isolation proof. | **CONFIRMED-SAFE** |

Note on discovery: Host A cannot obtain Sweet home's booking UUID through any endpoint (RLS
blocks it), so the booking-keyed probes used a random UUID — which is itself part of the
isolation (there is no path for one tenant to enumerate another's booking ids).

---

## Group 2 — Host A's own apartment (no cross-tenant)

| Target | Probe | Result | Verdict |
|---|---|---|---|
| **T-02b** coordinate gate (proper) | As Host A, PATCH own apt `welcome_show_address=false`, re-run ANON guest-bootstrap | With the toggle OFF, the **apartment object dropped `lat`/`lng`** for a no-token AND a random-token caller. (The lat/lng seen in Phase 2 were guide-POI coordinates — public nearby-place data — not the apartment's location.) Toggle **restored to true**; apartment lat/lng confirmed back. | **CONFIRMED-SAFE** |
| **T-22** import credential leak | As Host A, bulk-import prose containing a fake WiFi password + door code "4417" + lockbox "9021" | **`parse_failed` (502) on both attempts** — the bulk-import model path returned non-JSON, so it returned BEFORE the scrub/insert step. Host A's `apartment_details` stayed `[]` (nothing written). The live scrub+insert path could not be exercised. | **INCONCLUSIVE (LIVE)** — see operational note below |

**Operational note (not a security finding, outside the frozen-surface security scope):**
`/api/bulk-import` returned `{"error":"parse_failed"}` twice on well-formed house-manual prose.
The structuring model (Groq default per `_lib/ai-provider.ts`, or its Gemini branch) is
emitting output the parser rejects, so bulk-import appears **non-functional in production right
now**. This blocks T-22 and T-27 live. Worth a separate look — it degrades a host feature — but
it is a feature-availability issue, not a security hole (the parse-fail path inserts nothing
and logs no content, both verified in Phase 1 as T-25/T-23).

T-22 residual (from code, unchanged): every imported row is written `is_private:false`, so
`scrubCredentialSentences` (bulk-import.ts:135, runs in buildRows before insert) is the ONLY
thing standing between an echoed credential and the public guest page. It is wired and real;
it simply could not be exercised end-to-end while the model path is failing. Re-run T-22 once
bulk-import parses again.

---

## Group 3 — SSRF confirmation (T-20)

| Target | Probe | Result | Verdict |
|---|---|---|---|
| **T-20** SSRF via iCal URL | As Host A, set own apt `ical_urls` to `https://169.254.169.254/latest/meta-data/`, `https://127.0.0.1/`, `http://169.254.169.254/…`, then POST sync-ical | **`{"imported":0,"skipped":0,"errors":["ical: couldn't be used (check it's a public https calendar link)", …]}` (200).** No metadata/localhost content returned. `safe-fetch.ts`'s address blocklist + https-scheme guard held. `ical_urls` **restored to null** (original value). | **CONFIRMED-SAFE** |

This closes the stale CLAUDE.md note ("mild SSRF, no private-IP/metadata blocklist") — the
blocklist is present and effective live.

---

## Group 4 — browser smoke (T-27) — PENDING-MANUAL

Not run: requires an authenticated dashboard browser session, and bulk-import's model path is
currently returning `parse_failed` (Group 2), so the "clean write" and "partial-scrub" branches
cannot complete regardless. Deferred as **PENDING-MANUAL**. Four click-paths for Udy to run
once bulk-import parses again, as Host A on `/dashboard/property/02532a18…` (bulk-import panel):

1. **Clean write** — paste a normal manual with no credential sentences → import succeeds →
   confirm the paste box CLEARS.
2. **Partial-scrub** — paste a manual with one credential sentence (e.g. "The door code is
   4417") among clean text → import succeeds, `redacted` > 0 → confirm the box CLEARS and the
   credential sentence did NOT land in a saved detail row.
3. **Nothing-saved / no-scrub** — paste text the model returns zero usable rows for → confirm
   the box is KEPT (not cleared) so the host can retry.
4. **Rate-limited** — trigger the 10/hour cap (11th import in an hour) → 429 → confirm the box
   is KEPT and the soft retry copy shows.
   (PG-23/24/27, shipped `5958fae`, logic-verified only — this is the never-run browser check.)

---

## Not run (per instruction)

- **T-06** welcome-claim NAME_RE / no-overwrite — deferred; no in-scope unnamed fixture booking
  was nominated (Sweet home is the demo with invented data; the ARR-*501/401/901 pre-arrival
  fixtures live on "charming 1908 studio", not a scope target). Nominate a test booking
  (welcome code + confirmation ref) on a test apartment to run this.
- **T-16** demo self-grant — closed by code read; not run live (would flip Host A's own row to a
  48h demo for no additional proof).

---

## Cleanup / state left behind

**Host A's apartment is back to its pre-pass baseline — verified at the end:**
`welcome_show_address=true`, `ical_urls=null`, `apartment_details=[]`, `bookings=[]`.

- No cross-tenant read or write succeeded anywhere.
- No booking, guest, message, or detail row was created.
- bulk-import wrote nothing (parse-failed before insert).
- One signed upload URL was minted for Host A's OWN apt (T-18 control) and never used — it
  expires on its own; nothing was uploaded to storage.
- `api_call_counters` rolling rows were incremented for Host A on the endpoints probed
  (bulk-import ×2, create-booking, sync-ical, etc.). These auto-expire on the rolling window —
  no cleanup needed.
- Temp token files (`/tmp/jwt.txt`, `/tmp/auth.json`) deleted. `/tmp/anon.txt` holds only the
  PUBLIC publishable key.

---

## One-line summary

- T-12 SAFE · T-15 SAFE (×5) · T-17 SAFE (×8, all cross-tenant refused before side effect) ·
  T-18 SAFE (cross-tenant 404; own-apt control 200) · RLS-direct SAFE (`[]`) ·
  **T-02b SAFE** (coord gate proper — lat/lng vanish with toggle off) ·
  **T-22 INCONCLUSIVE** (bulk-import `parse_failed` live — nothing written; re-run when fixed) ·
  **T-20 SAFE** (SSRF blocked, no metadata leaked) · **T-27 PENDING-MANUAL** · T-06/T-16 not run.
- **Zero cross-tenant breaches. Zero writes left behind. One operational bug surfaced:
  bulk-import returns parse_failed in production.**
