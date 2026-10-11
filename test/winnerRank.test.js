// Winner rank label test — `node test/winnerRank.test.js`
// Part A: bina DB ke, har rank + har variant pe `getHandRankLabel` check (jo `rank`/`winnerRank` me jaata hai).
// Part B: `--db` flag ke saath matchHistory ke asli matches pe winner ka label recompute karke
//         check ki winner ka hand kisi bache hue player se haarta to nahi (muflis me ulta).
require("dotenv").config()
const u = require("../helper/utils")

let pass = 0, fail = 0
const ok = (cond, msg, extra = "") => { if (cond) { pass++ } else { fail++; console.log("  ❌", msg, extra) } }
const eq = (got, want, msg) => ok(got === want, msg, `=> got "${got}", want "${want}"`)

// cardId se card object: "QS" -> { cardId, cardValue: 12, suit: "Spades" }
const V = { A: 14, K: 13, Q: 12, J: 11, T: 10 }
const S = { S: "Spades", H: "Hearts", D: "Diamonds", C: "Clubs" }
const c = (id) => ({ cardId: id, cardValue: V[id[0]] ?? Number(id[0]), suit: S[id[1]] })
const H = (...ids) => ids.map(c)

// zhandu/flipper board: jokerCards[] jaisa match me hota hai
const board = (values, openedCount = values.length, fixedLast = false) => ({
    jokerCards: values.map((v, i) => ({ card: { cardId: `${v}X`, cardValue: v, suit: "Spades" }, opened: i < openedCount, isFixed: fixedLast && i === values.length - 1 }))
})
const ctx = (gameType, m = {}, pd = {}) => ({
    gameType,
    jokerValue: m?.jokerCard?.cardValue,
    jokerValues: u.getApplicableJokerValues(m, pd),
})

console.log("== Part A: unit — label per rank / variant ==")

// 1) Teen Patti — saare 6 rank
const tp = ctx("teenpatti")
eq(u.getHandRankLabel(H("KS", "KH", "KD"), tp), "Trail of K", "TP trail")
eq(u.getHandRankLabel(H("AS", "KS", "QS"), tp), "Pure Sequence Q-K-A", "TP pure seq top")
eq(u.getHandRankLabel(H("AS", "2S", "3S"), tp), "Pure Sequence A-2-3", "TP pure seq A-2-3")
eq(u.getHandRankLabel(H("7S", "8H", "9D"), tp), "Sequence 7-8-9", "TP seq")
eq(u.getHandRankLabel(H("AS", "2H", "3D"), tp), "Sequence A-2-3", "TP seq A-2-3")
eq(u.getHandRankLabel(H("KS", "9S", "4S"), tp), "Color K high", "TP color")
eq(u.getHandRankLabel(H("QS", "QH", "4D"), tp), "Pair of Q", "TP pair")
eq(u.getHandRankLabel(H("AS", "9H", "4D"), tp), "High Card A", "TP high card")
eq(u.getHandRankLabel(H("2S", "2H", "2D"), tp), "Trail of 2", "TP trail of 2 (number)")
eq(u.getHandRankLabel(H("TS", "TH", "3D"), tp), "Pair of 10", "TP pair of 10")
eq(u.getHandRankLabel([], tp), null, "TP empty -> null")
eq(u.getHandRankLabel(undefined, tp), null, "TP undefined -> null")

// 2) Label ka naam evaluator ke naam se hamesha match kare (rank name = label prefix)
for (const hand of [H("KS", "KH", "KD"), H("AS", "KS", "QS"), H("7S", "8H", "9D"), H("KS", "9S", "4S"), H("QS", "QH", "4D"), H("AS", "9H", "4D")]) {
    const name = u.getHandRankName(hand, tp), label = u.getHandRankLabel(hand, tp)
    ok(label.startsWith(name), "label prefix == rank name", `${label} / ${name}`)
}

// 3) Muflis — label hand ka hi hota hai (sirf jeet ulti hoti hai)
const mf = ctx("muflis")
eq(u.getHandRankLabel(H("5S", "3H", "2D"), mf), "High Card 5", "muflis best hand label")
eq(u.getHandRankLabel(H("KS", "KH", "KD"), mf), "Trail of K", "muflis worst hand label")
{
    const r = u.pickPotWinners([{ id: "lo", cards: H("5S", "3H", "2D") }, { id: "hi", cards: H("KS", "KH", "KD") }], "muflis")
    ok(r.winners.length === 1 && r.winners[0] === "lo", "muflis: lowest hand jeete", JSON.stringify(r))
}

// 4) Joker variant — ek wild card (jokerCard.cardValue)
const jk = ctx("joker", { jokerCard: { cardValue: 5 } })
eq(u.getHandRankLabel(H("QS", "QH", "5D"), jk), "Trail of Q", "joker: pair + wild -> trail")
eq(u.getHandRankLabel(H("7S", "8H", "5D"), jk), "Sequence 7-8-9", "joker: wild seq fill")
eq(u.getHandRankLabel(H("AS", "9H", "4D"), jk), "High Card A", "joker: no wild in hand")

