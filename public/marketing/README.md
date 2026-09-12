# Marketing assets

Static assets served at `https://bemgu.app/marketing/<filename>`. Drop a file in this folder,
commit, push — the filename becomes the URL, permanently.

**Additive only: never overwrite, never rename, never delete.** Files with the asset extensions listed in `vercel.json` (png, jpg, jpeg, webp, svg, gif, avif, mp4, pdf — lowercase) are sent
`Cache-Control: public, max-age=31536000, immutable` (see `vercel.json`), so a browser may serve
the old bytes for a year with no way to force a refresh. A new version needs a **new filename**
(`…-v2.png`).

**A missing `/marketing/<file>` path returns a real 404.** `vercel.json` excludes `/marketing/` from the
SPA catch-all rewrite (`/((?!marketing/).*)`), so a typo'd or deleted asset URL fails visibly
instead of quietly serving the app shell — which, under the immutable header above, a browser
would then pin at that URL for a year.

**So publish the URL only AFTER the deploy is live.** MEASURED in production: a missing
`/marketing/` path returns `404` *carrying the same* `max-age=31536000, immutable` header — the
header rule matches on the path, not on whether the file exists. Fetch a URL before its asset
deploys and that browser has a **404 cached for a year**, and adding the file later will not
dislodge it. Push, wait for the Vercel deployment to go READY, confirm the URL returns `200`, and
only then put it in a post. Same reason a typo cannot be fixed by adding the file under the
typo'd name — use a new filename.

**No guest data, ever.** Screenshots must come from the public demo apartment only — never a real
host's page. No real guest name, no booking reference, no `?token=` or `?key=` in any URL. This
repo is public and git objects never expire, so a mistake here cannot be undone by deleting the
file.

**Never build a QR here from the dashboard export.** The host QR panel mints a URL containing
`?key=<apartment_qr_secrets.qr_secret>`, and a leaked key is revocable only by rotating the
secret — which invalidates every QR already printed for that apartment. Build demo QRs by hand
from `ARRIVLY_CONFIG.publicDemo` (`apt` + the public `ARR-EVT777` token).

**Claim rules are stricter here than in the app.** A wrong claim in `Landing.tsx` is a one-line
fix; the same claim in this folder is permanent in git and pinned in browsers. In particular:
**Viator must never appear in a host-earnings statement** — hosts earn only on GetYourGuide and
Tiqets, Viator is Bemgu-attributed at every tier — and any earnings claim must carry its tier and
provider scope *inside the sentence*, not in nearby text.

Keep files under ~1.5 MB where you can; social fetchers time out on heavy images.
