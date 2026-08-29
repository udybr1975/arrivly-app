import { useState, useRef, useEffect } from 'react'
import { Send, RefreshCw, MessageCircle } from 'lucide-react'
import { DEMO_STARTERS } from './demoStarters'

interface Msg { role: 'user' | 'assistant'; text: string }
interface Props {
  apartmentId: string
  token: string
  accentColor: string
  brandName: string
  guestName: string | null
  city: string
  /** THE PUBLIC PEEK (apartments.is_public_demo). Scripted chips only, no free typing.
      Nothing here decides anything: /api/guest-chat scripts its own reply from the same
      flag server-side, so a visitor who flips this prop in devtools gets the same four
      answers. This exists to make the UI honest about what it is, not to enforce it. */
  isPublicDemo?: boolean
  /** OPENS THE HOST-MESSAGE OVERLAY. Purely presentational: ChatBot does NOT decide who may
      message a host and must never try to. A caller that passes this handler has already
      applied the eligibility gate (`tokenParam && !isPublicDemo` in GuestPage — the same
      condition governing the Home-tab entry and the MessageHost render itself). No handler =
      no door, and the greeting drops its promise of one along with it. */
  onMessageHost?: () => void
}

// LONG BRAND NAMES FALL BACK RATHER THAN TRUNCATE INTO NONSENSE. `hosts.brand_name` has no
// length CHECK in the database — a host can PATCH any length straight through PostgREST — so
// this is a real input, not a hypothetical. Past this many characters the label reads "your
// host" instead, because "Message Anna's Barcelona Apart…" is worse than a clean generic: it
// looks like a rendering bug rather than a deliberate phrase.
//
// 28 IS A SEMANTIC THRESHOLD, NOT A FIT GUARANTEE — and be precise about which half the CSS
// protects, because an earlier version of this comment had it backwards. The row is built so
// the QUESTION shrinks and the CALL TO ACTION does not: `Message {hostLabel}` is `shrink-0`,
// so the brand name and the verb survive at every width, and what ellipsizes is the leading
// "Didn't find your answer?". That ordering is the whole point. With both halves in one
// truncating span the opposite happened — `truncate` clips the END, so a 320px phone showed
// "Didn't find your answer? Mess…" and NO NAME AT ALL, which is the one outcome this constant
// exists to prevent. Measured: at 320px roughly 233px of text width is available, and
// "Didn't find your answer? Message Anna Stays" needs ~260px — so the live fleet's longest
// brand (14 chars) already overflowed, not merely the 28-char edge case.
//
// So this constant does ONE job: decide whether a name is short enough to be worth showing at
// all, because "Message Anna's Barcelona Apart…" reads as a rendering bug where "Message your
// host" reads as a deliberate phrase. (Longest brand_name MEASURED IN THE LIVE DB 29 Aug 2026:
// 14 chars — a dated measurement, not a standing fact; re-measure before relying on it.)
const BRAND_LABEL_MAX = 28

const STARTERS = ['How does check-in work?', "What's the Wi-Fi?", 'Good food nearby', 'Getting around']


