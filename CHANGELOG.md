# Changelog

## 0.1.0

Première publication de `gtfs-sqljs-calendar-hints`.

- `findCalendarPeriods(gtfs, hints, options)` : détection de périodes de
  service par hints (`match-all` / `per-day-of-week`), matching strictement
  exact, passe finale per-day-of-week, synthèse des périodes fusionnées par
  signature, mismatches structurés (2 jours concrets + distribution des
  signatures).
- Deux modes d'égalité : `trip-ids` et `trip-content` (dédoublonnage des
  horaires dupliqués sous des trip_id différents) — tous deux exacts.
- Options `firstDay`/`lastDay` pour restreindre la plage analysée.
- Zéro dépendance ; typage structurel `GtfsCalendarSource` (5 méthodes
  `getXXXX` de gtfs-sqljs, aucune requête SQL brute).
