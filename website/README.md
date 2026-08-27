# Site de démo — gtfs-calendar-hints

Application React (Vite) pour tester la librairie `src/calendar-hints.ts`
directement dans le navigateur :

- **gtfs-sqljs** charge le GTFS dans un Web Worker (sql.js/WASM, via Comlink) ;
- **react-gtfs-selector** permet de choisir un GTFS (fichier, URL, recherche
  transport.data.gouv.fr / Mobility Database) ;
- les téléchargements passent par le **proxy CORS**
  `https://gtfs-proxy.sys-dev-run.re/proxy/…` ;
- des **boutons 1-clic** chargent les réseaux de référence : Car Jaune,
  Kar'Ouest, Citalis, Estival, CarSud, Astuce (Rouen) ;
- les hints (jours fériés France/Réunion, vacances scolaires des académies
  Réunion et Normandie via l'API `data.education.gouv.fr`, avec repli sur
  `data/school-calendar.json`) sont générés automatiquement, puis
  `findCalendarPeriods` est exécuté et les périodes affichées (synthèse,
  calendrier, détail des hints, jours non classés) ;
- le **calendrier est peint par type de jour** : chaque signature
  (`result.days[].signature`, deux jours égaux ⇔ exactement les mêmes courses)
  reçoit une couleur et un motif stables, jours non classés compris — ceux-là
  se distinguent par un liseré pointillé. Une légende récapitule les types
  (jours, courses, part non classée) ;
- la liste des hints est **configurable** : réordonnancement (l'ordre compte,
  chaque hint consomme ses jours), activation/désactivation, renommage, choix
  de la politique (`match-all` / `per-day-of-week`) et ajout de hints
  personnalisés avec des dates ou plages (`2026-02-10..2026-02-14`).

## Développement

```bash
cd website
npm install
npm run dev      # copie les .wasm de sql.js dans public/ puis lance Vite
npm run build    # tsc + vite build → dist/
```

## Déploiement

`.github/workflows/deploy.yml` construit le site et le déploie sur GitHub
Pages (source « GitHub Actions », activée automatiquement par
`actions/configure-pages`) à chaque push sur `main`, ou manuellement via
*workflow_dispatch* depuis n'importe quelle branche.
