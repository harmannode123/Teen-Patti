# Pending Work

Is file me wo cheezein likhi hain jo abhi baaki hain / baad me karni hain.

---

## 1. `placeBet` — raise functionality baad me hatani hai

**File:** `controller/v1/gameplay.controller.js` → `placeBetCore` / `placeBet`

**Point:** Abhi placeBet me agar amount aa raha hai to jitna amount aa raha hai user usse **zyada bhi laga sakta hai** (raise wali functionality ki wajah se). Ye raise functionality baad me **hatani hai** — user ko sirf jitna required amount hai utna hi lagana chahiye, usse zyada nahi.

**Related code:**
- `let { amount, isPacked, isRaisebet } = data;` — raise flag input me aata hai
- `amount = isRaisebet ? Number(currentBet) * 2 : Number(currentBet)` — `isRaisebet` true hone par bet double (zyada) ho jaata hai
- `...(!matchData?.raise && isRaisebet ? { raise: true } : {})` — match par raise flag set hota hai

**Status:** Pending (baad me hatana hai)
