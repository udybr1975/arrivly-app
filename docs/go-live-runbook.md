# GO-LIVE RUNBOOK — 1 Sep 2026 (COMPLETE)
> Moved VERBATIM out of CLAUDE.md on 1 Sep 2026 at the ~140K restructure threshold (split-on-lifetime: the runbook is a completed reasoning trail). Every OPEN item keeps its one-line statement in CLAUDE.md under "## GO-LIVE — DONE 1 Sep 2026".

## GO-LIVE RUNBOOK (1 Sep 2026 — COMPLETE)

**STATUS:** all partner confirmations received **1 Sep 2026** — Viator name-consent under
General Terms cl. 3.6, and WRITTEN multi-tenant confirmation from **GetYourGuide AND Tiqets**.
**LAUNCH BLOCKER 6 (partner confirmations) IS CLOSED** — it is numbered **5** in the LAUNCH
BLOCKERS list below; the Stripe LIVE flip is **6** there. (This runbook's own "blocker 6/7"
numbering came from the session brief; the list is the authority.) The bulk-import 502 is fixed
and the surface is **RE-FROZEN at `3bbb958`** (STEP 0 shipped at `f94f665`; post-runbook (a) at `3bbb958`). Host A was reset to baseline 1 Sep 2026.
**The only thing remaining before the marketing launch is this runbook.**

**RUNBOOK COMPLETE 1 Sep 2026 — Bemgu is LIVE and taking real payments.** Steps 0-3 all
shipped; see each step.

### STEP 0 — SIGNUP UNDER EMAIL CONFIRMATION (**requires a freeze-lift; do this FIRST**)

**SHIPPED `f94f665`, 1 Sep 2026 — code live, migration applied, surface re-frozen.** With email confirmation ON, `Signup.tsx` takes the
`!signUpData.session` branch and stops **BEFORE** writing `brand_name` and **BEFORE**
`send-welcome`. `AuthCallback` already routes a brand-less host to `/complete-profile`, which
writes name + brand, sends the welcome email and continues to `/choose-plan` — **but only if the
confirmation link lands on `/auth/callback`**, and `signUp` passes **no `emailRedirectTo`**, so
it lands on the Supabase **Site URL** instead and the host is **never asked for a brand**.

**Fix — one file + one migration:**
- **(a) `Signup.tsx`:** the `signUp` options gain
  `emailRedirectTo: \`${ARRIVLY_CONFIG.appUrl}/auth/callback\`` and the metadata gains
  `brand_name`.
- **(b) migration:** `handle_new_user` writes `brand_name` from
  `raw_user_meta_data->>'brand_name'` (coalesced to `''`), so email signups **skip**
  `/complete-profile`.
- **Supabase Auth:** add `https://bemgu.app/auth/callback` to the **Redirect URLs allowlist**.

**Gates:** code-reviewer + security-auditor (this is an auth surface), zero must-fix, then
**RE-FREEZE at the new SHA and record it in the freeze block above.**

**Verify by a real signup:** confirmation email arrives (Resend SMTP) → the link lands on
`/auth/callback` → brand present → welcome email sent → `/choose-plan`.

**Two residuals from the gates, carried into STEP 1:** (i) the "Confirm signup" template **MUST
keep `{{ .ConfirmationURL }}`** — the `{{ .TokenHash }}` form lands the link as a QUERY STRING
with no session and the host times out into `/login`, **which looks exactly like STEP 0
failing**; (ii) an already-registered address under confirmation ON shows "Check your email"
and sends nothing (enumeration protection) — the panel needs a resend / sign-in affordance
before marketing traffic (post-runbook item, not a blocker).

### STEP 1 — EMAIL CONFIRMATION ON

**DONE 1 Sep 2026.** Confirm email = ON (Supabase dashboard, via Claude in Chrome). Template
uses `{{ .ConfirmationURL }}`, neutral wording, sender Bemgu <hello@bemgu.app> via Resend SMTP.
Proven by a real signup (`udy.bar.yosef+golive1@gmail.com`, host `d1de87a8`, `is_test`): created
16:00:30 with `brand_name` from metadata → confirmed 16:01:19 → welcome email stamped 16:01:22 →
`/choose-plan`.

