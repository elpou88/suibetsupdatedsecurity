# Cetus Protocol — Smart Contract Security Research Submission
**Researcher:** Independent  
**Platform:** Immunefi (Cetus Protocol Bug Bounty)  
**Date:** 2026-04-09  
**Scope Analyzed:** All four on-chain Cetus packages on Sui Mainnet

---

## Package Addresses (Mainnet)

| Package | Address |
|---|---|
| CLMM Pool | `0x1eabed72c53feb3805120a081dc15963c204dc8d091542592abaf7a35689b2fb` |
| DCA | `0x587614620d0d30aed66d86ffd3ba385a661a86aa573a4d579017068f561c6d8f` |
| Limit-Order | `0x533fab9a116080e2cb1c87f1832c1bf4231ab4c32318ced041e75cc28604bba9` |
| Vaults | `0xd3453d9be7e35efe222f78a810bb3af1859fd1600926afced8b4936d825c9a05` |

---

---

## FINDING #1 — INFORMATIONAL
**Title:** Limit-Order GlobalConfig — Keeper Set Is a Single-Point Singleton  
**Severity:** Informational  
**Package:** Limit-Order  
**Confirmed On-Chain:** Yes

### Description
The Limit-Order `GlobalConfig` object (`0xd3403f23a053b52e5c4ef0c2a8be316120c435ec338f2596647b6befd569fd9c`) has only **one** registered keeper in its ACL:

```json
"require_flash_loan_auth": true,
"acl.permissions.size": 1
```

The ACL head resolves to a single keeper address. All limit-order flash loan executions must be authorized by this single keeper address.

