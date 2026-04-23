# E2E tests

Playwright suite for the golden paths. Runs against `localhost:5000` by default, or a preview URL via `BASE_URL`.

## First-time setup

```bash
# One-shot: opens a browser, you sign in with Google manually.
# Saves tests/.auth/admin.json which every other test reuses.
npm run test:e2e:auth
```

Re-run that command whenever the stored session expires.

## Running

```bash
# Headless, all specs
npm run test:e2e

# Interactive UI mode (great for writing new tests)
npm run test:e2e:ui

# Against a preview deployment
BASE_URL=https://tendwell-ops-xxx.vercel.app npm run test:e2e

# Open the last HTML report
npm run test:e2e:report
```

## What's covered

| Spec | Flow under test |
|---|---|
| `flows/pipeline.spec.ts` | Card click opens property modal (no middle step) |
| `flows/quote-sheet-live-edit.spec.ts` | Inline edit live-recomputes Profit % |
| `flows/master-list-archive.spec.ts` | Archive toggle reveals/hides panel |
| `flows/access-codes-badge.spec.ts` | Missing / Incomplete badges render + tooltip |
| `flows/overview-gating.spec.ts` | Modal Overview shows all admin-gated sections |

## Structure

```
tests/
├── .auth/           # git-ignored — saved session cookies
├── e2e/
│   ├── auth/
│   │   └── setup.spec.ts    # manual login, saves storage state
│   └── flows/
│       └── *.spec.ts
└── README.md
```

Tests are read-only wherever possible. Any spec that mutates DB state must clean up in `test.afterEach`.