Supabase **Auth → Email provider → Confirm email = ON**. Check the **"Confirm signup"** email
template is **Bemgu-branded** (no "Arrivly", no Supabase default text). **Existing hosts are
unaffected** (auto-confirmed at creation). **Social login is unaffected.**

### STEP 2 — STRIPE LIVE

**DONE 1 Sep 2026.** Live products: Bemgu Starter `price_1UAuLKCJamIa548Jcbxbx3JC` · Growth
`price_1UAuMnCJamIa548JV1DiUfcv` · Portfolio `price_1UAuNQCJamIa548Jp3nFGoAb` (EUR monthly,
descriptions carry the property cap only). Live webhook endpoint **'bemgu-production'** →
`https://bemgu.app/api/stripe-webhook`, 6 events, API version **2026-04-22.dahlia** (the account
default — same as the sandbox endpoint; acacia is not offered on this account). Secret key
**'Bemgu production'**. Five Vercel vars set **PRODUCTION-scope** via `vercel env rm/add`
(secrets Sensitive); redeploy `dpl_5Vzz6KCZ` via `vercel redeploy`, **no empty commit**.
**PROOF:** the test host's `trial_ends_at` was set to the past from chat so Checkout charged
immediately (a trialing sub would have charged €0); `cs_live_` session, **no test badge**, real
**€10 via 3-D Secure**; five webhook deliveries **all 200** (17:01:32-33 → `grace` during the
bank step; 17:02:29 → **active**, `sub_1UAv3tCJamIa548J5PEKfCNg`, period end 1 Oct); refunded +
cancelled immediately → row `expired` 17:11:44; host kept, `is_test`. **Anna's Stays: nothing
opened, edited or deleted.**

**Same Stripe account as Anna's Stays: CREATE NEW, NEVER EDIT OR DELETE ANYTHING EXISTING.**
Anna's live key and her **"elegant-voyage"** webhook are **never touched**.

In **LIVE mode**:
- **(A) Three products**, monthly EUR recurring: **Bemgu Starter €10.00 · Growth €15.00 ·
  Portfolio €25.00** — matches the `plans` table. **No Pro / €49 yet.**
- **(B) Webhook** `https://bemgu.app/api/stripe-webhook` with the **SAME event list** as the
  sandbox endpoint; copy its `whsec_`.
- **(C) New secret key** named **"Bemgu production"** — its own key, so either product can
  rotate independently.

Then in **Vercel, PRODUCTION scope ONLY** (Preview stays on sandbox): `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_TIER_1/2/3`. **The key and the `whsec_` must be from the
SAME mode** — a mismatch passes `constructEvent()` and 500s later. **Redeploy via the Vercel
Redeploy button — never an empty commit.**

**Prove it:** incognito, fresh signup, **real card**, Starter €10 → **NO test badge on
Checkout** → webhook delivery **200** → `hosts` row **active** with a real subscription id.
Then **refund + cancel**, and mark that host `is_test` (**kept, never deleted**).

