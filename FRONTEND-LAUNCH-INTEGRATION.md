# Teen Patti — Game Launch Integration Guide (Frontend)

Ye document batata hai ki apni website se Teen Patti game kaise launch karna hai.
Do hi step hain: **launch API call karo → jo `gameUrl` mile use iframe me kholo.**

---

## 1. Flow

```
  User "Play" dabata hai
          │
          ▼
  Aapka BACKEND  ──POST /api/v1/user/launch──►  Teen Patti server
          │                                            │
          │  ◄──────── { success, gameUrl } ───────────┘
          ▼
  Frontend gameUrl ko <iframe> me kholta hai
          │
          ▼
  Game khud socket se connect karta hai (token gameUrl me hai)
```

Game apna socket connection **khud** banata hai. Frontend ko socket, token, ya
game se koi communication handle nahi karni — bas iframe kholna hai.

---

## 2. ⚠️ Sabse pehle: launch API **backend se** call karo, browser se nahi

Is API pe **koi authentication nahi** hai aur `amount` request me jaata hai — wahi
user ke game coins ban jaata hai.

Agar aap ise browser se (fetch/axios) call karoge, to koi bhi DevTools kholke
`amount: 99999999` bhej dega aur real paise ke game coins bana lega.

**Sahi tarika:**

```
Browser  ──►  Aapka backend  ──►  Teen Patti launch API
              (yahan user verify karo,
               balance check karo,
               amount KHUD decide karo)
```

Browser se aane wale `amount` par kabhi bharosa mat karo.

---

## 3. API Reference

### Endpoint

```
POST  http://1.6.98.141:9073/api/v1/user/launch
Content-Type: application/json
```

> Production URL abhi confirm hona baaki hai — Section 9 dekho.

### Request body

| Field | Type | Required | Description |
|---|---|---|---|
| `userId` | string | ✅ | Aapke system ka user id. Ek user ka ek hi active session ho sakta hai. |
| `userName` | string | ✅ | Game table pe dikhne wala naam |
| `amount` | number | ✅ | Reserve balance. **Positive hona chahiye.** Yahi user ke game coins ban jaate hain. |
| `currency` | string | ❌ | jaise `"INR"` |
| `callbackUrl` | string (URL) | ❌ | Abhi ignore hota hai (server apni env wali value use karta hai) |
| `signature` | string | ❌ | Abhi optional. Aage chal ke **required** hoga — Section 9 dekho. |

```json
{
  "userId": "user_12345",
  "userName": "Rahul",
  "amount": 5000,
  "currency": "INR"
}
```

### Responses

**200 — Success**
```json
{
  "success": true,
  "gameUrl": "https://<game-host>/public/Web/index.html?token=eyJhbGciOiJIUzI1NiJ9..."
}
```

**409 — Us user ka session pehle se khula hai**
```json
{ "success": false, "message": "Session already active for this user." }
```

**400 — Validation fail**
```json
{ "success": false, "message": "amount must be a positive number" }
```

### `gameUrl` ke baare me

- Ye **poora ready URL** hai, token already isme laga hua hai
- Ise **modify mat karo** — token hatao mat, extra params jodne se pehle poochho
- Ye **har launch pe naya** milta hai. Cache mat karo, har baar API call karo
- Ye ek **session** hai — user ka balance is session ke saath juda hua hai

---

## 4. Game ko iframe me kholna

```html
<iframe
  src="<gameUrl yahan>"
  allow="fullscreen; autoplay"
  allowfullscreen
  style="width:100%; height:100%; border:0; display:block;">
</iframe>
```

### Zaroori rules — inme se koi bhi miss hua to game nahi chalega

