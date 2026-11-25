import { verify } from './prepare.mjs'
export const name = 'agent-browser'
export const inject = ['host']
export async function apply(ctx) {
  await verify()
  await ctx.host.skills.registerDirectory('skills')
}
