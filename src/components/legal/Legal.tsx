/**
 * The published legal surface: /legal and the four document pages under it.
 *
 * THE MARKDOWN FILES UNDER docs/ ARE THE SINGLE SOURCE OF TRUTH. They are imported
 * verbatim with Vite's `?raw` and rendered — no copy of any legal sentence is ever
 * pasted into a component, so the published page and the reviewed document cannot
 * drift. Editing a document is therefore the whole job; nothing here needs touching.
 *
 * NOT PUBLISHED, AND MUST NEVER BE IMPORTED HERE: docs/legal-data-inventory-*.md and
 * docs/legal-workstream.md are internal working records (they carry decision history,
 * open counsel questions and operational detail) and are deliberately absent from this
 * file. Adding either one publishes it.
 *
 * The DPA page renders its annexes because it renders the whole document — that is what
 * makes the DPA's own claim, "the current sub-processor list is published at
 * bemgu.app/legal", true.
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Markdown } from '../../lib/markdown'
import { supabase } from '../../lib/supabase'
import Logo from '../shared/Logo'

import tosSource from '../../../docs/legal-tos.md?raw'
import hostPrivacySource from '../../../docs/legal-host-privacy-policy.md?raw'
import guestNoticeSource from '../../../docs/legal-guest-privacy-notice.md?raw'
import dpaSource from '../../../docs/legal-dpa.md?raw'

type DocKey = 'terms' | 'privacy' | 'guest-notice' | 'dpa'

type DocEntry = {
  slug: DocKey
  title: string
  blurb: string
  source: string
}

export const LEGAL_DOCS: DocEntry[] = [
  {
    slug: 'terms',
    title: 'Terms of Service',
    blurb: 'The agreement between you and Bemgu when you use the service.',
    source: tosSource,
  },
  {
    slug: 'privacy',
    title: 'Privacy Policy for Hosts',
    blurb: 'What we hold about you as a host, why, and for how long.',
    source: hostPrivacySource,
  },
  {
    slug: 'guest-notice',
    title: 'Privacy Notice for Guests',
    blurb: 'For guests staying at a property that uses Bemgu.',
    source: guestNoticeSource,
  },
  {
    slug: 'dpa',
    title: 'Data Processing Agreement',
    blurb: 'How we handle your guests’ data on your behalf, including the sub-processor list.',
    source: dpaSource,
  },
]

/** Shared page chrome: no dashboard sidebar, no guest tab bar — a plain readable page. */
function LegalShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#faf8f4] font-['Inter']">
      <header className="border-b border-[#e4ddd0] bg-[#fffdf9]">
        <div className="mx-auto flex max-w-[760px] items-center justify-between px-6 py-4">
          <Link to="/" className="no-underline" aria-label="Bemgu home">
            <Logo />
          </Link>
          <Link
            to="/legal"
            className="rounded text-[13px] text-[#6b6354] underline underline-offset-2 hover:text-[#1c1c1a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7a5c00]"
          >
            All legal documents
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-[760px] px-6 py-10 pb-24">{children}</main>
    </div>
  )
}

