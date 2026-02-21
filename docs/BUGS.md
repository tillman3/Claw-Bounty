# Bug Report — AgentEcon Codebase Review

**Date:** 2026-02-21

---

## API Bugs

### BUG-1: Route Conflict — `/agents/:address` Matches Before `/agents/register` (CRITICAL)

**File:** `api/src/routes/agents.ts`

**Description:** Express routes are matched in order of definition. `POST /agents/register` is defined first (OK for POST), but `GET /agents/:address` is defined before `GET /agents/`. Since `:address` is a param, `GET /agents/` won't match... wait, actually `GET /agents/` with no trailing param WILL match the `GET /` handler defined on the router (mounted at `/agents`).

Actually on closer inspection: the order is `POST /register`, `GET /:address`, `GET /`. When a request hits `GET /agents/`, Express checks `/:address` first — but the empty string won't match `/:address` (Express requires params to be non-empty). So `GET /agents` falls through to `GET /` correctly.

**But:** `GET /agents/register` (as a GET request) WOULD match `/:address` with `address = "register"`, which would then fail the address regex check and return 400. This is a minor issue but unexpected.

**Severity:** Low — only affects mistyped GET requests.

### BUG-2: Validator Routes Mounted at Wrong Path

**File:** `api/src/index.ts` + `api/src/routes/validators.ts`

**Description:** Validator routes are mounted at `/validators`, but the routes define:
- `POST /register` → `/validators/register` ✅
- `GET /:address` → `/validators/:address` ✅
- `POST /tasks/:id/validate` → `/validators/tasks/:id/validate` ❌
- `POST /tasks/:id/reveal` → `/validators/tasks/:id/reveal` ❌
- `GET /tasks/:id/validations` → `/validators/tasks/:id/validations` ❌

The validation endpoints are under `/validators/tasks/...` instead of `/tasks/.../validate`. This is confusing — clients would expect `/tasks/:id/validate` or the API docs need to clearly state the path.

**Severity:** Medium — API consumers will hit 404s unless they know the full path.

**Recommendation:** Either move the validation routes to the tasks router, or document the correct paths.

### BUG-3: `requirePrivateKey` Middleware Doesn't Throw as Express Error

**File:** `api/src/middleware/validate.ts`

**Description:** Both `requireFields` and `requirePrivateKey` throw `ApiError` synchronously. In Express, synchronous throws in middleware ARE caught by the error handler (in Express 5 or with async wrappers). But these routes use `async` handlers, and if the middleware throws synchronously before the async handler runs, Express 4 will catch it. This is actually fine.

**Severity:** Not a bug — works correctly in Express 4+.

### BUG-4: No Pagination on List Endpoints

**File:** `api/src/routes/tasks.ts`, `api/src/routes/agents.ts`

**Description:** `GET /tasks` and `GET /agents` iterate ALL items from the contract sequentially. With even 100 tasks, this means 100+ RPC calls per request. This will be extremely slow and will timeout.

**Severity:** High — API will become unusable at scale.

**Recommendation:** Add pagination params (`?offset=0&limit=20`), cache results, or use an indexer/subgraph.

### BUG-5: Task Creation via API Requires Private Key in Request Body

**File:** `api/src/routes/tasks.ts`

**Description:** The `POST /tasks` endpoint requires a `privateKey` in the request body (or env var). Sending private keys over HTTP is extremely dangerous. This is acceptable for local testnet development only.

**Severity:** High (if used in production) / Informational (for testnet)

**Recommendation:** For production, the API should be a read-only indexer. Write operations should happen client-side via wallet signing.

---

## Frontend Bugs

### BUG-6: `createTask` Sends Private Key to API — Frontend Wallet Not Used for Signing

**File:** `frontend/src/app/tasks/new/page.tsx` + `frontend/src/lib/api.ts`

**Description:** The frontend calls `createTask()` which POSTs to the API with `{ descriptionHash, deadline, value }`. The API then uses the server's `SIGNER_PRIVATE_KEY` to sign the transaction. This means:
1. The connected wallet is NOT the one paying/signing
2. The server's key pays for all task creations
3. The wallet connection UI is misleading — it shows the user's wallet but doesn't use it

**Severity:** High — fundamental UX disconnect. Users think they're paying from their wallet.

**Recommendation:** Use wagmi's `useWriteContract` to call ABBCore.createTaskETH directly from the user's wallet, bypassing the API for write operations.

### BUG-7: Same Issue for Agent Registration

**File:** `frontend/src/app/register/page.tsx`

**Description:** Same as BUG-6 — `registerAgent()` POSTs to the API, which uses the server key. The connected wallet is decorative.

**Severity:** High

### BUG-8: No Contract ABIs in Frontend

**File:** `frontend/src/`

**Description:** The frontend has no contract ABIs or direct contract interaction. All writes go through the REST API. For a proper dApp, the frontend should interact with contracts directly via wagmi/viem.

**Severity:** Medium — architecture limitation, not a crash bug.

### BUG-9: Hardcoded ETH/USD Price

**File:** `frontend/src/lib/api.ts` line 69, `frontend/src/app/tasks/new/page.tsx`

**Description:** ETH price is hardcoded as `2500`:
```typescript
bountyUSD: Math.round(bountyETH * 2500),
```

**Severity:** Low — cosmetic, but will show wrong USD values.

### BUG-10: Demo Mode Graceful Degradation Works Well ✅

The frontend's fallback to mock data when API is unreachable is well implemented. Not a bug — noting as positive.

---

## MCP Server Bugs

### BUG-11: MCP Server Had No `.env` File

**File:** `mcp/.env` (was missing)

**Description:** The MCP server had `.env.example` with zero addresses but no actual `.env` file, so it would use `0x000...000` for all contracts.

**Severity:** High — MCP server was completely non-functional.

**Fix:** Created `mcp/.env` with correct contract addresses. ✅ (Fixed in this commit)

---

## Summary

| ID | Severity | Component | Status |
|----|----------|-----------|--------|
| BUG-1 | Low | API | Open |
| BUG-2 | Medium | API | Open |
| BUG-4 | High | API | Open |
| BUG-5 | High* | API | Open (by design for testnet) |
| BUG-6 | High | Frontend | Open |
| BUG-7 | High | Frontend | Open |
| BUG-8 | Medium | Frontend | Open |
| BUG-9 | Low | Frontend | Open |
| BUG-11 | High | MCP | **Fixed** |
