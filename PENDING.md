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

---

## 2. Winner rank me detail bhejna ("Pair of K", "Trail of A", etc.)

**File:** `helper/utils.js` → `getHandRankName` / `resolvePlayerHand`, `controller/v1/gameplay.controller.js` → `roundWinner` payload (`rank` per player, `winnerRank`)

**Point:** Abhi `rank` me sirf naam jaata hai ("Pair", "Trail", "Sequence"...). Evaluator ke result me detail pehle se hai (`pairValue`/`kicker`, `high`) par naam me nahi judti. Chahiye:

| Rank | Label |
|---|---|
| Trail | Trail of K |
| Pure Sequence | Pure Sequence A-K-Q |
| Sequence | Sequence 7-8-9 |
| Color | Color K high |
| Pair | Pair of Q |
| High Card | High Card A |

**Dhyaan:**
- `rank` field Unity client parse karta hai, use mat badlo. **Naya field** (jaise `rankLabel`) add karo, purana `rank` waisa hi rahe.
- Value → letter mapping chahiye (14→A, 13→K, 12→Q, 11→J). A-2-3 sequence ka `high` 13.5 hai, use alag se handle karna.
- Zhandu/flipper me joker se bana hand hi label me aayega (jaise 7-8-9 ki jagah 8-9-10), `usedCards` se match karega.

**Status:** Pending (2026-10-07 ko note kiya)