| Rule | Kyun |
|---|---|
| iframe ko **explicit height** do | Sirf `height:100%` kaafi nahi. Parent container ki height fix na ho to browser iframe ko default **150px** de deta hai aur game dabba ban jaata hai. |
| `sandbox` attribute **mat lagao** | Lagana hi hai to `allow-scripts allow-same-origin` dono zaroori hain, warna WebAssembly chalega hi nahi aur game blank aayega. |
| `allow="fullscreen; autoplay"` | Iske bina fullscreen button kaam nahi karega. |
| URL **https** hona chahiye | Aapki site https hai. Agar `gameUrl` http hua to browser poori iframe **block** kar dega — game bilkul nahi khulega. |
| Token iframe ke `src` me hi rahe | Game apna token apne hi URL se padhta hai. Parent page ke URL me daloge to use milega hi nahi. |

### Height ka sahi tarika

```css
/* Full screen game */
.game-wrapper { position: fixed; inset: 0; }
.game-wrapper iframe { width: 100%; height: 100%; border: 0; }
```

```css
/* Page ke andar fixed box me */
.game-wrapper { width: 100%; height: 90vh; }   /* height ZAROORI hai */
.game-wrapper iframe { width: 100%; height: 100%; border: 0; }
```

---

## 5. Complete Example

### Backend (Node / Express) — proxy endpoint

```js
// Aapka apna endpoint, jise frontend call karega
app.post("/api/play/teenpatti", requireLogin, async (req, res) => {
  const user = req.user;                    // aapka logged-in user

  // amount SERVER pe decide karo — frontend se aaya amount kabhi use mat karo
  const amount = Math.min(user.balance, 5000);
  if (amount <= 0) return res.status(400).json({ message: "Insufficient balance" });

  try {
    const { data } = await axios.post(
      "http://1.6.98.141:9073/api/v1/user/launch",
      {
        userId:   String(user.id),
        userName: user.name,
        amount:   amount,
        currency: "INR",
      },
      { timeout: 10000 }
    );

    return res.json({ gameUrl: data.gameUrl });

  } catch (err) {
    const status = err.response?.status;

    if (status === 409) {
      // Us user ka session pehle se khula hai (shayad doosre tab me)
      return res.status(409).json({ message: "Game pehle se khula hai. Pehle use band karo." });
    }
    return res.status(502).json({ message: "Game abhi available nahi hai." });
  }
});
```

### Frontend (React)

```jsx
function TeenPattiGame() {
  const [gameUrl, setGameUrl] = useState(null);
  const [error, setError]     = useState(null);
  const [loading, setLoading] = useState(false);

  const launch = async () => {
    setLoading(true); setError(null);
    try {
      const res  = await fetch("/api/play/teenpatti", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      setGameUrl(data.gameUrl);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  if (error)   return <div className="error">{error} <button onClick={launch}>Retry</button></div>;
  if (loading) return <div>Game load ho raha hai…</div>;
  if (!gameUrl) return <button onClick={launch}>Play Teen Patti</button>;

  return (
    // height ZAROORI hai — warna iframe 150px ka ho jayega
    <div style={{ position: "fixed", inset: 0 }}>
      <iframe
        src={gameUrl}
        allow="fullscreen; autoplay"
        allowFullScreen
        style={{ width: "100%", height: "100%", border: 0, display: "block" }}
        title="Teen Patti"
      />
    </div>
  );
}
```

### Frontend (vanilla JS)

```js
document.getElementById("playBtn").addEventListener("click", async () => {
  const res  = await fetch("/api/play/teenpatti", { method: "POST" });
  const data = await res.json();
  if (!res.ok) return alert(data.message);

  const wrap = document.getElementById("gameWrapper");
  wrap.style.cssText = "position:fixed;inset:0;";
  wrap.innerHTML =
    '<iframe src="' + data.gameUrl + '" allow="fullscreen; autoplay" allowfullscreen ' +
    'style="width:100%;height:100%;border:0;display:block"></iframe>';
});
```

---

## 6. Behaviour — kya expect karna hai

