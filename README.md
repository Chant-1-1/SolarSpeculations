# SolarSpeculations

Interaktive Multimedia-Präsentation im Geist von *Feral Atlas*: schwebende
Bild-Entities ziehen auf autorendefinierten Bahnen über eine dunkle Leinwand.
Hover zeigt das Label, Klick öffnet ein Inhalts-Panel. Mehrere Szenen mit
eigenem Hintergrund und Ambient-Sound, Crossfade beim Wechsel.

**Stack:** p5.js (Canvas/Entities/Trajektorien) + Tone.js (Ambient/Reverb).
Kein Build-Step, reine relative Pfade — direkt auf GitHub Pages lauffähig.

> Titel/Story sind noch **Platzhalter**. Inhalt lebt komplett in `data/*.json`.

## Struktur

```
index.html        stabiles Showfile (lädt app.js)
app.js            Engine: Entities, Trajektorien, Szenen, Audio
mixer.html        Dev-Tool: Sounds auditionieren & Szenen zuweisen
pathdesigner.html Dev-Tool: Wegpunkte klicken, normalisiert exportieren
lib/              p5.min.js, Tone.js (vendored, läuft offline)
data/
  scenes.json     Szenen: Hintergrund, Ambient, Reverb-Send
  entities.json   Entities: Bild, Label, path (0–1), loop, content …
assets/
  images/backgrounds/        scene1.jpg …
  images/entities/sceneN/     Entity-Bilder (PNG mit Transparenz)
  images/secondary/           optionale Panel-Bilder
  sounds/ambient/sceneN/      Ambient-Beds (MP3, geloopt)
  sounds/fx/                  Effekte
```

## Lokal starten

VS Code „Live Server" auf den Repo-Ordner (nötig wegen `fetch` der JSON —
`file://` blockiert das). Dann `index.html` öffnen.

## Workflow

1. **Bilder** in `assets/images/entities/sceneN/` ablegen (PNG, transparent).
2. **Pfade** in `pathdesigner.html` klicken → JSON in `entities.json` einfügen.
3. **Sounds** in `assets/sounds/...` ablegen, in `mixer.html` zuweisen →
   Block in `scenes.json` übernehmen.
4. Entities/Texte in `entities.json` editieren — `index.html` nie anfassen.

Fehlt ein Bild, zeichnet die Show einen farbigen Platzhalter-Kleks; fehlt ein
Sound, bleibt es still. Das Gerüst läuft also schon ohne Assets.

## Eigene Bilder für die Unterszenen (Hotspot-Szenen)

Jede Unterszene, die ein Marker/Hotspot öffnet, hat einen **Bild-Slot**
(Entity mit `sceneImage: true` in `entities.json`) — gleiches Prinzip wie bei
den Tieren und der Station: Bild(er) in den `variants`-Ordner legen, fertig.

| Unterszene | Ordner | Dateiname |
|---|---|---|
| the sun | `assets/images/entities/sun/sun/` | `sun1.png` / `sun1.webp` |
| the atmosphere | `assets/images/entities/atmosphere/atmosphere/` | `atmosphere1.png` |
| the water | Berg-Bild: `land` in `scenes.json` (bereits belegt) | `mountain.png` |
| the station (Querschnitt)* | `assets/images/entities/station_cut/station/` | `station1.png` |
| living | `assets/images/entities/habitat/habitat/` | `habitat1.png` |
| wildlife* | `assets/images/entities/wildlife/wildlife/` | `wildlife1.png` |

*aktuell nicht verlinkt — die Marker blenden stattdessen Info-Hotspots in Szene 2 ein.

Liegt ein Bild im Ordner, wird das **prozedural gezeichnete Motiv der Szene
ausgeblendet** (Hintergrund, Caption und Klick-Hotspots bleiben). Ist der Ordner
leer, ändert sich nichts — kein Platzhalter. Mehrere Varianten (`sun2.png`, …)
sind möglich, die Engine wählt zufällig. Position/Größe über `path`/`scale` des
jeweiligen `*_image`-Entities tunen; in jedem Ordner liegt eine `LIESMICH.txt`.

## entity-Felder (`entities.json`)

| Feld | Bedeutung |
|------|-----------|
| `image` | Pfad zur Bilddatei |
| `label` | Name bei Hover |
| `path` | Wegpunkte `{x,y}` normalisiert 0–1 |
| `loop` | `loop` (geschlossen) · `pingpong` · `drift` (durchlaufen + neu auftauchen) |
| `speed` | Tempo (Pfadanteil/Sekunde) |
| `scale` | Größe relativ zur kürzeren Bildschirmkante |
| `bob` | vertikales Sinus-Wackeln |
| `opacity` | 0–1 |
| `content` | `{ title, body, secondaryImage, link:{url,label} }` |
| `scene` | Szenen-id |

## Audio-Architektur

Drei geteilte Reverb-Busse (short ~3s / long ~10s / huge ~16s) — **nicht** ein
Reverb pro Sound. Jede Szene routet ihren Ambient-Player (MP3-Loop) auf einen
Bus, mit szenenbezogener Lautstärke und Crossfade beim Wechsel. Bei offenem
Panel duckt das Master leicht ab und Entities werden langsamer. Audio startet
erst nach Nutzer-Geste (Autoplay-Policy).

## Steuerung

- Klick auf Entity → Panel · `Esc` schließt
- Pfeiltasten ←/→ oder die Punkte/Pfeile unten → Szenenwechsel
