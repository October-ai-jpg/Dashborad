# Team Dashboard

Real-time team dashboard med WebSocket sync. Hostet på Railway.

## Deploy til Railway

1. Upload denne mappe til et **GitHub repo** (privat eller public)
2. Gå til [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Vælg dit repo — Railway auto-detekterer Node.js og deployer
4. Gå til Settings → Networking → Generate Domain → du får en URL som `din-app.railway.app`
5. Del den URL med din makker

Det er det. Ingen env vars nødvendige.

---

## Månedlig opdatering

Når en ny måned starter, lav en ny config-fil:

```
config/
  2025-04.json   ← April
  2025-05.json   ← Maj  (kopier april-filen og ret indholdet)
  2025-06.json   ← Juni
```

**Sådan laver du maj-konfigurationen:**
1. Kopier `config/2025-04.json` → `config/2025-05.json`
2. Ret `"month"`, `"title"`, tasks og kalender-events
3. Push til GitHub → Railway deployer automatisk
4. Dashboard'et viser en dropdown øverst til venstre med alle måneder

Flueben-data (hvad der er klikket af) gemmes separat pr. måned, så april-data forsvinder ikke når I skifter til maj.

---

## Struktur

```
dashboard/
  server.js          ← Express + WebSocket backend
  package.json
  public/
    index.html       ← Hele frontend (HTML/CSS/JS)
  config/
    2025-04.json     ← Config pr. måned (rediger dette)
  data/
    state.json       ← Auto-genereret, gemmer flueben-state
```

## Config-format forklaret

```json
{
  "month": "2025-05",
  "title": "Maj 2025",
  "subtitle": "EB-Media + October AI",
  "kpis": [
    { "label": "KPI", "value": "Beskriv målets succes" }
  ],
  "sections": {
    "en_sektion": {
      "label": "Sektion navn",
      "group": "Projekt navn",
      "tasks": [
        { "id": "unik_id", "text": "Opgave tekst", "tag": "Sales" }
      ]
    }
  },
  "calendar": {
    "year": 2025,
    "month": 5,
    "events": [
      { "from": 1, "to": 5, "type": "blocked", "label": "Ferie" },
      { "day": 17, "type": "travel", "label": "Konference" },
      { "weekday": 3, "type": "vaekst", "label": "Mødedag" }
    ]
  },
  "hubspot": {
    "enabled": true,
    "apiKey": "din-api-nøgle-her"
  }
}
```

### Kalender event typer
| type | farve | bruges til |
|------|-------|------------|
| `together` | grøn | Arbejder sammen (default for hverdage) |
| `blocked` | rød | Kan ikke arbejde sammen |
| `travel` | gul | Rejse |
| `vaekst` | teal | Faste møde-/vækst-dage |
| `exam` | lilla | Eksamen / fokus-dage |

### Tilgængelige tags
`Leads` `Pitch` `Sales` `AI` `Tech` `Research` `Deal` `Ekspansion` `Team` `Demo` `Kunde`

---

## HubSpot

HubSpot's legacy API-nøgler er udfasede. For at tasks loader korrekt:

1. Gå til HubSpot → Settings → Integrations → Private Apps
2. Opret ny app med scopes: `crm.objects.tasks.read`
3. Kopier access token
4. Indsæt i config-filen under `hubspot.apiKey`

---

## Lokalt (til test)

```bash
npm install
npm start
# Åbn http://localhost:3000
```
