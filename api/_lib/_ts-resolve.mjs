// Dev-only ESM resolver hook. Lets a plain-Node test import our api/ TypeScript modules,
// which follow the repo convention of writing `.js` import specifiers (tsc rewrites them
// to the `.ts` source at build time). NOT shipped and NOT imported by any runtime code —
// referenced ONLY by the `test:affiliate-links` npm script.
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && specifier.endsWith('.js')) {
      try {
        const jsUrl = new URL(specifier, context.parentURL)
        if (!existsSync(fileURLToPath(jsUrl))) {
          const tsUrl = new URL(specifier.slice(0, -3) + '.ts', context.parentURL)
          if (existsSync(fileURLToPath(tsUrl))) return { url: tsUrl.href, shortCircuit: true }
        }
      } catch {
        /* fall through to default resolution */
      }
    }
    return nextResolve(specifier, context)
  },
})
