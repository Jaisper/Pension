# 🏦 Dansk Pensionssimulator

Analysér og simulér din fremtidige pension baseret på dansk lovgivning (2025) — inkl. boligformue og arv.

## Funktioner

- **Pensionstyper**: Ratepension, livsvarig, aldersopsparing, kapitalpension
- **Boligformue**: Friværdi-beregning, sælg/behold-scenarie, parcelhusregel
- **Arv**: Boafgift (15%), ægtefælle-fritagelse, vækst frem til pension
- **Skatteberegning**: PAL-skat, bundskat, kommuneskat, topskat
- **Folkepension + ATP**: Med modregning af pensionstillæg
- **Scenarier**: Pessimistisk, forventet, optimistisk
- **Filimport**: Upload pensionsrapport (tekst/CSV fra PensionInfo)
- **Visualiseringer**: Formueudvikling, månedlig udbetaling, formuesammensætning

## Kom i gang

### Lokal udvikling

```bash
npm install
npm run dev
```

Åbn [http://localhost:5173](http://localhost:5173)

### Deploy til GitHub Pages

1. Opret et nyt repo på GitHub (f.eks. `dansk-pension-simulator`)
2. Opdater `base` i `vite.config.js` så den matcher dit repo-navn
3. Push koden:

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/DIT-BRUGERNAVN/dansk-pension-simulator.git
git branch -M main
git push -u origin main
```

4. Gå til **Settings → Pages** i dit repo
5. Under **Source** vælg **GitHub Actions**
6. Sitet deployes automatisk ved hvert push til `main`

Dit site vil være tilgængeligt på: `https://DIT-BRUGERNAVN.github.io/dansk-pension-simulator/`

## Vigtige forbehold

⚠️ Denne simulator giver estimater baseret på forenklede beregninger. Faktiske pensionsudbetalinger afhænger af mange faktorer. Kontakt din pensionsudbyder eller en uafhængig rådgiver for præcise beregninger.

Skattebeløb og grænser er baseret på 2025-niveauer.

## Tech stack

- React 18
- Recharts (grafer)
- Vite (build)
- GitHub Pages (hosting)

## Licens

MIT
