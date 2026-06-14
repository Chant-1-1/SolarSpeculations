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