**Pre-check:** the sandbox **"inspiring-inspiration"** endpoint (Anna's staging) delivery log
shows Bemgu test events as harmless — live mirrors it. Bemgu ignores Anna's events via the
`metadata.app === 'arrivly'` filter.

### STEP 3 — RECORD GO-LIVE

**DONE — this commit.**

Docs-only commit: record go-live in CLAUDE.md and mark the **Stripe LIVE flip** blocker
**CLOSED** (it is **#6** in the LAUNCH BLOCKERS list below — the brief called it 7).

### POST-RUNBOOK QUEUE (opened 1 Sep 2026, in priority order — all frozen-surface, each needs a conscious lift)

**a. 3-D SECURE FIRST-PAYMENT MESSAGING — CLOSED 1 Sep 2026, `3bbb958`.**
**PROVEN LIVE** with a second real €10 3-D Secure payment on host `d1de87a8` (`is_test` flipped
off for the proof, back on after): operator ntfy "Payment pending (3DS)" at DEFAULT priority →
**no host "payment failed" email** → host email "Payment received — you're all set" → Billing
page GREEN "Payment received" banner → a SINGLE audit row `recovered` (**no `grace` row**).
The run also proved the **re-subscriber case (W2)**: the second subscription id differed from
the one already on file, which is exactly what `!hadSubscription` would have missed. Refunded +
cancelled → `expired`.
**TWO PRE-EXISTING TRANSITIONS CHANGED, both intended, recorded because neither is about 3DS:**
(i) `grace → active` WITH a tier change was `upgraded`/`downgraded`, now `recovered`; (ii)
`grace → active` at the SAME tier was SILENT, now `recovered` — **which means every genuine
past-due card-retry recovery now notifies the host**, where before it said nothing at all.
**The defect it existed to fix, kept as the reason:** `mapStatus` in
`api/stripe-webhook.ts` maps `incomplete` → `grace` alongside `past_due`/`unpaid`, so a
**brand-new** subscription waiting on the bank's 3-D Secure step sends the host a "payment
failed" email + high-priority ntfy; and the notice logic has **no case for grace → active**, so
when the bank step passes the host hears nothing. **Measured live 1 Sep: a 56-second window.
Most EU cards hit this.** Fix: treat `incomplete` on a FIRST payment as pending (no host email),
and add a 'recovered' notice for grace → active. Webhook file only, both gates.

**b. AUTH POLISH BATCH (pre-marketing).** Show-password toggle on Login, Signup and
ResetPassword (**all three, one commit**); plus the "Check your email" dead end when the address
is already registered (Supabase enumeration protection returns no session AND no error — needs a
"Didn't get it? Sign in instead" line).

**c. STRIPE CHECKOUT BRANDING — A DECISION, NOT CODE.** Checkout shows the Anna's Stays logo and
merchant **"U & A investment and consultancy"**; the card statement reads **"ANNAS STAYS,
HELSINKI"**. These are ACCOUNT-LEVEL settings on the shared account. Options: neutral account
branding for both products, or accept it and say so on `/choose-plan`.

**d. Preview has NO Stripe env vars** — the shared sandbox rows were removed when Production was
re-scoped, and Preview never had `STRIPE_SECRET_KEY` anyway. Restore from the sandbox dashboard
only if preview checkout is ever needed.

**e. Leaked-password protection toggle** (Supabase Auth) — **still off.**

**f. DECLINED FIRST CHARGE IS NOW SILENT TOO (pre-marketing, small).** Stripe's `incomplete`
covers BOTH `requires_action` (3-D Secure, the case (a) fixed) AND `requires_payment_method`
(a genuinely declined first charge). (a) suppresses both identically, so a host whose card was
DECLINED gets no email until the eventual cancellation. **Mitigated in-app** by (a)'s own W3
rewording — the Billing banner reads "Payment pending — complete or update your card", which is
true for both. **Fix:** narrow the exclusion to
`latest_invoice.payment_intent.status === 'requires_action'`; `latest_invoice` is ALREADY
expanded at the `subscriptions.retrieve` call, so this costs no extra API request.

**g. THE OPERATOR "Payment pending (3DS)" NTFY FIRED TWICE on the live proof (low).** Two Stripe
events landed in the same second and both read the PRE-WRITE status, so both entered the branch.
It sits outside the `last_billing_notice_sig` one-shot claim — deliberately, since an operator
ping is not something to one-shot. **Operator-only duplicate; no host impact.**

**h. ART. 30 NTFY ENUMERATION — legal workstream, not code.** `api/stripe-webhook.ts` is now a
source of **host-UUID-bearing** messages on the ALARM topic. This is NOT a new exposure class —
the spend brakes already do it — but this endpoint MUST be in the enumeration when the "ntfy
carries no personal data" row is narrowed, or that narrowing repeats the
three-of-four-table-rows signature. (Security-auditor INFO-1, 1 Sep 2026.)

