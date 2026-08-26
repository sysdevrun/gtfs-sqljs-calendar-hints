# gtfs-sqljs-calendar-hints

Détecter les **périodes de service** d'un calendrier GTFS (« Lundi à vendredi
période scolaire », « Lundi à vendredi vacances et tous les samedis »,
« Dimanches et jours fériés »…) à partir de **hints** fournis par
l'utilisateur, avec un matching **strictement exact** : aucun seuil, aucun
« à peu près ». Si le GTFS ne colle pas au hint, le hint échoue et on explique
pourquoi avec des jours concrets.

```bash
npm install gtfs-sqljs-calendar-hints
```

Zéro dépendance ; conçu pour [gtfs-sqljs](https://www.npmjs.com/package/gtfs-sqljs)
(typage structurel : toute source implémentant 5 méthodes `getXXXX` convient).

## Démo en ligne

Le répertoire [`website/`](website/) contient un site React (Vite) qui fait
tourner la librairie dans le navigateur : sélection d'un GTFS
(react-gtfs-selector + proxy CORS SysDevRun), boutons 1-clic pour Car Jaune,
Kar'Ouest, Citalis, Estival, CarSud et Astuce (Rouen), génération automatique
des hints et visualisation des périodes détectées. Déployé sur GitHub Pages :
<https://sysdevrun.github.io/gtfs-sqljs-calendar-hints/>

## Entrées

- Un GTFS (répertoire de `.txt` dézippés).
- Une liste ordonnée de **hints**. Un hint a :
  - un **nom** (« Jours fériés », « Vacances scolaires »…) ;
  - une **liste de jours précis** (`2026-11-01`, `2026-11-11`, …) ;
  - une **policy** : `match-all` (tous les jours du hint doivent avoir
    exactement les mêmes trips) ou `per-day-of-week` (tous les lundis du hint
    identiques entre eux, tous les mardis entre eux, etc.).

## Algorithme

1. **Signature de chaque jour.** Pour chaque jour de la plage du feed, on
   calcule l'ensemble exact des trips qui circulent (via `calendar.txt` +
   `calendar_dates.txt`), réduit à une clé d'égalité, la *signature*. Deux
   jours ont la même signature ⇔ exactement la même offre.
2. **Plage du feed.** Bornes = min/max des `start_date`/`end_date` de
   `calendar.txt` et des dates ajoutées (type 1) de `calendar_dates.txt`.
   Les jours des hints hors plage sont ignorés (comptés dans le rapport).
