# LogLens — Demo Video Script (English)

> Target length: ~2 minutes. Narration + on-screen actions.
> Speak naturally — the lines below are a guide, not a teleprompter.

---

## 0. Before recording

```bash
# Run in demo mode (no DB needed — clean English sample data)
DATABASE_URL= pnpm dev
# Open: http://localhost:3000
```

- Zoom the browser to **125–150%** so text is readable on video.
- You should see a 🧪 **Demo mode** banner at the top — that's expected.
- Sample data: service `payment-api`, **4 deployments** (3 healthy + 1 latest CRITICAL).

---

## 1. Narration script (~2 min)

### ① Hook — the problem (0:00–0:20)
**Screen:** Home page (deployment list)

> "Right after you ship a deploy, your logs spike. But here's the hard part —
> is that a **new error your deploy just introduced**, or is it the same noise
> that was always there? Reading raw logs line by line doesn't scale.
> **LogLens** answers that automatically: it compares your log **patterns**
> before and after each deployment and tells you whether to roll back."

### ② The list — status at a glance (0:20–0:40)
**Screen:** Hover across the badges in the deployment list

> "This is the deploy timeline for a single service. Every deployment gets a
> **drift score** and a **severity** — like a traffic light. The three earlier
> deploys are all **SAFE**. But the most recent one scores **92** and it's
> flagged **CRITICAL**. Let's open it."

### ③ The detail — the payoff (0:40–1:30)
**Screen:** Click the CRITICAL deployment (`@a1b2c3d`) → detail page

> "Drift score: **92 out of 100**. Looking at the metrics, the **error rate
> jumped from 0% to 4%**, and the number of distinct log patterns grew from
> 5 to 8."

*(point to the AI Summary box)*

> "The **AI summary** turns that into plain language and gives a clear call:
> **consider an immediate rollback**. And this summary sits on top of a
> deterministic engine — so it still works **offline, with no AI key**."

*(scroll to the New patterns section)*

> "It also pinpoints *what* is dangerous. These **brand-new error patterns** —
> a NullPointerException, a DB timeout, a payment-gateway failure — are what
> drove the score up. Meanwhile a normal pattern that used to appear has
> **disappeared**, which can signal a broken feature."

### ④ Contrast — what healthy looks like (1:30–1:50)
**Screen:** Click "← Deployments", then open a **SAFE** deployment

> "For contrast, here's a healthy deploy: drift score **0** —
> *no significant drift, this looks like a healthy deployment*. When nothing
> changes, LogLens stays quiet. It only gets loud when it should."

### ⑤ Wrap-up — how it works + one-liner (1:50–2:10)
**Screen:** Back to the home page

> "Under the hood it's simple: LogLens **normalizes logs into patterns**,
> diffs **before vs. after** each deploy, classifies what's **new, spiking,
> dropping, or gone**, and scores it. It never stores raw logs, so it stays
> lightweight and safe. That's **LogLens — automating the rollback decision
> in about 30 seconds after every deploy.**"

---

## 2. Click-through checklist

| Step | Action | What to highlight on screen |
|------|--------|------------------------------|
| 1 | Home `http://localhost:3000` | 🧪 Demo mode banner, 4 deployments, badges (SAFE ×3 / CRITICAL ×1) |
| 2 | Click `payment-api @a1b2c3d` (CRITICAL) | **Drift score 92** |
| 3 | Top metrics row | Error rate **0% ▶ 4%**, Total logs, Patterns **5 ▶ 8** |
| 4 | AI Summary box | Summary + 💡 *Consider an immediate rollback…* |
| 5 | New patterns (NEW) | 3 errors (NPE / DB timeout / payment gateway) + 1 warn (retrying) |
| 6 | Disappeared section | Cache warmed (a healthy pattern that vanished) |
| 7 | "← Deployments" → open a SAFE deploy | **Drift score 0**, *healthy deployment* |

---

## 3. Short version (~60 seconds)

> "Right after a deploy, logs spike — but is that a *new* error you caused, or
> just noise? **LogLens** compares log **patterns** before and after every
> deployment and tells you whether to roll back.
>
> Here's a service's deploy timeline — three healthy ones, but the latest
> scores **92, CRITICAL**. Inside, the **error rate jumped 0% to 4%**, and the
> **AI summary recommends an immediate rollback**. It even names the culprits:
> brand-new error patterns like *NullPointerException* and *DB timeout*. A
> healthy deploy, by contrast, scores **0** and stays quiet.
>
> LogLens normalizes logs into patterns, diffs baseline vs. current, and
> automates the rollback call — in about 30 seconds after every deploy."

---

## 4. Talking points / Q&A backup

- **Why patterns, not raw logs?** Variable bits (IDs, timestamps, durations) are
  normalized to tokens, so "the same kind of log" collapses into one pattern.
  This kills noise and makes before/after comparable.
- **How is the score computed?** A deterministic, rule-based engine weights
  new error patterns and rising error rate most heavily (0–100). AI is only a
  human-readable summary layer on top.
- **What if the AI/API is down?** It falls back to a rule-based summary — the
  demo (and production) never breaks.
- **Privacy?** Raw log lines aren't stored; only normalized pattern stats.
- **Severity thresholds:** `safe` < 25 ≤ `warning` < 60 ≤ `critical`.
