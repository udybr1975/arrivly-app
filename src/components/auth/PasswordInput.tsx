import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

/**
 * Password field with a show/hide toggle (auth surface only).
 *
 * ONE COMPONENT FOR ALL FOUR PASSWORD FIELDS — Login, Signup, and BOTH fields on
 * ResetPassword. Four hand-copied toggles would drift: the icon, the aria-label wording,
 * the focus ring and the right padding are each a thing someone would "tidy" at one site
 * and not the other three, and a divergence here is invisible until a screen-reader user
 * or a keyboard user hits the odd one out. Add a fifth password field by consuming this,
 * never by copying it.
 *
 * THE LABEL STAYS IN THE CALLER. Login wraps its label in a flex row alongside a "Forgot
 * password?" link, so a label baked in here would have to grow a prop to accommodate one
 * caller. The component owns the wrapper, the input and the button — nothing above them.
 *
 * WHAT THE TOGGLE IS AND IS NOT: it changes the input's `type` between 'password' and
 * 'text'. That is a DISPLAY change in the user's own browser, on a value they typed
 * themselves. It sends nothing, stores nothing and logs nothing.
 */

// Copied from the callers' INPUT constant, with right padding widened to clear the button.
// Every other class is identical on purpose — this field must sit flush with the email
// field above it, and any drift shows up as a 1px seam between two stacked inputs.
const PASSWORD_INPUT =
  'w-full bg-white border border-[#e0dacd] rounded-[11px] pl-[15px] pr-[44px] py-[13px] text-sm text-[#1c1c1a] placeholder:text-[#b3ab9b] focus:outline-none focus:border-[#c8a24e] focus:ring-2 focus:ring-[#c8a24e]/20 transition-colors'

type Props = {
  id: string
  value: string
  onChange: (value: string) => void
  placeholder: string
  autoComplete: string
  minLength?: number
  required?: boolean
}

export default function PasswordInput({
  id,
  value,
  onChange,
  placeholder,
  autoComplete,
  minLength,
  required,
}: Props) {
  // Local to each instance, which is what makes ResetPassword's two fields independent:
  // revealing the new password must not force-reveal the confirm field, or the whole point
  // of a confirm field (catching a typo you cannot see) is lost.
  const [show, setShow] = useState(false)

  return (
    <div className="relative">
      <input
        id={id}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        className={PASSWORD_INPUT}
        placeholder={placeholder}
        autoComplete={autoComplete}
        minLength={minLength}
        required={required}
        // THE REVEAL TOGGLE IS WHY THESE THREE ARE HERE, and they are not cosmetic.
        // A `type="password"` field is never spellchecked; the instant `show` flips it to
        // `type="text"` its value becomes eligible for Chrome's Enhanced Spellcheck and
        // Microsoft Editor, BOTH OF WHICH SEND FIELD CONTENTS TO A REMOTE SERVICE. That is
        // "spell-jacking", and reveal-toggles on login forms were the original reported
        // vector — i.e. the one path by which adding this control could let a typed password
        // leave the device. spellCheck={false} closes it.
        // autoCapitalize/autoCorrect close the same door on mobile: on iOS a revealed field
        // would auto-capitalise the first character for anyone who taps Show BEFORE typing,
        // and QuickType could learn the string into the device dictionary.
        spellCheck={false}
        autoCapitalize="none"
        autoCorrect="off"
      />
      <button
        // type="button" IS LOAD-BEARING: inside a <form>, a button with no type defaults to
        // type="submit", so toggling visibility would submit the login/signup form instead.
        type="button"
        onClick={() => setShow(v => !v)}
        aria-pressed={show}
        aria-label={show ? 'Hide password' : 'Show password'}
        className="absolute right-0 top-0 flex h-full w-[44px] items-center justify-center rounded-r-[11px] text-[#6b6354] transition-colors hover:text-[#1c1c1a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c8a24e]/50"
      >
        {/* Fixed ink, never the host accent: #6b6354 on white computes 5.9:1, and an
            accent-coloured control has no verifiable ratio. */}
        {show ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
      </button>
    </div>
  )
}
