# CLAUDE.md

Librairie npm `gtfs-sqljs-calendar-hints` : détection de périodes de service
dans un calendrier GTFS à partir de hints fournis par l'appelant, matching
strictement exact (aucun seuil). **Zéro dépendance runtime — ne pas en
ajouter.**

## Structure

- `src/calendar-hints.ts` — tout le paquet npm (`src/index.ts` ne fait que
  ré-exporter). Deux points d'entrée : `createCalendarAnalyzer` (charge le
  feed une fois ; `analyze(hints)` est un calcul pur en mémoire) et
  `findCalendarPeriods` (délègue à l'analyzer). Typage structurel
  `GtfsCalendarSource` (4 méthodes `getXXXX` en vrac de gtfs-sqljs ≥ 0.9.0,
  plus `getFeedInfo`/`getFrequencies` optionnelles) ; fast-path SQL optionnel
  quand la source expose `db` (option `fastPath`, repli automatique sur la
  voie portable).
- `tests/` — vitest sur stub déclaratif (`tests/helpers/stub-source.ts`) +
  tests d'intégration contre le vrai gtfs-sqljs (fixtures CSV zippées en
  mémoire). Couverture attendue : 100 % sur `src/`.
- `examples/` — runners CLI et implémentation d'exploration en lecture CSV
  directe (hors paquet npm ; `date-holidays` etc. sont des devDependencies).
- `website/` — démo React/Vite, paquet séparé (son propre `package.json`),
  déployée sur GitHub Pages par `.github/workflows/deploy.yml` à chaque push
  sur `main`.

## Commandes

```bash
npm test              # vitest
npm run test:coverage
npm run lint          # eslint src
npm run typecheck     # tsc --noEmit
npm run build         # tsup → dist/ (ESM + .d.ts)
```

## Conventions

- README en français ; CHANGELOG en anglais, avec une section
  `## Upcoming release` en tête alimentée au fil des PRs.
- Travail par PR depuis une branche ; CI (`ci.yml`, Node 20/22/24 : lint,
  typecheck, test, build) verte avant merge dans `main`.
- L'API est générique (`H extends Hint`) : les hints peuvent porter des
  attributs personnalisés, préservés **par référence** dans les résultats —
  ne jamais copier/cloner les hints dans la librairie.
- Les signatures exportées sont épinglées par des golden values dans les
  tests : tout changement du hash ou du format de signature est un breaking
  change délibéré, pas un détail d'implémentation.

## Process de release

1. Partir d'un `main` à jour et propre, CI verte.
2. `npm version X.Y.Z --no-git-tag-version` (met à jour `package.json` et
   `package-lock.json`, sans tag ni commit).
3. `CHANGELOG.md` : déplacer le contenu de `## Upcoming release` dans une
   nouvelle section `## X.Y.Z` (laisser `## Upcoming release` vide en tête).
   Vérifier avec `git log vPRÉCÉDENT..main` que chaque changement visible par
   l'utilisateur a son entrée — les PRs qui ont oublié le changelog se
   rattrapent ici.
4. `npm run lint && npm run typecheck && npm test && npm run build`.
5. Commit `Release X.Y.Z` directement sur `main` (c'est la convention du
   dépôt pour les releases), push.
6. `gh release create vX.Y.Z --title vX.Y.Z --notes '…'` — notes = résumé
   des entrées du changelog + lien vers `CHANGELOG.md`. La publication de la
   release GitHub déclenche `.github/workflows/publish.yml` : vérification
   que la version de `package.json` == tag, lint/typecheck/build/test, puis
   `npm publish` via OIDC (aucun token npm à gérer).
7. Vérifier que le workflow Publish est vert et que la version est en ligne :
   `npm view gtfs-sqljs-calendar-hints version`.
