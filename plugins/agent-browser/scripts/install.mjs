import upstream from '../upstream.lock.json' with { type: 'json' }
import { ensureCLI } from '../src/cli.mjs'
import { verify } from '../src/prepare.mjs'
// Standard npm/pnpm lifecycle script; never called from Cordis apply/dispose.
try {
  await verify()
} catch {
  // Explicit reinstallation can also repair a partial/corrupt dependency.
  await ensureCLI('agent-browser', 'agent-browser', upstream.version, true)
  await verify()
}
