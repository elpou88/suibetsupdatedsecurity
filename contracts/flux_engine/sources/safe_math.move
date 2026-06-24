/// OZ-inspired safe arithmetic module for SuiBets — flux_engine package.
///
/// Implements checked operations equivalent to OpenZeppelin's SafeMath / Math
/// libraries, ported to pure Move so no external MVR dependency is needed.
///
/// Philosophy (mirrors OZ):
///   • Every operation that can silently overflow/underflow instead ABORTS
///     with a descriptive error code — making failures visible and auditable.
///   • mul_div uses u128 intermediate precision to prevent overflow during
///     the multiplication step, matching OZ Math.mulDiv behaviour.
///   • safe_cast_u64 makes u128→u64 truncation an explicit, guarded step.
///
/// These functions are PURE (no side effects, no state) — safe to call from
/// any settlement or financial calculation in the contract.
module flux_engine::safe_math {

    // ── Error codes ──────────────────────────────────────────────────────────
    // Range 9000–9099 reserved for safe_math across all SuiBets packages.

    const EOverflow:     u64 = 9000;
    const EUnderflow:    u64 = 9001;
    const EDivByZero:    u64 = 9002;
    const ECastOverflow: u64 = 9003;

    /// Upper bound for u64 values used in overflow guard assertions.
    const U64_MAX: u128 = 18_446_744_073_709_551_615;

    // ── Checked addition ─────────────────────────────────────────────────────

    /// Checked addition of two u64 values.
    /// Aborts with EOverflow if a + b exceeds u64::MAX.
    /// Equivalent to OZ SafeMath.add.
    public fun safe_add(a: u64, b: u64): u64 {
        let sum = (a as u128) + (b as u128);
        assert!(sum <= U64_MAX, EOverflow);
        (sum as u64)
    }

    /// Checked addition of three u64 values.
    /// Aborts with EOverflow if a + b + c exceeds u64::MAX.
    public fun safe_add3(a: u64, b: u64, c: u64): u64 {
        let sum = (a as u128) + (b as u128) + (c as u128);
        assert!(sum <= U64_MAX, EOverflow);
        (sum as u64)
    }

    // ── Checked subtraction ──────────────────────────────────────────────────

    /// Checked subtraction — aborts with EUnderflow if a < b.
    /// Equivalent to OZ SafeMath.sub.
    public fun safe_sub(a: u64, b: u64): u64 {
        assert!(a >= b, EUnderflow);
        a - b
    }

    /// Saturating subtraction — returns 0 instead of aborting when a < b.
    /// Equivalent to OZ Math.saturatingSub.
    public fun saturating_sub(a: u64, b: u64): u64 {
        if (a >= b) { a - b } else { 0u64 }
    }

    // ── Multiply-then-divide ─────────────────────────────────────────────────

    /// Multiply a × b then divide by den, using u128 intermediate precision.
    /// Aborts with EDivByZero  if den == 0.
    /// Aborts with ECastOverflow if the result exceeds u64::MAX.
    /// Equivalent to OZ Math.mulDiv — the primary safe fee/odds calculation helper.
    public fun mul_div(a: u64, b: u64, den: u64): u64 {
        assert!(den > 0, EDivByZero);
        let result = ((a as u128) * (b as u128)) / (den as u128);
        assert!(result <= U64_MAX, ECastOverflow);
        (result as u64)
    }

    // ── Safe cast ────────────────────────────────────────────────────────────

    /// Safe cast from u128 to u64.
    /// Aborts with ECastOverflow if value exceeds u64::MAX.
    /// Makes every u128→u64 truncation in financial code an explicit guarded step.
    public fun safe_cast_u64(v: u128): u64 {
        assert!(v <= U64_MAX, ECastOverflow);
        (v as u64)
    }

    // ── Checked division ─────────────────────────────────────────────────────

    /// Checked u64 division — aborts with EDivByZero if b == 0.
    public fun safe_div(a: u64, b: u64): u64 {
        assert!(b > 0, EDivByZero);
        a / b
    }

    /// Checked u128 division — aborts with EDivByZero if b == 0.
    public fun safe_div_128(a: u128, b: u128): u128 {
        assert!(b > 0, EDivByZero);
        a / b
    }
}
