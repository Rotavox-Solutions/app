# Reconciliation as an ordered ladder of rulesets — design thread, uncommitted

**2026-08-04.** Recovered verbatim from session `9831b76a` (Aug 3, 17:26Z → 02:57Z), which
ended mid-turn on a live question. Nothing here is built. `PERFECT-HOUR.md` still describes
the old two-rung model, and the engine still has the three subtractive mechanisms below.

This supersedes the framing in `sheets/2026-08-03-hour-shape.md` §"Two defects found on the
way", item 1. PD direction 17:26Z: *"fix the trim floor first... id rather us write this
logic now rather than settle for a weak solution to the issue of how to proceed about slot
subtraction."* The narrow floor fix is subsumed by the general model.

## What the generator does today

Three subtractive mechanisms, only one priority-aware:

1. `sacrificed` (`generate.ts:173`) — pre-flight, priority-ordered, **flat** (the defect
   verified in `c03bfa1`).
2. `trimmed` (`generate.ts:228`) — *"once a position's projected start reaches the clock's
   length, drop it and everything after it."* Purely positional. Carries its own note:
   `(A future trim priority would reorder which positions survive here.)`
3. Physical shear at playout, outside the engine.

**The floor defect is the smaller half.** The runaway path (2) ignores priority entirely and
takes whatever is at the tail — the exact failure the subtractive-priority work exists to end.

## The model

A **trim policy** is an *ordered ladder of rulesets*. Given a deficit, try rung 1; take what
it permits; if uncovered, fall to rung 2, which relaxes something; continue until covered or
the ladder ends. **Rungs compose** — later rungs continue from what earlier rungs removed,
they do not restart.

A **ruleset** is a constrained search over removable (or addable) positions:

| axis | values |
|---|---|
| **set** | which categories are eligible at all |
| **order** | priority sequence within the set |
| **traversal** | *depth-first* (exhaust G1990's allowance, then G2000) vs *breadth-first* (one from each in priority order, then round again) — depth concentrates the loss, breadth spreads it |
| **direction** | `from-end`, `from-start`, `preserve-spread` (see below) |
| **scope** | window of the hour (`:30–:60`) or position range |
| **proportional cap** | block if `trims_from_cat / authored_plays_of_cat_this_hour > threshold` |
| **absolute floor** | never trim a category with `<= n` positions authored this hour |

One ruleset shape serves **both directions** — addition and subtraction are the same object.

### Three points established

**The proportional cap subsumes the singleton case.** At any threshold < 1.0 a
one-position category is blocked automatically (1/1 = 100%). ES's lone G2010 is protected by
the proportional rule alone. The absolute floor is not redundant — it is the stronger rule
for "even 1 of 4 is too much here," e.g. keeping HD's three golds from going to one.

**The deficit is time, not a count.** "Number of trims" resolves to *milliseconds to
recover*; each candidate contributes its estimated duration; stop when covered. Traversal
decides *which* positions; the stopping condition is temporal.

**Every ladder terminates in something that cannot fail.** Otherwise the hour overruns and
the shear happens at playout — unreviewable, taking the tail regardless of policy.

### `preserve-spread` — direction is not a binary

- **Subtract from middle** is real for this format: `IMAGING` states DN's breaks fall every
  4, and 15 music slots need internal breaks at 4/8/12. Trimming from the end can close the
  hour on a seven-song run; trimming from the middle keeps both sweeps balanced.
- **Add to middle** the format already asserts — van der Corput placement exists so
  activated filler lands mid-hour rather than stacked at :50.
- **Quarter-hour protection**: middle trims keep the top-of-hour quarter intact.

So: `from-end` protects the early hour, `from-start` protects the close, and
`preserve-spread` — drop the instance whose removal leaves survivors most evenly
distributed — is the principled default for a spread-authored clock. Computable as the
inverse of the placement function.

## The outer loop replaces in-line evaluation

I first argued for in-line subtraction (decide at each position against time actually
accumulated). PD pushback 19:43Z was correct: in-line collapses a pecking order into a
linear one — you can only rank what you have not yet reached — breeding an exception tangle.

The fix is not a return to up-front estimates. It is the control structure the PD already
proposed for the F case: **reschedule the hour.**

```
plan  →  build  →  measure exactly  →  in tolerance?  →  done
                          ↑                   ↓ no
                          └──── revise plan ──┘   (bounded attempts)
                                                  then escalate, then shear
```

Every pass after the first has *exact* durations from the previous pass, so the estimator's
±2.7 min sampling error stops mattering, and the plan stays global so pecking order applies
to the whole hour. In-line was a workaround for estimate error; the outer loop dissolves it.

It also unifies: the F-underschedule escalation and the overrun path become **the same loop
with different terminals**.

Two caveats: re-running changes song picks (seeded RNG + separation state), so passes can
oscillate — bounded attempts plus **keep-the-best-pass-seen** makes that safe. And this
replaces logic that currently works, so it does not ship without `dry-run-log` proving it
against live durations.

## Both terminals, and the principle that justifies them

**Overrun** terminates in the tail shear. PD 19:43Z: the shear is *not a fallback, it is a
legal constraint* — the ID must air in its window, and an hour that refuses to shear is a
compliance failure, not a format failure. The shear is the one rung that may violate every
other rule, and every rung above it exists only to make the shear land where the PD chose.

**Underrun** is the catastrophic direction, and a proportional cap on F creates it. PD's
escalation ladder, made explicit:

1. Reschedule (bounded attempts)
2. Prompt PD, relax in a **PD-ordered** sequence — more F / floor on F length / admit an
   additional category alongside F
3. Permit random selection
4. Abort → PD chooses a one-off clock swap for the hour, or exits to adjust clocks/schedule

> **The terminal rung always sacrifices format integrity to protect broadcast integrity.**
> Overrun terminates in a shear that breaks the clock to protect the legal ID; underrun
> terminates in a fill that breaks rotation to protect against dead air.

That sentence belongs in `PERFECT-HOUR.md` — it justifies both terminals in one line.

**Flag on the record:** "floor on F average length" re-admits duration-aware selection,
which was nixed as a standing mechanism because it biases turnover with no musical
justification. It is legitimate *here* — a supervised, last-resort relaxation the PD approves
for one hour, not a selection rule. Recorded as a deliberate re-admission with that boundary
stated, so it cannot quietly migrate into the default path.

## Scoping now, recursion deferred

PD floated rulesets applying to *segments within an hour* rather than the whole hour.
Scope-as-filter on a flat ladder already expresses most of it: "never trim before :15" is a
rung whose scope excludes it; "prefer late, but early if you must" is a late-scoped rung
followed by an unscoped one.

True recursion — a rung whose action is *run this sub-ladder over this segment* — is
strictly more general but introduces **deficit apportionment**: if the hour is 2 minutes over
and a sub-ladder owns `:30–:60`, how much of those 2 minutes must that segment recover?
Proportional to its length? To its trimmable mass? All of it? Every answer is a different
product and none is obviously right without a PD asking for it.

Ship scope-as-filter; leave recursion a declared extension point. The ruleset shape does not
change when it is added — only the ladder's element type does.

## Addition, reviewed symmetrically

Same structure inverted. Today addition has an ordered set (`fillerPriority`) plus **one
hardcoded special case**: `fillerPriority === 1` always airs as the tail buffer. Under the
general model that stops being a special case and becomes a declared rung.

What addition lacks that the model gives it: **a proportional cap**. Nothing today prevents F
taking three slots in an hour. Capping F at a declared share turns *"if F is near-constant it
is no longer filler"* from a property measured after the fact into an **invariant the
generator enforces** — the real prize here.

## Four decisions — asked 17:28Z, still unanswered

1. **Policy scope.** Station-level default with per-clock override, or per-daypart? Decides
   schema; the difference between one policy and eleven.
2. **Terminal rung.** Unconditional tail cut, or accept overrun and warn while `carryMs`
   absorbs it? *(Effectively resolved by the 19:43Z legal-constraint framing — tail cut —
   but never stated as a decision.)*
3. **Proportional denominator across rungs.** Cap as a budget over the *whole ladder*
   (denominator = authored count, trims accumulate), or fresh per rung? I lean whole-ladder,
   or rung 2 silently undoes rung 1's protection.
4. **Direction default.** *(Superseded: `preserve-spread`, per above.)*

## Proposed build scope

**Now:** flat ordered ladder; scoped rulesets; all axes; one ruleset shape shared by both
directions; the reconciliation outer loop with bounded attempts and best-pass retention;
both terminals; the escalation/prompt protocol.

**Declared, not built:** recursion (blocked on apportionment); custom scripted templates
beyond the shipped set.

**Unchanged:** templates ship as a closed predefined list so our logic can reason about
them, per PD direction.

Sequence agreed: **spec into `PERFECT-HOUR.md` first, engine types second.**

---

# The open question — TOH drift and the definition of "a song length"

PD, 2026-08-04 02:53Z, reframing the whole fit problem. Answered only by one sentence before
the session ended. **This is where work resumes.**

## The reframe

The fit condition is satisfied when

```
len(hour) >= (60 - fit_tolerance)  &&  (len(hour) - 1 song) < (60 - fit_tolerance)
```

where `fit_tolerance` is a PD-specified maximum distance in ms that the next hour's TOH may
drift from :00 before correction is required.

The compliance claim: FCC rules permit TOH drift in **either** direction to any distance, so
long as the station enforces a policy that effectively minimizes it — for a music station,
"as close to the hour as feasible," i.e. no more than one song length either way; for a
station running spots at TOH, no more than one spot length. **A more permissive constraint
than previously assumed**, and easier to satisfy.

The proposal: define "a song length" in this context as *the 95% CI for the average length of
the marginal song in each hour which would, over Z hours, bring TOH within a desired maximum
distance from :00* — offered as potentially novel and patentable.

## What I got as far as saying

> "Confirming the reframe first, then pushing back on the statistic — because I think the
> underlying idea is right and the formula as specified would misbehave."

The pushback itself was never written. **Do not treat the simulation below as agreement with
the formula.**

## The simulation that ran but was never interpreted

Question posed: *does TOH drift accumulate, or is it reset each hour by the fit — and what
sets the width of the band it settles into?* Modelled on ES (worst case, 16 authored music
positions, natural 55.58 min), live durations, 200k hours per condition.

```
no correction (drift free-runs), |drift| in seconds:
  after 24h  6,636      after 168h  45,585      after 2000h  514,329

per-hour refit, |TOH drift| in seconds:
  marginal = F         (SD 21s), additive only   median 50s   p95 107s   max 514s
  marginal = F         (SD 21s), two-sided       median 49s   p95  94s   max 168s
  marginal = G1990     (SD 57s), two-sided       median 56s   p95 123s   max 263s
  marginal = Discovery (SD 28s), two-sided       median 47s   p95  93s   max 292s
```

F's enabled duration distribution, live (seconds, n=75): 169 … 273, i.e. **2:49 to 4:33**.

Readings that look supported but were never checked against the transcript reasoning:
per-hour refit does bound the drift rather than let it accumulate; the band it settles into
is roughly one marginal-song wide; two-sided correction mostly buys **tail control** (max
514s → 168s) rather than median. All of it needs re-derivation before use.

Recovered source of the simulation — the original scratchpad is gone with the session:

<details><summary><code>drift-sim.mjs</code></summary>

```js
// Does TOH drift accumulate, or is it reset each hour by the fit?
// And what sets the width of the band it settles into?
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { max: 1 });

const rows = await sql`
  select c.name cat, coalesce(s.effective_duration_ms, s.duration_ms) ms
  from categories c join song_categories sc on sc.category_id=c.id
  join songs s on s.id=sc.song_id and s.enabled
  where coalesce(s.effective_duration_ms,s.duration_ms) > 60000`;
await sql.end();

const pool = {};
for (const r of rows) (pool[r.cat] ??= []).push(Number(r.ms));
const draw = (c) => pool[c][Math.floor(Math.random() * pool[c].length)];

// ES, the worst case: 16 authored music positions, natural 55.58 min.
const ES = { A1:3, A2:3, B:2, C:1, N:2, R1:1, R2:1, R3:1, G2010:1, Discovery:1 };
const IMAGING_MS = 25_000;

/**
 * One hour under per-hour refit. Drift is carried in BOTH directions and the hour is
 * fitted to what remains, which is the control law we are actually testing.
 */
function hour(driftMs, marginal, twoSided) {
  let len = IMAGING_MS;
  for (const [cat, n] of Object.entries(ES)) for (let i = 0; i < n; i++) len += draw(cat);
  const target = 3_600_000 - driftMs;      // absorb prior drift into this hour's budget
  // additive: keep adding marginal units while it brings us closer
  while (Math.abs(len + draw(marginal) - target) < Math.abs(len - target)) len += draw(marginal);
  if (twoSided) {
    // subtractive: if still long, drop trim-eligible positions while it helps
    const trimmable = ["G2010", "R3", "Discovery"];
    for (const c of trimmable) {
      const d = draw(c);
      if (Math.abs(len - d - target) < Math.abs(len - target)) len -= d;
    }
  }
  return len - target;                     // residual = next hour's drift
}

function run(marginal, twoSided, N = 200_000) {
  let d = 0;
  const hist = [];
  for (let i = 0; i < N; i++) { d = hour(d, marginal, twoSided); hist.push(Math.abs(d)); }
  hist.sort((a, b) => a - b);
  return {
    p50: hist[Math.floor(N * 0.5)] / 1000,
    p95: hist[Math.floor(N * 0.95)] / 1000,
    max: hist[N - 1] / 1000,
  };
}

// Control: no refit at all -- drift free-runs (what "no correction" looks like).
function freeRun(N = 2000) {
  let d = 0; const walk = [];
  for (let i = 0; i < N; i++) {
    let len = IMAGING_MS;
    for (const [cat, n] of Object.entries(ES)) for (let i2 = 0; i2 < n; i2++) len += draw(cat);
    d += len - 3_600_000; walk.push(Math.abs(d));
  }
  return { after24h: walk[23] / 1000, after168h: walk[167] / 1000, after2000h: walk[1999] / 1000 };
}
```

Run it from the repo root (it needs `postgres` resolvable, so it will not run from a
scratchpad path): `set -a; . packages/schema/.env; set +a; node ./.drift-sim.mjs`

</details>

## Open, in order

1. Answer the 95% CI question — the pushback on the formula, and what `fit_tolerance` should
   actually be defined as.
2. Re-derive or discard the drift-sim readings above.
3. Decisions 1 and 3 from "Four decisions".
4. Write the model into `PERFECT-HOUR.md`, then engine types.
5. Then the F split (PD: *"fix the trim floor first, then we'll do the F split"*), and the
   rest of `sheets/2026-08-03-hour-shape.md` §"Open, in order".