// 5) Zhandu — progressive jokers + all-in freeze
{
    const m = board([4, 7, 9], 3)                      // teeno khule
    const normal = { isAllIn: false }
    const frozen = { isAllIn: true, appliedJokers: 1 } // sirf J1 (4) laga
    eq(u.getHandRankLabel(H("7S", "QS", "7H"), ctx("zhandu", m, normal)), "Trail of Q", "zhandu: 7 wild x2 -> trail Q")
    eq(u.getHandRankLabel(H("7S", "QS", "7H"), ctx("zhandu", m, frozen)), "Pair of 7", "zhandu all-in: 7 wild NAHI (frozen J1 only)")
    eq(u.getHandRankLabel(H("4S", "QS", "QH"), ctx("zhandu", m, frozen)), "Trail of Q", "zhandu all-in: J1 (4) laga")
    const m1 = board([4, 7, 9], 1)                     // sirf J1 khula
    eq(u.getHandRankLabel(H("7S", "QS", "7H"), ctx("zhandu", m1, normal)), "Pair of 7", "zhandu round1: 7 abhi joker nahi")
    const m0 = board([4, 7, 9], 0)
    eq(u.getHandRankLabel(H("4S", "9S", "KS"), ctx("zhandu", m0, normal)), "Color K high", "zhandu: koi joker nahi khula")
}

// 6) Flipper — 4 wild (3 variable + 1 fixed), sab khule
{
    const m = board([4, 7, 9, 14], 4, true)
    const f = ctx("flipper", m, {})
    ok(f.jokerValues.length === 4, "flipper: 4 wild", JSON.stringify(f.jokerValues))
    eq(u.getHandRankLabel(H("7S", "QS", "7H"), f), "Trail of Q", "flipper: kal wala winner (rolex) -> Trail of Q")
    eq(u.getHandRankLabel(H("4D", "7C", "9H"), f), "Trail of A", "flipper: teeno wild -> Trail of A")
    eq(u.getHandRankLabel(H("2S", "3H", "6D"), f), "High Card 6", "flipper: no wild in hand")
}

// 7) Winner selection vs label — jo jeeta uska label kisi haare hue se chhota rank na ho
{
    const RANK = { "Trail": 6, "Pure Sequence": 5, "Sequence": 4, "Color": 3, "Pair": 2, "High Card": 1 }
    const rankOf = (label) => RANK[Object.keys(RANK).find(k => label.startsWith(k))]
    const hands = { a: H("QS", "QH", "4D"), b: H("7S", "8H", "9D"), c: H("AS", "9H", "4D"), d: H("KS", "9S", "4S") }
    const r = u.pickPotWinners(Object.entries(hands).map(([id, cards]) => ({ id, cards })), "teenpatti")
    eq(r.winners[0], "b", "TP: sequence jeete pair/color/high se")
    const wl = u.getHandRankLabel(hands[r.winners[0]], tp)
    for (const id of Object.keys(hands)) if (!r.winners.includes(id)) ok(rankOf(wl) >= rankOf(u.getHandRankLabel(hands[id], tp)), "winner label rank >= loser", id)
    eq(r.handName, u.getHandRankName(hands.b, tp), "pickPotWinners.handName == getHandRankName")
}

// 8) compareResult (side show path) — jiska label bada, wahi winner
{
    const p1 = { playerId: "p1", cards: H("QS", "QH", "4D") }, p2 = { playerId: "p2", cards: H("AS", "9H", "4D") }
    const r = u.compareResult(p1, p2, { gameType: "teenpatti" })
    eq(r?.winner ?? r, "p1", "compareResult: Pair of Q > High Card A")
}

console.log(`Part A: ${pass} pass, ${fail} fail`)

// ---------------------------------------------------------------------------
// Part B: asli matchHistory pe (read-only). `node test/winnerRank.test.js --db [N]`
const runDb = async () => {
    const N = Number(process.argv[3] || 200)
    const mongoose = require("mongoose")
    await mongoose.connect(process.env.MONGO_CONNECT_URL, { serverSelectionTimeoutMS: 15000 })
    const col = mongoose.connection.db.collection("matchhistories")
    const docs = await col.find({ winner: { $ne: null }, "playersData.0": { $exists: true } }).sort({ createdAt: -1 }).limit(N).toArray()
    console.log(`\n== Part B: matchHistory ke ${docs.length} matches ==`)
    let checked = 0, p0 = pass, f0 = fail
    const byType = {}
    for (const m of docs) {
        const exit = (m.exitPlayers || []).map(String)
        const pds = (m.playersData || []).filter(pd => pd?.cards?.length)
        const w = pds.find(pd => String(pd.playerId) === String(m.winner))
        if (!w) continue
        const label = u.getHandRankLabel(w.cards, ctx(m.gameType, m, w))
        ok(typeof label === "string" && label.length > 0, `match ${m._id}: winner label khali`, m.gameType)
        byType[m.gameType] = (byType[m.gameType] || 0) + 1

        // Showdown jaisa check: jo players pack nahi hue / exit nahi hue, unme winner best hona chahiye.
        const alive = pds.filter(pd => !pd.isPacked && !exit.includes(String(pd.playerId)))
        if (alive.length >= 2 && alive.some(pd => String(pd.playerId) === String(w.playerId))) {
            const entries = alive.map(pd => ({ id: String(pd.playerId), cards: pd.cards, jokerValues: u.getApplicableJokerValues(m, pd) }))
            const r = u.pickPotWinners(entries, m.gameType)
            // Side pots (zhandu all-in) me main winner overall best na bhi ho sakta -> sirf tab strict jab pots nahi hain.
            if (!(m.pots?.length > 1)) ok(r.winners.includes(String(w.playerId)), `match ${m._id} (${m.gameType}): winner hand best nahi`, `label="${label}" best=${r.winners.join(",")}`)
            checked++
        }
    }
    console.log(`Part B: ${checked} showdown-type matches cross-checked, by type: ${JSON.stringify(byType)} -> ${pass - p0} pass, ${fail - f0} fail`)
    await mongoose.disconnect()
}

;(async () => {
    if (process.argv.includes("--db")) await runDb().catch(e => { fail++; console.log("  ❌ DB part error =>", e.message) })
    console.log(`\nTOTAL: ${pass} pass, ${fail} fail`)
    process.exit(fail ? 1 : 0)
})()
