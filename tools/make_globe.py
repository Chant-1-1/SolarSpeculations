"""Erzeugt ein stilisiertes Weltkugel-PNG (transparenter Hintergrund) als Test-Rasterbild.
Aufruf:  python tools/make_globe.py
Ausgabe: assets/images/entities/scene1/weltkugel.png
"""
import numpy as np
from PIL import Image
import os

SS = 1400          # Supersampling-Aufloesung (wird auf OUT herunterskaliert -> Antialiasing)
OUT = 700
OUTFILE = os.path.join(os.path.dirname(__file__), "..", "assets", "images", "entities", "scene1", "weltkugel.png")

# --- Koordinaten: -1..1, y nach oben ---
yy, xx = np.mgrid[0:SS, 0:SS]
x = (xx + 0.5) / SS * 2 - 1
y = 1 - (yy + 0.5) / SS * 2
r2 = x * x + y * y
inside = r2 <= 1.0
z = np.sqrt(np.clip(1 - r2, 0, 1))            # Kugel-Tiefe -> Normale = (x, y, z)

# --- Kugelkoordinaten fuer Textur (orthographische Sicht, Betrachter auf +z) ---
lat = np.arcsin(np.clip(y, -1, 1))            # Breitengrad
lon = np.arctan2(x, np.where(z > 1e-6, z, 1e-6))  # Laengengrad um Hochachse
u = (lon / np.pi) * 0.5 + 0.5                 # 0..1
v = (lat / (np.pi / 2)) * 0.5 + 0.5

def vnoise(u, v, period, seed):
    """Value-Noise mit bilinearer, glaettender Interpolation."""
    rng = np.random.default_rng(seed)
    g = rng.random((period + 2, period + 2))
    fu = u * period; fv = v * period
    iu = np.clip(np.floor(fu).astype(int), 0, period)
    iv = np.clip(np.floor(fv).astype(int), 0, period)
    tu = fu - iu; tv = fv - iv
    sm = lambda t: t * t * (3 - 2 * t)
    su, sv = sm(tu), sm(tv)
    a = g[iv, iu]; b = g[iv, iu + 1]; c = g[iv + 1, iu]; d = g[iv + 1, iu + 1]
    top = a + (b - a) * su; bot = c + (d - c) * su
    return top + (bot - top) * sv

# --- fraktales Noise (mehrere Oktaven) fuer Kontinente ---
fbm = np.zeros_like(u); amp = 1.0; tot = 0.0
for o, per in enumerate([3, 6, 12, 24, 48]):
    fbm += amp * vnoise(u, v, per, seed=15 + o)
    tot += amp; amp *= 0.85
fbm /= tot

# --- Farben nach Hoehe (Land/Ozean) ---
col = np.zeros((SS, SS, 3))
deep   = np.array([18, 55, 120]) / 255
shallow= np.array([55, 125, 200]) / 255
beach  = np.array([205, 195, 150]) / 255
lowl   = np.array([70, 140, 75]) / 255
highl  = np.array([120, 150, 95]) / 255
ice    = np.array([238, 244, 250]) / 255

sea = fbm < 0.50
t_sea = np.clip(fbm / 0.50, 0, 1)[..., None]
col[sea] = (deep + (shallow - deep) * t_sea)[sea]
land = ~sea
t_land = np.clip((fbm - 0.50) / 0.50, 0, 1)[..., None]
land_col = np.where(t_land < 0.12, beach, lowl + (highl - lowl) * t_land)
col[land] = land_col[land]
# Eiskappen
cap = (np.abs(lat) > 1.30)
col[cap] = ice

# --- Beleuchtung (Lambert von oben-links-vorne) + Rim-Light ---
L = np.array([-0.5, 0.6, 0.75]); L = L / np.linalg.norm(L)
diff = np.clip(x * L[0] + y * L[1] + z * L[2], 0, 1)
shade = (0.32 + 0.85 * diff)[..., None]
col = col * shade
rim = (np.clip(1 - z, 0, 1) ** 4)[..., None]      # blauer Lichtsaum am Rand
col = col + rim * (np.array([120, 165, 225]) / 255) * 0.5
col = np.clip(col, 0, 1)

# --- Alpha: Kugel deckend, plus zarter Atmosphaeren-Halo ---
alpha = np.where(inside, 1.0, 0.0)
rr = np.sqrt(r2)
halo = np.exp(-((rr - 1.0) / 0.045) ** 2) * 0.45
halo[inside] = 0
rgb = np.where(inside[..., None], col, np.array([150, 185, 235]) / 255)
alpha = np.clip(alpha + halo, 0, 1)

img = np.dstack([(rgb * 255).astype(np.uint8), (alpha * 255).astype(np.uint8)])
im = Image.fromarray(img, "RGBA").resize((OUT, OUT), Image.LANCZOS)
os.makedirs(os.path.dirname(OUTFILE), exist_ok=True)
im.save(OUTFILE)
print("gespeichert:", os.path.normpath(OUTFILE), im.size)
