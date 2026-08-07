// App build metadata.
//
// The `__APP_*__` values are injected at build time by Vite's `define`
// (see vite.config.ts) from the Vercel deployment's git context. Vite always
// applies `define` in both dev and production, so these identifiers are always
// replaced with a string literal — the `typeof` guards are belt-and-suspenders
// for any environment (e.g. a bare unit-test runner) where they might not be.

declare const __APP_COMMIT_SHA__: string
declare const __APP_COMMIT_REF__: string
declare const __APP_COMMIT_MSG__: string
declare const __APP_BUILD_TIME__: string

export const BUILD_COMMIT_SHA =
  typeof __APP_COMMIT_SHA__ !== 'undefined' ? __APP_COMMIT_SHA__ : ''
export const BUILD_COMMIT_REF =
  typeof __APP_COMMIT_REF__ !== 'undefined' ? __APP_COMMIT_REF__ : ''
export const BUILD_COMMIT_MSG =
  typeof __APP_COMMIT_MSG__ !== 'undefined' ? __APP_COMMIT_MSG__ : ''
export const BUILD_TIME =
  typeof __APP_BUILD_TIME__ !== 'undefined' ? __APP_BUILD_TIME__ : ''

export const BUILD_SHA_SHORT = BUILD_COMMIT_SHA ? BUILD_COMMIT_SHA.slice(0, 7) : ''

// GitHub squash-merge commits default to "<title> (#123)". Pull the PR number
// out of the merged commit message so we can show a human-friendly PR label.
export const BUILD_PR_NUMBER = (() => {
  const m = BUILD_COMMIT_MSG.match(/\(#(\d+)\)\s*$/) || BUILD_COMMIT_MSG.match(/\(#(\d+)\)/)
  return m ? m[1] : ''
})()

// First line of the commit message (the PR/commit title), trailing "(#123)"
// stripped so it doesn't duplicate the PR badge.
export const BUILD_COMMIT_TITLE = BUILD_COMMIT_MSG
  ? BUILD_COMMIT_MSG.split('\n')[0].replace(/\s*\(#\d+\)\s*$/, '').trim()
  : ''

const REPO_URL = 'https://github.com/lyndeinvestments-lab/tendwell-ops'
export const BUILD_PR_URL = BUILD_PR_NUMBER ? `${REPO_URL}/pull/${BUILD_PR_NUMBER}` : ''
export const BUILD_COMMIT_URL = BUILD_COMMIT_SHA ? `${REPO_URL}/commit/${BUILD_COMMIT_SHA}` : ''

// True when no git context was injected — i.e. a local `npm run dev` build.
export const IS_LOCAL_BUILD = !BUILD_COMMIT_SHA
