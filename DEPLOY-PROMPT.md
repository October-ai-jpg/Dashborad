# Deploy-prompt til Claude Code

Kopiér nedenstående og giv det til Claude Code:

---

## Opgave: Deploy dashboard med ny opfølgnings-feature

**VIGTIGT:** Du arbejder KUN i mappen `~/Downloads/dashboard 2/`. Denne mappe er EB-Media Team Dashboard og deployes til Railway-servicen `dashborad-production`. Du må IKKE røre mappen `~/Desktop/eb-tour-agent/` — det er October AI platformen og er et helt separat projekt.

### Hvad der er ændret (allerede gjort, skal bare deployes)

3 filer er opdateret i `~/Downloads/dashboard 2/`:

1. **server.js** — Tilføjet:
   - Followups API (GET/POST/PATCH + `/api/followups/:id/send`)
   - Email-sending via nodemailer med Gmail SMTP
   - Automatisk signatur på alle sendte mails
   - `data/followups.json` fil-baseret storage

2. **public/index.html** — Tilføjet:
   - "Opfølgning" nav-knap i sidebar med live badge
   - Kort-baseret UI for hver opfølgning (modtager, emne, redigerbart udkast)
   - "Send direkte" knap, "Kopiér udkast" knap, "Ignorér" knap
   - Automatisk signatur-preview under hvert udkast
   - WebSocket live sync for nye opfølgninger
   - Toast-notifikationer ved send/kopiér/ignorér

3. **package.json** — Tilføjet `nodemailer` dependency

### Hvad du skal gøre

1. `cd ~/Downloads/dashboard\ 2/`
2. `npm install` (installerer nodemailer)
3. Test lokalt: `node server.js` og åbn http://localhost:3000
4. Commit og push til Railway-repoen for `dashborad-production`
5. Sæt følgende environment variable på Railway:
   - `GMAIL_APP_PASSWORD` — en Gmail App Password (16 tegn, genereres på https://myaccount.google.com/apppasswords)
   - `GMAIL_USER` er allerede hardcoded til `eb-media.dk@eb-media.dk` som fallback

### Hvis der ikke er et git repo i mappen

Hvis mappen ikke allerede er linket til Railway via git:
1. `git init`
2. `git add .`
3. `git commit -m "Add followup feature with email sending"`
4. Link til Railway via `railway link` eller push til det eksisterende GitHub repo der deployer til `dashborad-production`

### Test at det virker

- Åbn dashboardet og klik "Opfølgning" i sidebar
- Der bør allerede være 10 opfølgninger (lagt ind af Cowork)
- Tjek at "Send direkte" knap virker (kræver at GMAIL_APP_PASSWORD er sat)
- Tjek at "Kopiér udkast" kopierer tekst + signatur til clipboard
