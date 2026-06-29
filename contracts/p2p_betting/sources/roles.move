/// SuiBets Role Definitions — OpenZeppelin AccessControl Integration
///
/// Roles are plain Move structs with `drop`. The OZ AccessControl registry
/// (openzeppelin_access::access_control) is the sole authority that mints
/// &Auth<Role> proofs. Only current role holders can obtain a proof per PTB,
/// so the compiler enforces authorization — zero boilerplate in business logic.
///
/// Migration path from legacy Capability objects:
///   OLD: public fun settle_bet(_oracle_cap: &OracleCap, ...)
///   NEW: public fun settle_bet(_auth: &Auth<OracleRole>, ...)
///
/// The registry also provides timelocked admin transfer so control can never
/// be transferred instantly — eliminating the "lost AdminCap = game over" risk.
///
/// ── Security model ───────────────────────────────────────────────────────────
///
///   OracleRole   — most sensitive. Controls all bet settlement across every
///                  engine (P2P, WARP, FLUX, PULSE). Revocable instantly if
///                  a key is compromised — critical for live platform safety.
///
///   AdminRole    — governs global config: fees, min_stake, pause toggle.
///                  Timelocked transfer ensures no hostile admin takeover.
///
///   TreasuryRole — required alongside AdminRole for fee-vault withdrawals.
///                  Enforces the existing 2-of-2 multi-sig pattern as typed
///                  roles rather than manual OracleCap counter-signature.
///
module p2p_betting::roles {

    /// Settlement oracle role.
    ///
    /// Holder can queue, finalize, void, and instantly settle bets across all
    /// SuiBets engines. This is the highest-privilege operational role —
    /// immediate revocability via OZ AccessControl is the primary security gain.
    public struct OracleRole has drop {}

    /// Platform administrator role.
    ///
    /// Holder can update config (fees, min_stake, dispute window), toggle pause,
    /// and mint new oracle credentials. Timelocked transfer prevents instant
    /// hostile takeover if the admin key is compromised.
    public struct AdminRole has drop {}

    /// Treasury co-signer role.
    ///
    /// Required alongside AdminRole to authorize fee-vault withdrawals.
    /// Enforces the 2-of-2 multi-sig pattern (previously: AdminCap + OracleCap
    /// counter-sign) as a pair of typed OZ roles — auditable and revocable.
    public struct TreasuryRole has drop {}
}
