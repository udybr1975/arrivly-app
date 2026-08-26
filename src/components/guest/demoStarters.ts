// The public peek's four chips. SPLIT OUT OF ChatBot.tsx so a node test can import them
// without pulling in React — the point is a WHOLE-BLOCK equality assertion against
// api/_lib/public-demo.ts's DEMO_QUESTIONS, because these two lists are the same four
// strings maintained in two places and a drift is SILENT (the chip falls through to the
// fallback line rather than erroring).
//
// `send` is the WIRE string and keys the server's answer map. `label` is what fits on a chip.
// Only `send` is under the equality test; `label` is free to differ and does.
export const DEMO_STARTERS: { label: string; send: string }[] = [
  { label: "What's the WiFi password?", send: "What's the WiFi password?" },
  { label: 'Where do I leave the keys?', send: 'Where do I leave the keys at checkout?' },
  { label: 'A good bakery nearby?', send: 'Is there a good bakery nearby?' },
  { label: 'Late checkout?', send: 'Can I check out late tomorrow?' },
]