| Situation | Kya hota hai |
|---|---|
| Pehli baar load | Build ~82 MB download hoti hai. Pehli baar 20–60 sec lag sakta hai. Loading bar game khud dikhata hai. |
| Dobara load | Browser cache se aata hai, bahut fast. |
| User page refresh karta hai | Game reconnect kar leta hai aur wahi match wapas jud jaata hai. Naya launch call karne ki zaroorat nahi — **wahi `gameUrl` phir se use kar sakte ho**. |
| Net cut ke wapas aata hai | Game khud reconnect karta hai (5 attempts). |
| User iframe band kar deta hai | Session server-side khula rehta hai. Balance server-to-server callback se wapas settle hota hai — frontend ka koi kaam nahi. |

### Mobile

- Game khud detect karke full-screen ho jaata hai
- **Sound tabhi bajegi jab user iframe ke ANDAR tap karega** — ye browser ki policy
  hai, parent page ka click iframe me count nahi hota. Game me "Tap to Play"
  screen isiliye hai.
- Landscape recommended hai

---

## 7. Errors kaise handle karo

| Status | Matlab | Frontend kya kare |
|---|---|---|
| `409` | User ka session pehle se khula hai | "Game pehle se khula hai" dikhao. Doosre tab me chal raha hoga. |
| `400` | Payload galat | `message` padho — aksar `amount` positive nahi hota |
| `502` / timeout | Game server down | "Game abhi available nahi hai, thodi der baad try karo" |

**Retry karte waqt dhyan do:** launch fail hone pe blindly loop mat karo. 409 pe
retry karne se kabhi success nahi milega — user ko pehle purana session band karna hoga.

---

## 8. Testing Checklist

- [ ] Launch API **backend se** call ho rahi hai, browser se nahi
- [ ] `amount` server pe decide ho raha hai, frontend se nahi aa raha
- [ ] iframe ko **height mil rahi hai** (DevTools me inspect karke dekho — 150px to nahi?)
- [ ] `gameUrl` **https** se shuru ho raha hai
- [ ] `sandbox` attribute nahi laga hua
- [ ] Asli mobile phone pe test kiya (desktop ka mobile-emulator kaafi nahi)
- [ ] Page refresh karke dekha — game wapas usi match me jud raha hai
- [ ] Usi user ka dobara launch → 409 aata hai aur message theek dikhta hai
- [ ] Adblocker ON karke test kiya — game phir bhi connect ho raha hai

---

## 9. Abhi Pending — integration se pehle backend team se confirm karo

Ye cheezein abhi finalize nahi hui hain. Integration shuru kar sakte ho (request/response
ka shape nahi badlega), par live jaane se pehle confirm zaroor karna:

1. **Launch API abhi har request pe `400 "Launch rejected by operator."` deti hai.**
   Backend me operator-callback wala hissa abhi disabled hai. Backend team ise
   enable karegi tab response 200 aana shuru hoga. **Integration test karne se pehle
   unse confirm kar lo ki fix ho gaya.**

2. **Production URLs final nahi hain.**
   - Launch API abhi `http://1.6.98.141:9073` pe hai — ye **http** hai. Aapki site
     https hogi, to server-to-server call to chal jayegi, par final permanent
     https domain confirm kar lena.
   - `gameUrl` abhi ek **temporary cloudflare tunnel** se banta hai jo kabhi bhi
     band ho sakta hai. Permanent game domain aana baaki hai.

3. **`signature` field.** Abhi optional hai. Aage security ke liye required hoga —
   tab har request me HMAC signature bhejna padega. Secret aur formula backend team
   degi. Aaj integrate karte waqt is field ko bhejne ki zaroorat nahi.

4. **Parent ↔ Game messaging abhi nahi hai.** Game `postMessage` se parent ko kuch
   nahi bhejta. Matlab abhi frontend ko ye pata nahi chalega ki user ne game me
   "exit" dabaya ya uska balance kitna bacha. Agar aapko "Close Game" button chahiye
   to wo parent page pe apna banao (bas iframe hata do). Zaroorat ho to backend team
   se bolo, wo add kar sakte hain.