export default function ChatBot({ apartmentId, token, accentColor, brandName, guestName, city, isPublicDemo = false, onMessageHost }: Props) {
  // ONE FACT DRIVES BOTH THE BUTTON AND THE GREETING, deliberately — they cannot disagree
  // because there is nothing to keep in sync. The old greeting told EVERY non-demo guest to
  // "use Message host", including TOKENLESS ones with no such control anywhere on their page:
  // ChatBot renders with `token={tokenParam ?? ''}`, so a guest without a token still reaches
  // the chat and was being pointed at a door that was not there. If this ever splits back into
  // two separate conditions, that bug returns.
  const canMessageHost = !!onMessageHost && !isPublicDemo
  const hostLabel = brandName.length <= BRAND_LABEL_MAX ? brandName : 'your host'
  const [msgs, setMsgs] = useState<Msg[]>([
    // Says plainly what it is, in the guest's first line of contact. The header label is the
    // PERSISTENT disclosure; this is the plain-language one. Both are required, not either/or.
    // The demo variant drops "use Message host" — messaging is OFF on the public peek, so the
    // real greeting would point at a control that is not on the page.
    {
      role: 'assistant',
      text: isPublicDemo
        ? `Hi — I'm the AI assistant for this stay, and I know this apartment${city ? ' and ' + city : ''}. On this demo page I answer the four sample questions below.`
        : `Hi${guestName ? ' ' + guestName : ''} — I'm an AI assistant for this stay. I know this apartment${city ? ' and ' + city : ''}, so ask me anything.${canMessageHost ? ' To reach a person, use the button below.' : ''}`,
    },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [usedDemoChips, setUsedDemoChips] = useState<string[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs, loading])

  const sendMessage = async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || loading) return
    setInput('')
    const history = msgs
      .filter((m, i) => !(i === 0 && m.role === 'assistant')) // drop the seeded greeting
      .map(m => ({ role: m.role, text: m.text }))
    setMsgs(p => [...p, { role: 'user', text: trimmed }])
    setLoading(true)
    try {
      const res = await fetch('/api/guest-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apartmentId, token, message: trimmed, history }),
      })
      if (res.status === 429) { setMsgs(p => [...p, { role: 'assistant', text: "You're sending messages quickly — give it a moment, then try again." }]); return }
      if (res.status === 403) { setMsgs(p => [...p, { role: 'assistant', text: "I can help once your stay is confirmed — please scan your check-in QR code to start." }]); return }
      if (res.status === 500) { setMsgs(p => [...p, { role: 'assistant', text: "I'm getting a lot of questions right now — please try again in a moment." }]); return }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const reply = (data.reply || '').trim()
      if (!reply) throw new Error('empty')
      setMsgs(p => [...p, { role: 'assistant', text: reply }])
      // Burn the demo chip only on a REAL answer. Marking it before the fetch meant one flaky
      // request left that question un-askable for the session — and on the demo the chips are
      // the only affordance, because the composer is a sign rather than an input.
      setUsedDemoChips(p => (p.includes(trimmed) ? p : [...p, trimmed]))
    } catch {
      setMsgs(p => [...p, { role: 'assistant', text: 'Something went wrong on my end — please try again in a moment.' }])
    } finally {
      setLoading(false)
    }
  }

  const showStarters = !loading

  return (
    <div className="flex flex-col h-full bg-[#fbfaf7]">
      <div className="shrink-0 px-5 py-3.5 text-white flex items-center gap-3" style={{ background: accentColor }}>
        <span className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-sm font-bold">{brandName.charAt(0)}</span>
        <div>
          {/* EU AI ACT ART. 50 TRANSPARENCY. Persistent, always visible while chatting, not
              dismissible, and NOT delegated to a first chat message — a message scrolls away and
              a returning guest never sees it. It also REPLACES the old "Ask your host" eyebrow,
              which was the real problem: it told the guest they were talking to a person.
              THE BOUNDARY: this label lives in ChatBot.tsx and nowhere else. MessageHost.tsx is
              HUMAN messaging and renders its OWN separate header — the two surfaces do not share
              a header component, so there is no prop to mis-set and no path by which this label
              can reach the human thread. If the headers are ever unified, this MUST become an
              explicit prop defaulting to OFF.
              THE OTHER GUEST-FACING AI CHAT IS LABELLED TOO: WelcomePage's pre-arrival concierge
              (/api/welcome-chat) carries the same disclosure as of 24 Aug 2026. Its label is fixed
              INK rather than this cream pill, because its header is already light — the shared
              rule is that the disclosure must not read `accent`, not that the markup matches.
              ALL THREE AI CHATS ARE NOW LABELLED — this one, WelcomePage's pre-arrival concierge
              (/api/welcome-chat) and GuideDrawer (/api/guide-assistant), as of 24 Aug 2026.
              GuideDrawer was labelled DESPITE being host-facing: Art. 50 attaches to natural
              persons and a host is one, so there is NO internal-surface or B2B carve-out — the
              only carve-out is OBVIOUSNESS, and it scored weakly on it. If a FOURTH AI surface is
              ever added it inherits this obligation; the fix is a site ENUMERATION, never an edit
              to whichever one you happen to have open. */}
          {/* INK ON CREAM, NOT white-on-accent at 70% opacity. `accentColor` is any host-typed
              hex (PropertySetup validates only /^#[0-9a-fA-F]{6}$/), so white-on-accent has NO
              verifiable ratio — MessageHost's close control in this same change measures white
              on a pale accent at 1.44:1. A DISCLOSURE WHOSE VISIBILITY DEPENDS ON A COLOUR
              PICKER IS NOT "PERSISTENT, ALWAYS VISIBLE", which is the whole obligation. Ink
              #231d17 on cream #fffdf9 is 16.41:1 whatever the host picks. The brand line below
              stays white-on-accent — it is decoration, not the obligation. */}
          <span className="inline-block mb-1 px-1.5 py-0.5 rounded bg-[#fffdf9] text-[#231d17] text-[10px] tracking-[0.16em] uppercase font-semibold leading-none">AI assistant</span>
          <p className="text-sm font-medium leading-none">{brandName}</p>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-3">
        {msgs.map((m, i) => (
          <div
            key={i}
            className={m.role === 'user'
              ? 'ml-auto max-w-[80%] rounded-2xl rounded-br-sm px-4 py-2.5 text-sm text-white'
              : 'mr-auto max-w-[85%] rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm bg-[#fffdf9] border border-[#e9e4d9] text-[#1c1c1a]'}
            style={m.role === 'user' ? { background: accentColor } : undefined}
          >
            <p className="whitespace-pre-line leading-relaxed break-words">{m.text}</p>
          </div>
        ))}
        {loading && (
          <div className="mr-auto flex items-center gap-2 text-[#9a958c] text-xs italic px-1">
            <RefreshCw size={12} className="animate-spin" /> Thinking…
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {showStarters && (
        isPublicDemo ? (
          <div className="px-5 pb-2">
            <div className="flex flex-wrap gap-2">
              {DEMO_STARTERS.map(c => {
                const used = usedDemoChips.includes(c.send)
                // USED STATE IS FIXED INK, NOT accent-at-40%. The used/unused distinction is
                // the state carrying this control's point, and `accentColor` is any host-typed
                // hex, so an opacity on it has no verifiable ratio (the same argument as the
                // AI-assistant pill). #b3aa9b on the #fbfaf7 chat ground is 2.32:1 — below the
                // text floor, which is CORRECT and deliberate here: WCAG 1.4.3 and 1.4.11 both
                // exempt disabled controls, and a used chip that still read at full strength
                // would not communicate "answered". The LIVE chips are what must be legible,
                // and they keep the host accent at full opacity.
                return (
                  <button
                    key={c.send}
                    onClick={() => sendMessage(c.send)}
                    disabled={used}
                    className="text-xs px-3 py-1.5 rounded-full border bg-transparent cursor-pointer disabled:cursor-default"
                    style={
                      used
                        ? { borderColor: '#e9e4d9', color: '#b3aa9b' }
                        : { borderColor: `${accentColor}55`, color: accentColor }
                    }
                  >
                    {c.label}
                  </button>
                )
              })}
            </div>
            {/* Fixed ink, not the accent: this line explains the demo, and its legibility must
                not depend on a host-chosen hex (the same argument as the AI-assistant pill). */}
            <p className="mt-2 text-[11px] leading-snug text-[#6b6354]">
              {usedDemoChips.length >= DEMO_STARTERS.length
                ? "That's the scripted part. Everything else on this page is live — try Explore."
                : 'Demo: pick a question to see how the assistant answers.'}
            </p>
          </div>
        ) : (
          <div className="px-5 pb-2 flex flex-wrap gap-2">
            {STARTERS.map(s => (
              <button key={s} onClick={() => sendMessage(s)} className="text-xs px-3 py-1.5 rounded-full border bg-transparent cursor-pointer" style={{ borderColor: `${accentColor}55`, color: accentColor }}>
                {s}
              </button>
            ))}
          </div>
        )
      )}

      {isPublicDemo ? (
        /* THE DEMO COMPOSER IS A SIGN, NOT AN INPUT. A disabled text field invites a tap and
           then does nothing, which reads as a broken page; a dashed box that says what would
           happen here reads as a demo. Non-focusable (a div, no tabindex) so keyboard users
           are not dropped into a dead control either. The real gate is server-side — this is
           the explanation, not the enforcement. */
        <div className="border-t border-[#e9e4d9] px-4 py-3 flex items-center gap-2 bg-[#fffdf9]">
          <div
            /* #6b6354, NOT the #7a7364 this was drafted with — COMPUTED, not eyeballed:
               #7a7364 on #f4f1ea is 4.17:1 at 12.5px, under the 4.5:1 AA floor for normal
               text. #6b6354 is the project's muted token (the d93c2d9 sweep) and measures
               5.28:1 on the same ground. The dashed BORDER stays #cfc7b6 at 1.49:1 — it is
               decoration around a box that is not interactive, so 1.4.11 does not attach,
               and the box explains itself in text. */
            className="flex-1 rounded-2xl border border-dashed border-[#cfc7b6] bg-[#f4f1ea] px-4 py-2.5 text-[12.5px] leading-snug text-[#6b6354]"
          >
            In a real guest page, guests type anything here and the assistant answers from the
            host&apos;s own details.
          </div>
          <button
            disabled
            aria-label="Send"
            className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-white border-none cursor-default opacity-[0.35]"
            style={{ background: accentColor }}
          >
            <Send size={16} />
          </button>
        </div>
      ) : (
      <div className="border-t border-[#e9e4d9] px-4 py-3 flex items-center gap-2 bg-[#fffdf9]">
        {/* Placeholder is NOT `Ask ${brandName}…` — that is the same implies-a-human
            construction the header eyebrow was changed away from; leaving it would have made
            the file contradict its own Art. 50 comment. */}
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') sendMessage(input) }}
          placeholder="Ask about your stay…"
          className="flex-1 bg-[#fbfaf7] border border-[#e9e4d9] rounded-full px-4 py-2.5 text-sm outline-none focus:border-[#9a958c]"
        />
        <button onClick={() => sendMessage(input)} disabled={loading || !input.trim()} aria-label="Send" className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-white border-none cursor-pointer disabled:opacity-40" style={{ background: accentColor }}>
          <Send size={16} />
        </button>
      </div>
      )}

      {/* THE QUIET OFFRAMP. Sits BELOW the composer, not above the starters: it is what a guest
          reaches for AFTER the assistant has failed them, so it must not compete with asking.
          Transparent and hairline-bordered so it reads as a secondary route, with the action
          words in the host accent so the door is still obviously a door.

          RENDERED ONLY WHEN `canMessageHost`, which is `onMessageHost && !isPublicDemo`. The
          demo check is BELT AND BRACES: the demo passes no handler, so the first half already
          excludes it — but messaging is off on the public peek and a visible door there would
          be a promise the server refuses (403), so the flag is named explicitly rather than
          left implied by a caller's discipline. */}
      {canMessageHost && (
        <div className="shrink-0 px-4 pb-3 bg-[#fffdf9]">
          <button
            type="button"
            onClick={onMessageHost}
            /* WCAG 2.5.3 LABEL IN NAME, IN BOTH BRANCHES — and the fallback branch is the one
               that is easy to get wrong. The accessible name must CONTAIN the visible label. When
               the brand is short the two are identical. When it has fallen back, the screen says
               "Message your host" while the full brand is what a screen-reader user actually needs
               to hear — so the name leads with the VISIBLE words (keeping speech input working for
               "click message your host", the only words on screen) and appends the real brand after
               a dash. Naming only `brandName` here, as an earlier version did, satisfied 2.5.3 for
               short brands and FAILED it for exactly the long ones this fallback exists for. */
            aria-label={hostLabel === brandName
              ? `Didn't find your answer? Message ${brandName}`
              : `Didn't find your answer? Message ${hostLabel} — ${brandName}`}
            /* overflow-hidden IS THE BACKSTOP, not decoration. `shrink-0` on the CTA means an
               unfittable brand (28 wide glyphs, all-caps or CJK, on a 320px phone) would otherwise
               overflow the row and give the whole guest page a horizontal scrollbar. Clipping
               inside the button is the strictly better failure: it stays a label problem instead
               of becoming a page-layout one. */
            className="w-full min-h-[44px] flex items-center gap-2 overflow-hidden rounded-xl border border-[#e9e4d9] bg-transparent px-4 py-2.5 text-left cursor-pointer"
          >
            <MessageCircle size={15} className="shrink-0" style={{ color: accentColor }} />
            {/* TWO SPANS, AND THE SPLIT IS THE MECHANISM. The question is the shrinking half
                (`min-w-0 truncate`); the call to action is `shrink-0` so the verb and the brand
                name are width-invariant and can never be the thing that disappears. Both children
                are single-line, so the row still cannot wrap onto two. Collapsing these back into
                one truncating span re-opens the defect this shape fixes — see the note on
                BRAND_LABEL_MAX above. */}
            <span className="min-w-0 truncate text-[12.5px] leading-snug text-[#5b5853]">
              Didn&apos;t find your answer?
            </span>
            <span className="shrink-0 text-[12.5px] leading-snug font-medium" style={{ color: accentColor }}>
              Message {hostLabel}
            </span>
          </button>
        </div>
      )}
    </div>
  )
}