3. **Itération sur les hints, dans l'ordre.** Pour chaque hint, on ne
   considère que ses jours encore présents dans la liste des jours restants :
   - `match-all` : une seule signature pour tous les jours → **matché**, les
     jours sont retirés de la liste. Sinon → **non matché**, aucun jour
     retiré, erreur citant au moins 2 jours différents (avec nombre de trips,
     services actifs, et le nombre de trips présents d'un côté seulement).
   - `per-day-of-week` : pour chaque jour de la semaine (lundi → dimanche),
     si tous les jours correspondants du hint partagent une signature →
     groupe matché et retiré ; sinon erreur pour ce jour de semaine. Le hint
     est « matché » si au moins un jour de semaine l'est.
4. **Passe finale.** Les jours restants passent dans un hint implicite
   `per-day-of-week` (« tous les lundis restants identiques ? », etc.).
5. **Synthèse.** Les groupes matchés qui partagent la même signature sont
   fusionnés en une seule *période* (ex. « Jours fériés + dimanches »).
   Les jours toujours non classés sont listés, groupés par signature.

**L'ordre des hints compte** : « Jours fériés » doit passer avant « Vacances
scolaires », sinon Noël ou le 1er janvier (fériés en plein milieu des
vacances) cassent le match-all des vacances.

## Deux modes d'égalité (tous deux exacts)

- `trip-ids` : signature = l'ensemble des `trip_id`. Le plus strict.
- `trip-content` : signature = l'ensemble des *contenus* de trips
  (route, direction, séquence d'arrêts + horaires), les `trip_id` étant
  ignorés. Indispensable pour les exports qui **dupliquent le même horaire
  sous des trip_id différents par période** (ex. Pysae/Car Jaune : le service
  « dimanche scolaire », « dimanche vacances » et « fériés » sont 3 services
  aux trip_id disjoints mais au contenu identique). Ce n'est **pas** un
  matching approché : l'égalité de contenu reste exacte à la minute près.

Sur Car Jaune, `trip-ids` classe 254/350 jours ; `trip-content` classe
350/350 et retrouve exactement les 3 périodes attendues.

## Librairie : `findCalendarPeriods` sur gtfs-sqljs (sans SQL brut)

`src/calendar-hints.ts` implémente l'algorithme au-dessus d'une instance
[gtfs-sqljs](https://www.npmjs.com/package/gtfs-sqljs), **uniquement via les
méthodes `getXXXX`** — aucune requête SQL brute. Le paramètre est typé
structurellement (`GtfsCalendarSource`) : cinq méthodes suffisent, donc un
stub de test fonctionne aussi.

La librairie n'a **aucune dépendance** : les jours fériés et les vacances
scolaires sont fournis par l'appelant, sous forme de listes de dates ISO dans
les `days` des hints. Voir « Générer les jours des hints » ci-dessous pour
les sources recommandées, et `examples/hints-france.ts` pour un générateur
d'exemple (utilisé par les runners de ce dépôt).

| Besoin de l'algorithme | Méthode gtfs-sqljs |
| --- | --- |
| Tous les trips + route/direction/service | `getTrips()` sans filtre (1 appel) |
| Bornes du feed | `getCalendarByServiceId(id)` + `getCalendarDates(id)` par service (dates de début/fin + exceptions type 1) |
| Services actifs par jour | `getActiveServiceIds('YYYYMMDD')` (1 appel/jour — la lib implémente déjà toute la logique calendar + calendar_dates) |
| Contenu des trips (mode `trip-content`) | `getStopTimes({ tripId: [...] })` par lots de 500 (les filtres acceptent les tableaux) ; tri par `stop_sequence` côté appelant |

Constats de l'évaluation :

- **Tout est faisable sans SQL brut.** `getActiveServiceIds` évite même de
  réimplémenter l'activation des services.
- Il n'existe ni `getCalendars()` (liste complète) ni `getFeedInfo()` : les
  `service_id` sont donc dérivés de `getTrips()`. Un service sans trip est
  invisible — sans effet sur les signatures, mais il ne peut pas étendre la
  plage du feed (c'est plutôt sain).
- Performances mesurées (sql.js en mémoire, Node) : Car Jaune 55 ms
  (`trip-ids`) / 170 ms (`trip-content`) ; Astuce (24 873 trips, 650 000
  stop_times) 189 ms / 2,3 s — le mode contenu est dominé par les
  `getStopTimes` par lots.
- Validation croisée : les deux implémentations (lecture CSV directe
  `examples/run.ts` et gtfs-sqljs `examples/run-gtfs-sqljs.ts`) produisent des
  résultats identiques sur les 5 réseaux (mêmes signatures, mêmes groupes,
  mêmes jours non classés).

```typescript
import { GtfsSqlJs } from 'gtfs-sqljs'
import { createSqlJsAdapter } from 'gtfs-sqljs/adapters/sql-js'
import { findCalendarPeriods } from 'gtfs-sqljs-calendar-hints'

const gtfs = await GtfsSqlJs.fromZip('https://example.com/gtfs.zip', {
  adapter: await createSqlJsAdapter(),
})
const result = await findCalendarPeriods(gtfs, [
  { name: 'Jours fériés', policy: 'match-all', days: ['2026-11-01', '2026-11-11' /* … */] },
  { name: 'Vacances scolaires', policy: 'match-all', days: [/* lun-ven des vacances */] },
], { signatureMode: 'trip-content' })

result.hintResults   // matché ? groupes ? mismatches structurés (2 jours concrets + comptes)
result.leftoverResult // passe finale per-day-of-week
result.periods       // groupes fusionnés par signature = les "périodes"
result.unclassified  // jours restants, groupés par signature
```

Options : `signatureMode` (`'trip-ids'` par défaut) et `firstDay`/`lastDay`
pour restreindre la plage analysée (utile contre les queues de feed creuses,
edge case 18).

### Attributs personnalisés sur les hints

Un hint peut porter des attributs supplémentaires (couleur, id, méta…) : la
librairie ne les lit pas mais les restitue. Les résultats référencent les
objets hints d'origine — jamais de copie :

- `hintResults[i].hint` : le hint tel que fourni ;
- `hintResults[i].groups[j].hint` : le hint à l'origine du groupe (pour les
  groupes de la passe finale, le pseudo-hint « Remaining days ») ;
- `periods[k].hints` : les hints distincts ayant contribué à la période, dans
  l'ordre des hints, pseudo-hint de la passe finale exclu (une période issue
  uniquement de la passe finale a `hints: []`).

`findCalendarPeriods` est générique (`H extends Hint`) : déclarez votre type
de hint et les attributs reviennent typés.

```typescript
interface MyHint extends Hint { color: string }

const hints: MyHint[] = [
  { name: 'Jours fériés', policy: 'match-all', days: ['2026-11-01' /* … */], color: '#e33' },
]
const result = await findCalendarPeriods(gtfs, hints)
result.periods[0].hints[0]?.color   // '#e33' — même objet, typé MyHint
```

Conséquence du passage par référence : ne mutez pas un hint après l'appel si
vous voulez un résultat stable.

## Edge cases à surveiller (tous observés sur des feeds réels)

**Structure des fichiers**
1. `calendar.txt` absent : Astuce (Rouen) n'a que `calendar_dates.txt` avec
   2169 exceptions de type 1. La plage du feed doit alors se déduire des
   dates ajoutées. Toujours lire les colonnes **par nom** : Pysae (Car Jaune,
   Kar'Ouest) écrit les colonnes en ordre alphabétique ; Astuce a un BOM
   UTF-8 ; Kar'Ouest a des espaces dans les `service_id`.
2. Exceptions type 2 « no-op » (suppression d'un service un jour où il ne
   circulait de toute façon pas) : fréquent, sans effet, à ignorer.
3. `frequencies.txt` non géré pour l'instant : deux jours au même contenu de
   trips pourraient différer par leurs fréquences.
4. Trips dupliqués par période (voir mode `trip-content` ci-dessus).

**Jours fériés — chaque réseau fait autre chose**
5. Férié = service dimanche (Car Jaune via un service dédié, Estival,
   Carsud via un service « Fête » au contenu identique au dimanche mais aux
   trip_id différents — le mode `trip-content` les unifie).
6. Férié = réseau **fermé** (Kar'Ouest le 11/11 : 0 trips, 0 services). Une
   signature « vide » est une signature valide.
7. Férié **oublié ou traité en jour normal** : Estival roule en service
   semaine complet le lundi de Pentecôte ; Kar'Ouest roule en service
   vacances normal le 25/12. Le match-all « Jours fériés » échoue alors sur
   ce seul jour — c'est voulu, le diagnostic le nomme précisément.
8. Bug de feed probable : Carsud ne retire pas le service semaine les 25/12,
   01/01 et 01/05 → ces jours cumulent semaine + « Fête » (1148 trips au
   lieu de 192). Le matching strict révèle ce genre d'incohérence.
9. Fériés tombant samedi/dimanche : se fondent naturellement dans le groupe
   du jour de semaine si l'offre est la même.

**Vacances scolaires**
10. Conventions de dates divergentes. L'API officielle
    (`fr-en-calendrier-scolaire`) donne `start_date` = dernier jour de classe
    et `end_date` = dernier jour de vacances (reprise le lendemain). Mais les
    opérateurs ne sont pas d'accord entre eux : pour la Toussaint 2026 à La
    Réunion, Kar'Ouest reprend le service scolaire le lundi 26/10 (conforme à
    l'API) alors que Car Jaune roule encore en service vacances ce jour-là.
    Deux réseaux de la même île, deux lectures du même calendrier.
11. Jour de prérentrée des enseignants : signature unique chez Kar'Ouest le
    lundi 17/08 (ni scolaire, ni vacances).
12. « Pont de l'Ascension » : l'API le publie parfois avec
    `start_date = end_date` = le férié lui-même ; il faut étendre au dimanche.
13. « Début des Vacances d'Été » sans date de fin : borner à la fin du feed.
14. Certains réseaux n'ont **aucune** distinction scolaire/vacances (Carsud,
    Estival) : le hint vacances est alors inutile — il matche trivialement ou
    échoue à cause d'autres jours (fériés non consommés, cf. 16).

**Effets de bord de l'algorithme**
15. Un seul jour déviant fait échouer tout un hint match-all — voulu, mais le
    diagnostic doit nommer ce jour (fait).
16. **Cascade d'échecs** : si « Jours fériés » échoue, les fériés restent
    dans la liste et font échouer « Vacances scolaires » puis la passe
    finale (Estival, Carsud). Lire les erreurs dans l'ordre des hints.
17. Groupe d'un seul jour en `per-day-of-week` : match trivialement vrai.
    À signaler dans un rapport (taille de groupe minimale ?).
18. Fin de feed « en escalier » : les services ne s'arrêtent pas tous à la
    même date. Car Jaune : services finissant au 02/07, 14/07 et 02/08/2027.
    Astuce : à partir de juillet 2027 le feed ne contient plus que 14 trips
    (offre creuse) jusqu'au 29/08. La fin de plage produit des signatures
    parasites ; une option « restreindre la plage analysée » serait utile.
19. Overlays temporaires : Astuce a un service de 22 trips actif seulement de
    septembre à mi-octobre 2026 → les jours de semaine se scindent en deux
    signatures qui ne diffèrent que de 22 trips sur ~5100. Le strict refuse
    de fusionner (voulu) ; le diagnostic donne le delta exact.
20. Vraie structure par jour de semaine : Astuce (mercredi ≠ lundi/mardi ≠
    jeudi/vendredi), Carsud (vendredi ≠ lundi-jeudi, 12 trips échangés).
    C'est précisément ce que `per-day-of-week` sait capturer.

## Générer les jours des hints (côté appelant)

La librairie ne génère ni fériés ni vacances : c'est à l'appelant de
construire les listes de dates. Sources recommandées pour la France :

- **Jours fériés** : npm `date-holidays`, `new Holidays('FR')` pour la
  métropole, `new Holidays('FR', 'RE')` pour La Réunion (inclut l'Abolition
  de l'esclavage le 20/12). Filtrer `type === 'public'` (exclut Pentecôte
  dimanche, Fête des Mères…).
- **Vacances scolaires** : API
  `data.education.gouv.fr` / dataset `fr-en-calendrier-scolaire`
  (académies « Réunion », « Normandie »…). Garder `population` ∈
  {`-`, `Élèves`}. Conventions : voir edge cases 10-13.

`examples/hints-france.ts` implémente ces deux générateurs (exemple, hors
librairie — `date-holidays` est une devDependency de ce dépôt, pas une
dépendance du paquet).

## Scripts

```bash
npm run build       # tsup → dist/ (ESM + .d.ts)
npm test            # vitest, sur un stub GtfsCalendarSource
npm run lint && npm run typecheck

npx tsx examples/run.ts car-jaune kar-ouest carsud estival astuce
  # lecture CSV directe ; chaque réseau passe en trip-ids puis trip-content
npx tsx examples/run-gtfs-sqljs.ts car-jaune estival …
  # même chose via gtfs-sqljs (méthodes getXXXX uniquement)
npx tsx examples/compare-services.ts <dir>   # services au contenu identique ?
```

- `src/calendar-hints.ts` (+ `src/index.ts`) : **le paquet npm** — algorithme
  sur gtfs-sqljs, résultats structurés, sans affichage, zéro dépendance.
- `examples/lib.ts` : implémentation d'exploration en lecture CSV directe.
- `examples/hints-france.ts` : fériés (date-holidays) et vacances scolaires
  (API éducation nationale) par réseau.
- `examples/run.ts` / `examples/run-gtfs-sqljs.ts` : runners des deux voies.
- `examples/csv.ts` : parseur CSV streaming (BOM, quotes, CRLF).
- `data/school-calendar.json` : extrait de l'API calendrier scolaire.
- `website/` : démo React (GitHub Pages).
