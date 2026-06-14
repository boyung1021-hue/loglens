# LogLens — Project Story

> **"Detect deployment log drift before it becomes downtime."**
> LogLens detects how your logs changed (drift) after a deploy, and warns you before it turns into an outage.

---

## 💡 Inspiration

Every engineer who has ever hit the deploy button knows _that_ five minutes.

> _"I just shipped… did something just break?"_

The problem was that none of our tools actually answered that question.
Log platforms like ELK, Datadog Logs, and CloudWatch are great at answering **"what logs do I have?"**
But that's not what an engineer really wants to know right after a deploy.

> **"After this deploy, what _changed_?"**

Existing tools let you _search_ logs, but they don't automatically compare the **drift** between before and after a deploy.
So engineers end up digging through dashboards by hand, eyeballing error-rate graphs, and manually hunting for new error patterns.
Then a user complaint comes in, and 30 minutes later you finally find the cause — by which point the downtime has already happened.

That led us to the core insight:

> **LogLens is not a log management platform. It is a _Deployment Drift Detection Platform_.**

Deploy frequency has exploded to dozens of times a day, yet failure detection is still manual.
And this is exactly the moment when LLMs make it cheap to cluster log patterns and summarize them in natural language.
Add the idea of _not storing raw logs at all_ — keeping only **patterns + statistics** — and the cost drops dramatically too.
It felt like the right time to build it.

---

## 🔭 What it does

LogLens analyzes how logs change, using the **deploy** itself as the unit of analysis.

| Question | Existing tools | LogLens |
|----------|----------------|---------|
| "What logs do I have?" | ✅ | ❌ (not the goal) |
| "What changed after this deploy?" | ❌ | ✅ |
| "Are there new error patterns?" | Manual | ✅ Automatic |
| "Did error rate / latency get worse than before?" | Manual | ✅ Automatic |
| "Should I roll this deploy back?" | Gut feeling | ✅ Data-driven |

**Before LogLens** → deploy → complaints 5 min later → eyeball graphs → guess _"is it this deploy?"_ → roll back 30 min later → _downtime already happened_.

**After LogLens** → deploy → automatic before/after log-pattern comparison → 2 min later: _"drift detected: 3 new error patterns, error rate 4% → 18%"_ → read the AI summary → roll back immediately → **stopped before it became an outage.**

---

## 🛠️ How we built it

### One app, full stack

For hackathon speed, we built the whole stack as a **single Next.js 15 app** with no separate backend server.

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 15 (App Router, React Server Components) |
| Backend | Next.js Route Handlers (`app/api/*`) |
| Database | AWS Aurora PostgreSQL (local Docker PG for dev) |
| AI | OpenAI API (`gpt-4o-mini`) |
| Language | TypeScript (everywhere) |

### The key architectural decision: never store raw logs

This is the decision that fundamentally separates LogLens from every other log tool.
Raw logs are processed **only in server function memory**, and only **aggregated results** are persisted to the DB.

```
raw log lines (exist only in memory)
   ├─ 1. Parse: extract level, timestamp, message
   ├─ 2. Normalize: "User 12345 failed in 320ms" → "User <NUM> failed in <NUM>ms"
   ├─ 3. Hash the pattern: normalize → fingerprint(hash)
   ├─ 4. Aggregate: count, error flag, level distribution per fingerprint
   └─ 5. Store: log_patterns(upsert) + pattern_stats   ⚠️ raw lines are dropped
```

As a result, DB size scales with the **number of unique patterns, not the volume of logs**.

| Scenario | If storing raw | LogLens (patterns) |
|----------|----------------|--------------------|
| 1M log lines per deploy | ~several GB | ~500 unique patterns → tens of KB |
| 100 deploys | hundreds of GB | shared pattern dictionary → a few MB |

### The drift engine — separating deterministic computation from AI interpretation

This was the design principle we cared about most.

> **The drift score and the change list are _always_ computed by deterministic rules. The AI is just an "interpretation/summary" layer on top.**

Because of this, the demo never stalls even if OpenAI goes down — the drift results are already in hand.

We compare per-pattern statistics from before (baseline) and after (current) the deploy to find four kinds of drift:

- **NEW** — absent in baseline, present in current (very dangerous if it's a new error)
- **DISAPPEARED** — a normal log vanished (suspected feature outage)
- **SPIKE** — a shared pattern's frequency surges (error surge = strong danger signal)
- **DROP** — a shared pattern's frequency collapses (suspected throughput drop)

### The drift score formula

We weight each drift category and sum them into a score \\( 0 \le \text{score} \le 100 \\).
**Error-related changes get the heaviest weights.**

$$
S = \min\!\Big(100,\;\; 25\,n_{\text{newErr}} + 5\,n_{\text{newInfo}} + 20\,n_{\text{spikeErr}} + 8\,n_{\text{gone}} + 100 \cdot \max(0,\, \Delta r)\Big)
$$

where

- \\( n_{\text{newErr}} \\) : number of new **error** patterns (the strongest signal)
- \\( n_{\text{newInfo}} \\) : number of new non-error patterns
- \\( n_{\text{spikeErr}} \\) : number of spiking error patterns
- \\( n_{\text{gone}} \\) : number of disappeared normal patterns
- \\( \Delta r = r_{\text{after}} - r_{\text{before}} \\) : rise in error rate (e.g. a rise of \\( 0.14 \\) → \\( +14 \\) points)

The score maps to a severity:

$$
\text{severity} =
\begin{cases}
\texttt{critical}, & S \ge 60 \\
\texttt{warning}, & 25 \le S < 60 \\
\texttt{safe}, & S < 25
\end{cases}
$$

The demo's problem deploy lands at _2 new errors_ \\((2 \times 25)\\) _+ spiking error_ \\((20)\\) _+ disappeared_ \\((8)\\) _+ error-rate rise_ \\((\approx 14)\\) \\(\approx \mathbf{72}\\) points → **CRITICAL**.

### Log normalization (templating)

Drift accuracy depends on normalization quality. We replace variable values with tokens so that "logs with the same meaning" collapse into one pattern.

```ts
const RULES: [RegExp, string][] = [
  [/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}\S*/g, "<TS>"],   // timestamp
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-.../gi,             "<UUID>"], // UUID
  [/\b\d+\.\d+\.\d+\.\d+\b/g,                     "<IP>"],   // IP
  [/\/[\w\-./]+/g,                                "<PATH>"], // path
  [/\b\d+ms\b/g,                                  "<NUM>ms"],// duration
  [/\b\d+\b/g,                                    "<NUM>"],  // numbers / IDs
];

// input:  User 12345 login failed from 10.0.3.2 in 320ms
// output: User <NUM> login failed from <IP> in <NUM>ms
```

### AI summary

The deterministically computed drift result is handed to OpenAI to turn into a **human-readable natural-language report + rollback recommendation**.

```json
{
  "summary": "After this deploy the payment module threw a new NullPointerException 142 times, and DB timeout logs surged 70x versus before. Overall error rate rose from 4% to 18%.",
  "keyChanges": [
    "New error: NullPointerException at <PATH> (142 occurrences)",
    "Spike: DB timeout after <NUM>ms (3 → 210, 70x)",
    "Disappeared: 'Cache warmed' logs gone (suspected cache init failure)"
  ],
  "recommendation": "Roll back immediately. New errors on the payment path plus a 4.5x error-rate rise have high user impact."
}
```

---

## 🎓 What we learned

- **Separating deterministic logic from the AI makes the system robust.** The single principle "even if the AI dies, the core signal is always produced" solved demo stability and debugging difficulty at the same time. The AI turned out to be the layer that _dresses up_, not the layer that _decides_.
- **"What you choose _not_ to store" is your product identity.** The decision to throw away raw logs satisfied cost, privacy, and a "drift-first" design all at once — and ultimately defined what LogLens is.
- **Normalization drives the product's accuracy.** Drift comes from pattern comparison, and patterns come from normalization quality. The simplest-looking regex line was the most bug-prone place.
- **Walking Skeleton is the way.** Pushing the entire flow end to end first (deploy → ingest → analyze → report), however ugly, and layering polish on top worked best for a hackathon.
- **Demo stability comes from data, not code.** Not depending on live generation during the talk, but preparing reproducible seed data, was the biggest risk hedge.

---

## 🧗 Challenges we faced

- **Normalization quality ↔ drift accuracy.** Too aggressive a regex collapses different logs into one pattern and loses signal; too loose, and the same log splits across many patterns and noise explodes. We iteratively tuned the rules and thresholds (`SPIKE_RATIO=3`, `MIN_COUNT=5`) against the seed data and locked them down with unit tests.
- **The problem deploy must land as CRITICAL, _reliably_.** If the score weights were slightly off, an obvious outage would stay at `warning`. We tuned the weights against the demo data so that \\( S \approx 72 \\) comes out stably.
- **OpenAI latency / failure.** A flaky network risked stalling the whole demo. → We added a rule-based **fallback summary** and an offline stub flag, so that the drift score, change list, and recommendation always appear even without the AI.
- **Local ↔ Aurora environment differences.** We unified on PostgreSQL for both and made it a one-line `DATABASE_URL` swap, so we could iterate fast on local Docker PG and only point at the cloud right before the demo.
- **Serverless cold starts / connections.** Aurora connections can bottleneck inside Vercel serverless functions, so we only accept ingest in batches to minimize call count.
- **Scope creep.** Our biggest enemy was the temptation to add features. We put real-time streaming, multi-tenancy, RBAC, and auto-rollback on an explicit _do not build_ list and defended only the P0 set.

---

## 🚀 What's next

- Real-time streaming ingest (currently batch)
- Pattern embeddings + vector similarity for smarter grouping
- Multi-service / multi-environment comparison, alert routing
- Auto-rollback triggers (today it only recommends; a human executes)

> After hitting deploy, engineers no longer dig through dashboards.
> LogLens speaks first: _"this deploy is safe,"_ or _"here are the 3 things that changed."_
>
> **_Detect deployment log drift before it becomes downtime._**
