/// DEPRECATED — replaced by the official OpenZeppelin Math library for Sui.
///
/// SuiBets now uses: openzeppelin_math = { r.mvr = "@openzeppelin/math" }
/// Drop-in usage:    use openzeppelin_math::math as oz_math;
///                   oz_math::mul_div(a, b, denominator)
///
/// This stub is kept so existing build references compile during the transition.
module p2p_betting::safe_math {}
