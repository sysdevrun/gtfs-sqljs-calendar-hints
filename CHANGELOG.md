# Changelog

## Upcoming release

- Demo: period labels now group the per-day-of-week entries of a hint and
  condense consecutive weekdays into a range, e.g. « Vacances scolaires
  (lun-sam) : du lundi au samedi + samedis » instead of one « … — lundis »
  entry per weekday. Applies to the period cards and the calendar legend.

- Demo: new « Sous le capot » section under the results with two collapsible,
  syntax-highlighted (Prism) snippets: the exact `findCalendarPeriods` call of
  the current analysis — real hints and options included — as a runnable
  TypeScript program, and the raw JSON result it returned, pretty-printed
  with primitive arrays and small objects folded onto single lines. Both come
  with a copy button.

- Demo: the built-in school-vacation hint now covers Monday to Saturday
  instead of Monday to Friday, and is renamed « Vacances scolaires
  (lun-sam) ». Saturdays inside a vacation period therefore get their own
  per-day-of-week group, matching what the calendar grid already
  highlighted (every vacation day except Sundays).

- Demo: the calendar grid now underlines school-vacation days (Sundays
  excluded) and marks public holidays with an asterisk next to the day
  number; both are also spelled out in each day's tooltip.

- Demo & examples: fix the school-vacation date rules derived from the
  `fr-en-calendrier-scolaire` dataset. Its timestamps are Paris-midnight
  instants serialized in UTC (`2026-10-09T22:00:00+00:00`); they are now
  resolved to the official Paris calendar date (never the local DOM timezone,
  which would shift the day in the Antilles) instead of being truncated as
  UTC. The published start date is the departure day (classes end that
  evening): vacation now starts the next day — except when departure falls on
  a Wednesday or Saturday, which counts as vacation (no class that day for
  most students). The published end date is the return-to-school morning:
  vacation ends the day before, as previously. This removes one wrongly
  counted school day at the start of weekday-departure vacations (e.g. La
  Réunion, mardi 16 mars 2027) and of the Pont de l'Ascension.
- Demo & examples: new option (`includeWedSatStart`, default `true`; a
  selector in the web UI) to instead treat a Wednesday/Saturday departure day
  as a school day, with vacation starting the next day.
- Demo: French public holidays now come from the `date-holidays` package
  (already used by the examples) instead of a hand-rolled computus list. The
  module is dynamically imported so its all-countries dataset (~230 kB
  gzipped) is fetched on first analysis rather than on page load. The npm
  package itself remains dependency-free.

## 0.3.0

- **Breaking: `GtfsCalendarSource` now targets gtfs-sqljs ≥ 0.9.0.**
  `getCalendarByServiceId(id)` and `getActiveServiceIds(date)` are no longer
  used; the interface instead requires the bulk readers `getCalendars()` and
  `getCalendarDates()` (no-arg). Service activation (weekday bit within
  `[start_date, end_date]`, then type-1 adds / type-2 removes) is computed in
  memory from those two tables — identical results, while the one-call-per-day
  and two-calls-per-service round-trips (several hundred on a year-long feed)
  collapse into two bulk reads. On Astuce (369 days), `trip-ids` drops from
  109 ms to 45 ms with the fast path and from 143 ms to 74 ms on the portable
  path; `trip-content` from 529 ms to 330 ms (fast) and 3.3 s to 2.3 s
  (portable).
- **`feed_info` clipping** (new option `useFeedInfo`, default `true`): when
  the source exposes `getFeedInfo()` (gtfs-sqljs ≥ 0.9.0) and the feed
  declares `feed_start_date`/`feed_end_date`, the analysed range is clipped
  to that validity window — the spec-blessed fix for hollow feed tails that
  previously required manual `firstDay`/`lastDay`. `useFeedInfo: false`
  restores the previous behaviour.
- **Frequency-aware `trip-content` signatures**: when the source exposes
  `getFrequencies()` (gtfs-sqljs ≥ 0.9.0), a trip's frequency rows
  (`start_time`, `end_time`, `headway_secs`, `exact_times`, order-insensitive)
  are part of its content, so two trips serving the same stops on different
  headways no longer merge. Trips without frequencies keep the exact same
  signatures as before.
