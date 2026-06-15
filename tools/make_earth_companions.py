"""Erzeugt passende Begleit-Maps aus der (von Hand bearbeiteten) earth_day.jpg.
Aufruf:  python tools/make_earth_companions.py
Liest:   assets/images/entities/scene1/earth_day.jpg   (deine bearbeitete Farbkarte)
Schreibt:
  earth_spec.jpg    -> Glanzmaske: Wasser hell (glaenzt), Land/Eis matt
  earth_normal.jpg  -> Relief: flacher Ozean, sanfte Insel-/Eis-Erhebung
  earth_night.png   -> komplett schwarz (KEINE Stadtlichter -> Nachtseite bleibt dunkel)

Erkennt Wasser/Land/Eis automatisch aus Helligkeit + Farbe der Tagkarte.
Wenn du earth_day spaeter weiter aenderst: einfach dieses Tool erneut laufen lassen.
"""
import numpy as np
from PIL import Image
from scipy import ndimage
import os

D = os.path.join(os.path.dirname(__file__), "..", "assets", "images", "entities", "scene1")
DAY    = os.path.join(D, "earth_day.jpg")
SPEC   = os.path.join(D, "earth_spec.jpg")
NORMAL = os.path.join(D, "earth_normal.jpg")
NIGHT  = os.path.join(D, "earth_night.png")

img = np.asarray(Image.open(DAY).convert("RGB")).astype(np.float32) / 255.0
H, W = img.shape[:2]
r, g, b = img[..., 0], img[..., 1], img[..., 2]
lum = 0.299 * r + 0.587 * g + 0.114 * b

def smooth(a, e0, e1):
    t = np.clip((a - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)

# --- Masken: Wasser (blaeulich, b>r) vs. Land (warm, r>b) vs. Eis (hell) ---
rb = r - b                                                   # >0 = warm (Land), <0 = blau (Wasser)
print("  r-b Perzentile: p50={:.3f} p90={:.3f} p98={:.3f} | max={:.3f}".format(
    np.percentile(rb, 50), np.percentile(rb, 90), np.percentile(rb, 98), rb.max()))
print("  lum Perzentile: p50={:.3f} p95={:.3f} p99={:.3f}".format(
    np.percentile(lum, 50), np.percentile(lum, 95), np.percentile(lum, 99)))
ice  = smooth(lum, 0.52, 0.68)                               # helle Pole/Eis
land = (1.0 - ice) * smooth(rb, -0.045, -0.005)              # deutlich weniger blau als Ozean -> Insel
water = np.clip(1.0 - ice - land, 0.0, 1.0)

# --- SPECULAR: Wasser glaenzt, Land matt, Eis leicht ---
spec = 0.05 + 0.85 * water + 0.22 * ice
spec = np.clip(ndimage.gaussian_filter(spec, sigma=0.8), 0, 1)
Image.fromarray((spec * 255).astype(np.uint8), "L").save(SPEC, quality=95)

# --- HOEHE -> NORMAL: Ozean flach, Inseln + Eis sanft erhaben ---
elev = 0.50 + 0.12 * land * (0.5 + lum) + 0.05 * ice
elev = elev + 0.05 * land * (lum - 0.30)                     # Binnen-Detail der Inseln
elev = ndimage.gaussian_filter(elev, sigma=1.4)
gy, gx = np.gradient(elev)
relief = 6.0
nx, ny, nz = -gx * relief, -gy * relief, np.ones_like(elev)
ln = np.sqrt(nx * nx + ny * ny + nz * nz) + 1e-9
normal = np.dstack([nx / ln, ny / ln, nz / ln]) * 0.5 + 0.5
Image.fromarray((normal * 255).astype(np.uint8), "RGB").save(NORMAL, quality=95)

# --- NIGHT: schwarz (keine Lichter) ---
Image.fromarray(np.zeros((H, W, 3), np.uint8), "RGB").save(NIGHT)

# Diagnose
print("aus earth_day.jpg ({}x{}):".format(W, H))
print("  Wasser-Anteil: {:.0%} | Land: {:.0%} | Eis: {:.0%}".format(
    water.mean(), land.mean(), ice.mean()))
print("  -> earth_spec.jpg, earth_normal.jpg, earth_night.png (schwarz) geschrieben")