export function LegalIndex() {
  useEffect(() => {
    const previous = document.title
    document.title = 'Legal — Bemgu'
    return () => { document.title = previous }
  }, [])

  return (
    <LegalShell>
      <h1 className="font-['Fraunces'] font-light text-[30px] leading-tight tracking-tight text-[#1c1c1a] mb-2">
        Legal
      </h1>
      <p className="mb-8 text-[15px] leading-[1.75] text-[#5b5853]">
        The documents below are the versions currently in force. Each one states its own
        effective date.
      </p>
      <ul className="m-0 list-none space-y-3 p-0">
        {LEGAL_DOCS.map(doc => (
          <li key={doc.slug}>
            <Link
              to={`/legal/${doc.slug}`}
              className="block rounded-2xl border border-[#e4ddd0] bg-[#fffdf9] px-5 py-4 no-underline transition-colors hover:border-[#c8a24e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7a5c00]"
            >
              <span className="block text-[15px] font-semibold text-[#1c1c1a]">{doc.title}</span>
              <span className="mt-1 block text-[13.5px] leading-relaxed text-[#5b5853]">{doc.blurb}</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-10 text-[13px] leading-relaxed text-[#6b6354]">
        Questions about any of these? Email{' '}
        <a
          href="mailto:hello@bemgu.app"
          className="text-[#7a5c00] underline underline-offset-2 hover:text-[#1c1c1a]"
        >
          hello@bemgu.app
        </a>
        .
      </p>
    </LegalShell>
  )
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Resolve the host's brand name for the guest notice from an APARTMENT ID, server-side.
 *
 * THE NAME IS ASSERTED BY US, NEVER BY THE URL, AND THAT IS THE WHOLE POINT. An earlier
 * version took the name itself as `?host=`, which let anyone put 80 characters of their
 * own copy — "Bemgu Support — call +358…" — inside a first-party callout on the one page
 * whose entire purpose is to be authoritative. Content-spoofing on a bemgu.app URL, on a
 * legal page, is not a risk worth a sanitiser; taking a public apartment UUID and reading
 * the name from `guest_host_card` removes the attacker's input from the sentence
 * entirely. It also keeps the host's brand name out of Vercel's edge access log.
 *
 * `guest_host_card` is the same anon-callable SECURITY DEFINER RPC the guest page uses.
 * Best-effort: on any failure the line is simply omitted rather than guessed at.
 */
function useHostBrandName(aptParam: string | null): string | null {
  const [name, setName] = useState<string | null>(null)
  useEffect(() => {
    if (!aptParam || !UUID_RE.test(aptParam)) { setName(null); return }
    let cancelled = false
    supabase
      .rpc('guest_host_card', { p_apartment_id: aptParam })
      .then(({ data }) => {
        if (cancelled) return
        const row = (data as Array<{ brand_name?: unknown }> | null)?.[0]
        const brand = typeof row?.brand_name === 'string' ? row.brand_name.trim() : ''
        setName(brand ? brand.slice(0, 80) : null)
      }, () => { if (!cancelled) setName(null) })
    return () => { cancelled = true }
  }, [aptParam])
  return name
}

/**
 * Split a document into its H1 line and the remainder, so a caller can insert content
 * DIRECTLY UNDER THE TITLE. Falls back to "no title, all body" if line 1 is not an H1,
 * which keeps the page correct rather than clever if a document is ever restructured.
 */
function splitTitle(source: string): { title: string; body: string } {
  const normalised = source.replace(/\r\n/g, '\n')
  const cut = normalised.indexOf('\n')
  const firstLine = cut === -1 ? normalised : normalised.slice(0, cut)
  if (!/^#\s+\S/.test(firstLine)) return { title: '', body: normalised }
  return { title: firstLine, body: cut === -1 ? '' : normalised.slice(cut + 1) }
}

export function LegalDoc() {
  const { slug } = useParams<{ slug: string }>()
  const [params] = useSearchParams()
  const doc = LEGAL_DOCS.find(d => d.slug === slug)

  // Hook order must not depend on `doc`, so this runs above the not-found return. The
  // guest notice is reached from a host-branded guest page; naming the host directly
  // under the title is what makes the notice's own sentence — "their name is shown at
  // the top of this notice" — true, and tells the guest who the controller for their
  // stay is. `?apt=` is a public apartment UUID; the NAME is read from the database, not
  // from the URL (see useHostBrandName).
  const hostName = useHostBrandName(slug === 'guest-notice' ? params.get('apt') : null)

  // Restore the previous title on unmount. Without this, a guest who taps the notice and
  // navigates back keeps "Privacy Notice for Guests — Bemgu" as their tab / installed-app
  // label for the rest of the SPA session.
  useEffect(() => {
    const previous = document.title
    document.title = doc ? `${doc.title} — Bemgu` : 'Legal — Bemgu'
    return () => { document.title = previous }
  }, [doc])

  if (!doc) {
    return (
      <LegalShell>
        <h1 className="mb-3 font-['Fraunces'] text-[26px] font-light text-[#1c1c1a]">
          That document isn’t here
        </h1>
        <p className="text-[15px] leading-relaxed text-[#5b5853]">
          <Link to="/legal" className="text-[#7a5c00] underline underline-offset-2">
            See all legal documents
          </Link>
          .
        </p>
      </LegalShell>
    )
  }

  const { title, body } = hostName ? splitTitle(doc.source) : { title: '', body: doc.source }

  return (
    <LegalShell>
      <article>
        {title && <Markdown source={title} />}
        {hostName && (
          <p className="mb-6 rounded-xl border border-[#e7d6ad] bg-[#fdf8ec] px-4 py-3 text-[14px] leading-relaxed text-[#36322c]">
            Your host: <span className="font-semibold">{hostName}</span> — the controller for your stay.
          </p>
        )}
        <Markdown source={body} />
      </article>
    </LegalShell>
  )
}