- Engines: Node ≥ 20 (aligned with gtfs-sqljs 0.9.0; Node 18 is EOL).
- Internal: the `bench/` scripts import `hints-france` from `examples/` again
  (broken path since the runners moved), and the demo website is bumped to
  gtfs-sqljs ^0.9.0 (it type-checks the library sources directly).

## 0.2.0

- Reusable analyzer: `createCalendarAnalyzer(gtfs, options)` loads the feed
  once and returns a `CalendarAnalyzer` whose `analyze(hints)` is pure
  in-memory computation, so trying several hint sets costs milliseconds
  instead of re-reading trips and stop_times every time. `findCalendarPeriods`
  now delegates to it (identical results).
- Optional raw-SQL fast path (`fastPath` option, default true): when the
  source exposes a gtfs-sqljs adapter database on `db` (as `GtfsSqlJs`
  instances do), a few read-only SQL queries replace the row-by-row `getXXXX`
  calls with identical results — ~×6 on Astuce (Rouen). Any failure falls
  back to the portable path; `fastPath: false` forces the portable path.
- Custom hint attributes. `findCalendarPeriods` and `CalendarAnalyzer.analyze`
  are now generic (`H extends Hint`): hints may carry arbitrary extra
  attributes, preserved by reference in the results (no copies) and typed all
  the way through.
  `MatchedGroup` gains `hint` — the originating hint object (the synthetic
  'Remaining days' hint for leftover groups) — and `Period` gains `hints` —
  the distinct contributing hints, in hint order, synthetic leftover hint
  excluded. Backward compatible (`H` defaults to `Hint`); callers should not
  mutate a hint after the call if they want a stable result.

## 0.1.1

- Expand the test suite from 6 to 40 tests. New declarative stub helper (`tests/helpers/stub-source.ts`) builds a `GtfsCalendarSource` from a compact feed description; suites now cover the `per-day-of-week` policy (weekday grouping, partial matches, Monday→Sunday order), hint ordering and cascading (consumed days → `ignoredDays`, failed hints consume nothing), non-canonical hint days (duplicates, unsorted, out of range), days with zero trips (network closed), services present in `calendar.txt` without any trip, dates-only feeds (no `calendar.txt`), both error paths, mismatch message truncation beyond 6 signatures, the exact merge boundaries of `trip-content` mode (different route, direction, `null ≠ 0`, null times, stop_times delivery order, trips without stop_times), and a global invariant: periods ∪ unclassified partition the analysed days exactly and deterministically.
- Pin the signature format with golden values (`weekdayOf` convention, empty-day `0t:` signature, one `trip-ids` and one `trip-content` value) so a refactor of the hash cannot silently change exported signatures.
- Add integration tests against the real gtfs-sqljs: CSV fixtures in `tests/fixtures/` are zipped in memory (fflate) and loaded through `GtfsSqlJs.fromZipData` with the sql.js adapter. The base feed asserts deep-equality with the in-memory stub in both signature modes (any gtfs-sqljs API drift breaks it); the field-quirks feed concentrates real-world traps — no `calendar.txt`, BOM on every file, alphabetical column order (Pysae exports), service ids with spaces, closed weekend, identical schedules duplicated under different trip ids.
- Add code coverage: `@vitest/coverage-v8`, `npm run test:coverage`, scoped to `src/` — currently 100% statements/branches/functions/lines.

## 0.1.0

First release of `gtfs-sqljs-calendar-hints`.

- `findCalendarPeriods(gtfs, hints, options)`: service-period detection from
  user-provided hints (`match-all` / `per-day-of-week`), strictly exact
  matching, final per-day-of-week pass, synthesis of periods merged by
  signature, structured mismatches (2 concrete differing days + signature
  distribution).
- Two equality modes: `trip-ids` and `trip-content` (dedupes identical
  schedules duplicated under different trip_ids) — both exact.
- `firstDay`/`lastDay` options to clip the analysed range.
- Zero dependencies; structural `GtfsCalendarSource` typing (5 gtfs-sqljs
  `getXXXX` methods, no raw SQL).
