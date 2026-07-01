Read clubfm-scheduler-phase-one-spec.md at the repo root. Write a concise CLAUDE.md (~40–60 lines) capturing only what changes how you build:

- one-line purpose and the three-component architecture
- the stack and repo layout from §3
- the non-negotiable invariants:
  1. Introspect RadioDJ's live schema and probe its REST command set —
     never hardcode column names or an assumed command list.
  2. Inject into RadioDJ only by song ID via the REST plugin — never m3u or file paths.
  3. station_id on every table.
  4. All RadioDJ contact goes through the Runner; the web app never connects to RadioDJ directly.
  5. M0 is a gate: the §4c spike must pass on the real rig before any work proceeds past it.

Reference the spec for detail instead of duplicating it. Do not put the build plan or a task checklist in CLAUDE.md.
