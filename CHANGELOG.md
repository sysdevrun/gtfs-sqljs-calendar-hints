# Changelog

## Upcoming release

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