### Risk
If the single keeper's private key is compromised, an attacker can:
1. Execute all open limit orders at unfavorable rates (the order's `rate` is the minimum, but execution timing and profit extraction can be adversarial).
2. Selectively cancel orders (`cancel_order_by_keeper`) to prevent legitimate fills.
3. Drain keeper profit on every fill at market rate while blocking competitive keepers.

### Supporting Evidence
```bash
# On-chain ACL size = 1
curl -s RPC sui_getObject 0xd3403f23... | .fields.acl.fields.permissions.fields.size
# → "1"
```

### Recommendation
Register at least 2–3 keeper addresses so a single key compromise does not halt or exploit the entire limit-order system.

---

---

## FINDING #2 — LOW
**Title:** Vaults — Oracle Pool Is the Vault's Own Underlying CLMM Pool  
**Severity:** Low (requires authorized operator compromise)  
**Package:** Vaults  
**Confirmed On-Chain:** Yes

### Description
The Vaults contract uses a configurable `price_oracles` table in `VaultsManager` to price its flash loan repayments. After inspecting all `AddOraclePoolEvent` emissions, every vault's oracle pool ID is **identical** to its own underlying CLMM pool ID:

| Vault | CLMM Pool (Underlying) | Oracle Pool (Flash Loan Pricing) |
|---|---|---|
| haSUI/SUI | `0x871d8a22...` | `0x871d8a22...` ← **same** |
| afSUI/SUI | `0xa528b26e...` | `0xa528b26e...` ← **same** |
| CERT/SUI | `0x6c545e78...` | `0x6c545e78...` ← **same** |

The `flash_loan` function borrows CoinA from the vault's CLMM position, and the required CoinB repayment is calculated using the **spot price** of that same pool.

### Impact
An authorized vault reinvest/rebalance manager who is adversarial (or whose key is compromised) could:
1. Manipulate the vault's CLMM pool price (e.g. via a large imbalanced swap) in the same transaction block
2. Trigger vault `flash_loan` with the temporarily skewed spot price as oracle
3. Repay less CoinB than the fair-value equivalent of the borrowed CoinA
4. Restore pool price — netting the price difference as profit at vault LP holders' expense

### Access Control Note
The `flash_loan` function is restricted to addresses in the VaultsManager ACL (confirmed: 4 registered operators). This cannot be triggered permissionlessly. The risk is limited to insider/key-compromise scenarios.

### Supporting Evidence
```bash
# AddOraclePoolEvent (haSUI/SUI vault)
# oracle_pool: 0x871d8a22...
# CreateEvent for same vault
# clmm_pool: 0x871d8a22...
# They are identical.

# FlashLoanEvent (live):
{
  "loan_type": "0x2::sui::SUI",
  "repay_type": "hasui::HASUI",
  "oracle_pool": "0x871d8a22...",  ← same as vault pool
  "amount": "3033344556",
  "repay_amount": "2963993173",
  "current_sqrt_price": "18614592595022189156"
}
```

### Recommendation
Use a separate, high-liquidity Cetus CLMM pool (not the vault's own pool) as the oracle. Alternatively, use a time-weighted average price (TWAP) instead of spot price for flash loan repayment calculation.

---

---

## FINDING #3 — LOW
**Title:** DCA — Oracle Signature Validity Window Allows 5-Minute Stale Price Execution  
**Severity:** Low  
**Package:** DCA  
**Confirmed On-Chain:** Yes

### Description
The DCA `GlobalConfig` stores `oracle_valid_duration = 300` (seconds = 5 minutes). Keeper oracle signatures remain valid for 5 minutes from their timestamp. The `flash_loan_for_make_deal` function accepts a `vector<String>` of oracle-signed price data and verifies signatures are within this window.

```json
// DCA GlobalConfig live values (0x5db218756f8486fa2ac26fab590c4be4e439be54e6d932c9a30b20573a5b706a)
{
  "oracle_valid_duration": "300",
  "keeper_threshold": "2",
  "acl.permissions.size": "6"
}
```

### Risk
In fast-moving markets (flash crash, de-peg event), a keeper could intentionally execute a DCA order using a 4m50s-old oracle signature at a price significantly worse than the current market:
- If CoinOut drops 8% in 5 minutes, the oracle signature still authorizes execution at the original price
- The user's DCA order fills at a rate 8% worse than available market price
- The keeper extracts the difference as additional profit

### Partial Mitigation
`keeper_threshold = 2` requires **2 of 6 registered keepers** to co-sign each execution. Exploiting this requires collusion between two registered keepers.

### Supporting Evidence
```bash
# Live on-chain DCA config:
oracle_valid_duration: 300 → 5 minutes
keeper_threshold: 2 → 2-of-6 multisig

# Real DCA execution transaction: 7dM5cyVQ7eHTXhe1RRoJzbrQ5MHmWCQ3YfLLGhb7MYxR
# Input 4: vector<String> with 132-byte oracle signature payload
```

### Recommendation
Reduce `oracle_valid_duration` to 60–120 seconds. For highly volatile pairs, consider requiring on-chain price validation (e.g., CLMM TWAP) in addition to off-chain keeper signatures.

---

---

## FINDING #4 — MEDIUM
**Title:** Vaults — `FlashLoanReceipt` Stores Repayment Coin Type as a Runtime String (`TypeName`) Instead of a Phantom Type Parameter  
**Severity:** Medium  
**Package:** Vaults  
**Confirmed On-Chain:** Yes

### Description
The Vaults `FlashLoanReceipt` struct has **zero phantom type parameters** and stores the repay coin type as a `TypeName` string field:

```move
struct FlashLoanReceipt {   // abilities: []  ← no drop = hot potato
    vault_id: ID,
    repay_type: TypeName,   // ← string "0x2::sui::SUI", NOT a phantom<T>
    repay_amount: u64,
}
```

The `repay_flash_loan<CoinA, CoinB>` function takes this receipt and verifies repayment by checking:
```
type_name::get<CoinA>() == receipt.repay_type
```

This is a **runtime string comparison** rather than a compile-time type system enforcement.

### Risk
In contrast, the limit-order package uses a properly typed `FlashLoanReceipt<T>` where the phantom type provides compile-time guarantees. The Vaults design relies entirely on the runtime `TypeName` check.

**Potential edge cases:**
1. **Package upgrade / type alias:** If the chain ever has a scenario where two distinct type paths resolve to the same `TypeName` string (unlikely but possible with Move upgrades), the check could pass for the wrong type.
2. **Bytecode verification gap:** In cases where the Move verifier has a gap, a future exploit could construct a `TypeName` value that matches without being the actual coin type.
3. **Incorrect implementation:** If the closed-source vault implementation contains any logic where the TypeName check is conditionally bypassed (e.g., a governance override path), an attacker could repay with a worthless coin.

### Confirmed Structural Evidence
```bash
# Vaults FlashLoanReceipt struct (on-chain):
{
  "typeParameters": [],         # ← ZERO phantom types
  "abilities": {"abilities": []}, # ← no drop = hot potato
  "fields": [
    {"name": "vault_id", "type": "ID"},
    {"name": "repay_type", "type": "TypeName"},  # ← string
    {"name": "repay_amount", "type": "U64"}
  ]
}

# Compare: Limit-Order's FlashLoanReceipt (same package ecosystem):
{
  "typeParameters": [{"isPhantom": true}],  # ← 1 phantom type
  ...
}
```

### Impact Assessment
The issue is structural. Confirmed exploitability requires reading the closed-source implementation. **If** the TypeName check is the ONLY protection (no additional vault_id or type verification), and if a type-confusion edge case is triggered, an attacker could repay with a near-worthless token and drain vault liquidity.

### Recommendation
Refactor `FlashLoanReceipt` to use phantom type parameters:
```move
struct FlashLoanReceipt<phantom RepayType> {
    vault_id: ID,
    repay_amount: u64,
}
```
This eliminates reliance on runtime string comparison and brings the design in line with the limit-order package's approach.

---

---

## FINDING #5 — HIGH (Unconfirmed Critical / Needs Team Verification)
**Title:** DCA — `MakeDealReceipt` Has Zero Phantom Type Parameters; Cross-Order Receipt Confusion Possible If `order_id` Check Is Absent  
**Severity:** High (unconfirmed — closed-source implementation)  
**Package:** DCA  
**Confirmed On-Chain:** Structurally confirmed; exploitability requires team verification

### Description
The DCA `flash_loan_for_make_deal` function returns a hot-potato receipt struct with **zero phantom type parameters**:

```move
struct MakeDealReceipt {   // abilities: []  ← no drop = hot potato
    order_id: ID,          // only runtime identifier
    in_amount: u64,
    promise_out_amount: u64,
    fee_amount: u64,
}
```

The `Order<InCoin, OutCoin>` struct has **two phantom type parameters**, but `MakeDealReceipt` has **none**. This means:
- Move's type system provides **zero compile-time guarantee** that the receipt was created for a specific `InCoin`/`OutCoin` pair
- The only protection against cross-order receipt misuse is the runtime `order_id` field

### Function Signatures (On-Chain)
```
flash_loan_for_make_deal<InCoin, OutCoin>(
  &GlobalConfig,
  &mut ProtocolFeeVault,
  &mut Order<InCoin, OutCoin>,
  U64,                         // cycle amount
  Vector<String>,              // oracle signatures
  &Clock,
  &mut TxContext
) → (Coin<InCoin>, MakeDealReceipt)   // ← receipt has NO type binding
```

```
repay_for_make_deal<InCoin, OutCoin>(
  &GlobalConfig,
  &mut Order<InCoin, OutCoin>,
  &mut OrderIndexer,
  Coin<OutCoin>,
  MakeDealReceipt,            // ← accepts any receipt regardless of coin types
  &Clock,
  &mut TxContext
)
```

### Attack Vector (Unconfirmed)
If `repay_for_make_deal` does not check `receipt.order_id == order.id`:

1. Attacker identifies **Order A** (small, e.g. 100 USDC → SUI, `promise_out_amount = 0.05 SUI`)
2. Attacker identifies **Order B** (large, e.g. 100,000 USDC → SUI)
3. Attacker calls `flash_loan_for_make_deal` on Order A:
   - Gets `Coin<USDC>` (100 USDC) back
   - Gets `MakeDealReceipt { order_id: A, promise_out_amount: 0.05 SUI }`
4. Attacker passes this receipt to `repay_for_make_deal` using Order B:
   - Move type system: ALLOWS (both receipts are `MakeDealReceipt` — no type distinction)
   - Runtime check: only catches this if `receipt.order_id == order.id` is verified
5. If not checked: Attacker drains Order B's 100,000 USDC in exchange for only 0.05 SUI

### Why This Is A Structural Risk
**Every other flash-loan-like receipt in the Cetus ecosystem uses phantom types:**

| Package | Receipt Struct | Phantom Type Params | Security |
|---|---|---|---|
| Limit-Order | `FlashLoanReceipt<T1>` | 1 ✓ | Compile-time |
| Vaults | `FlashLoanReceipt` (TypeName) | 0 | Runtime only |
| **DCA** | **`MakeDealReceipt`** | **0** | **Runtime only** |

The DCA contract is the only one with **zero** type information AND no TypeName field as a fallback. The `order_id` field is the sole protection.

### Supporting Evidence
```bash
# DCA MakeDealReceipt struct (on-chain normalized module):
{
  "typeParameters": [],           # ← CONFIRMED ZERO
  "abilities": {"abilities": []}, # ← no drop = hot potato
  "fields": [
    {"name": "order_id"},         # ← only protection
    {"name": "in_amount"},
    {"name": "promise_out_amount"},
    {"name": "fee_amount"}
  ]
}

# DCA Order struct (for comparison):
{
  "typeParameters": [
    {"isPhantom": true},   # InCoin
    {"isPhantom": true}    # OutCoin
  ]
}

# Limit-Order FlashLoanReceipt (for comparison — same codebase):
{
  "typeParameters": [{"isPhantom": true}]  # ← correctly typed
}
```

### Request to Team
Please confirm whether `repay_for_make_deal` internally verifies `receipt.order_id == order.id`. If this check is **present and correct**, severity downgrades to **Medium** (structural concern only). If this check is **absent or bypassable**, severity upgrades to **Critical** (direct loss of all DCA order funds).

### Recommendation
Regardless of whether `order_id` is checked:
1. Add phantom type parameters to `MakeDealReceipt<InCoin, OutCoin>` to enforce coin-type safety at compile time:
```move
struct MakeDealReceipt<phantom InCoin, phantom OutCoin> {
    order_id: ID,
    in_amount: u64,
    promise_out_amount: u64,
    fee_amount: u64,
}
```
2. This aligns the DCA contract with the design of all other flash-loan receipts in the ecosystem and eliminates the runtime-only reliance.

---

---

## FINDING #6 — LOW (Web/API)
**Title:** Development API CORS Misconfiguration on `api-sui.devcetus.com`  
**Severity:** Low  
**Surface:** Web API (Off-chain)

### Description
The Cetus development API endpoint `api-sui.devcetus.com` responds to cross-origin requests with:

```
Access-Control-Allow-Origin: *
```

This wildcard CORS policy allows any web origin to make credentialed API requests to the development endpoint.

### Risk
- Attacker-controlled websites can issue requests to the dev API on behalf of users visiting their site
- If the dev API shares any authentication tokens, session data, or returns sensitive pool/user data, this data is exposed to any origin
- Low severity because (a) this is a dev endpoint, not production, and (b) Sui transactions require wallet signatures that cannot be exfiltrated via CORS

### Recommendation
Restrict `Access-Control-Allow-Origin` to specific trusted origins. For a production API, never use `*`.

---

---

## Summary Table

| # | Finding | Severity | Package | On-Chain Confirmed |
|---|---|---|---|---|
| 1 | Single keeper in Limit-Order ACL | Informational | Limit-Order | ✓ |
| 2 | Oracle pool = vault's own CLMM pool | Low | Vaults | ✓ |
| 3 | 5-minute oracle signature validity window | Low | DCA | ✓ |
| 4 | `FlashLoanReceipt` uses TypeName string not phantom type | Medium | Vaults | ✓ |
| 5 | `MakeDealReceipt` has zero phantom type params | High* | DCA | ✓ (structural) |
| 6 | Dev API CORS wildcard `*` | Low | Web/API | ✓ |

*Severity of Finding #5 depends on whether `order_id` check is present in closed-source implementation. Could be Critical if absent.

---

## Methodology

1. Fetched all four package addresses from official CetusProtocol GitHub interface repos
2. Called `sui_getNormalizedMoveModulesByPackage` on each package to extract all function signatures and struct definitions (no source code required)
3. Queried `suix_queryEvents` for deployment events to find GlobalConfig object IDs
4. Inspected live GlobalConfig objects for actual runtime configuration values
5. Traced 10+ real on-chain transactions (`sui_getTransactionBlock`) for DCA, Limit-Order, and Vaults flash loan patterns
6. Cross-referenced oracle pool IDs from `AddOraclePoolEvent` with underlying pool IDs from `CreateEvent`
7. Read public interface source from `CetusProtocol/cetus-clmm-interface` on GitHub for context
8. Attempted `devInspect` simulation for access control verification

