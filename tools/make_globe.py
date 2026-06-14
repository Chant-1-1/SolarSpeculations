"""Erzeugt ein stilisiertes Weltkugel-PNG (transparenter Hintergrund) als Test-Rasterbild.
Aufruf:  python tools/make_globe.py
Ausgabe: assets/images/entities/scene1/weltkugel.png

Gezielt platzierte Landmassen ums Aequatorband, kleine Polkappen, tiefes Meer.
Stellschrauben siehe KONFIG-Block unten.
"""
import numpy as np
from PIL import Image
import os

# =================== KONFIG ===================
SS = 1400          # Supersampling-Aufloesung (wird auf OUT verkleinert -> Antialiasing)
OUT = 700
SEED = 7           # andere Zahl = andere Verteilung der Inseln

# (Anzahl, Radius-min, Radius-max, Lappen) in Bogenmass (rad). 0.40 rad ~ 23 Grad.
# Lappen = aus wie vielen verschmelzenden Klumpen die Insel besteht (mehr = organischer).
ISLAND_SPECS = [
    (4, 0.26, 0.34, 4),   # 4 grosse, klumpig
    (3, 0.15, 0.20, 2),   # 3 kleine
    (8, 0.05, 0.08, 1),   # 8 sehr kleine, kompakt
]
LAT_BAND = 0.65        # Inselzentren nur innerhalb +-0.65 rad (~37 Grad) um den Aequator
LON_SPAN = 1.25        # nur sichtbare Vorderseite (~+-72 Grad)
COAST_NOISE = 0.22     # Fransigkeit der Kuesten (0 = glatte Raender)

ICE_LAT = 1.12         # Eis ab diesem Breitengrad (rad, ~64 Grad) -> kleine Polkappen
SHELF = 0.28           # Breite des hellen Flachwassersaums; kleiner = schneller tief/dunkel
LAND = 0.42            # Schwelle Land vs. Meer (hoeher = weniger/kleinere Inseln)

OUTFILE = os.path.join(os.path.dirname(__file__), "..",
                       "assets", "images", "entities", "scene1", "weltkugel.png")

# Farben (RGB 0..255)
C_SHOAL = np.array([ 66, 130, 162]) / 255   # Flachwasser an der Kueste (gedaempft)
C_SEA   = np.array([ 26,  78, 140]) / 255   # mittleres Meer
C_ABYSS = np.array([  6,  26,  70]) / 255   # Tiefsee (dunkel)
C_BEACH = np.array([208, 198, 150]) / 255
C_LOW   = np.array([ 72, 140,  74]) / 255
C_HIGH  = np.array([122, 150,  92]) / 255
C_ICE   = np.array([238, 244, 250]) / 255
# ==============================================

# --- Koordinaten: -1..1, y nach oben ---
yy, xx = np.mgrid[0:SS, 0:SS]
x = (xx + 0.5) / SS * 2 - 1
y = 1 - (yy + 0.5) / SS * 2
r2 = x * x + y * y
inside = r2 <= 1.0
z = np.sqrt(np.clip(1 - r2, 0, 1))            # Kugel-Tiefe -> Normale = (x, y, z)

lat = np.arcsin(np.clip(y, -1, 1))            # Breitengrad
lon = np.arctan2(x, np.where(z > 1e-6, z, 1e-6))  # Laengengrad
u = (lon / np.pi) * 0.5 + 0.5
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

# feines fraktales Noise nur fuer fransige Kuesten / Eisraender
coast = np.zeros_like(u); amp = 1.0; tot = 0.0
for o, per in enumerate([3, 6, 12, 24]):   # grob (Buchten/Halbinseln) -> fein (Zacken)
    coast += amp * vnoise(u, v, per, seed=40 + o)
    tot += amp; amp *= 0.6
coast = (coast / tot - 0.5) * 2          # -1..1

# --- Inseln platzieren (deterministisch, mit Mindestabstand) ---
def gc_dist(lo1, la1, lo2, la2):
    return np.arccos(np.clip(np.sin(la1) * np.sin(la2)
                             + np.cos(la1) * np.cos(la2) * np.cos(lo2 - lo1), -1, 1))

def unit(lon, lat):
    return (np.cos(lat) * np.sin(lon), np.sin(lat), np.cos(lat) * np.cos(lon))

rng = np.random.default_rng(SEED)
islands = []                              # dict: center + Lappen-Liste
for count, rmin, rmax, nlob in ISLAND_SPECS:
    placed = 0; tries = 0
    while placed < count and tries < 9000:
        tries += 1
        ilon = rng.uniform(-LON_SPAN, LON_SPAN)
        ilat = rng.uniform(-LAT_BAND, LAT_BAND)
        R = rng.uniform(rmin, rmax)
        if any(gc_dist(ilon, ilat, c["lon"], c["lat"]) < (R + c["R"]) * 1.05 for c in islands):
            continue
        # Lappen um das Zentrum streuen -> organischer Klumpen
        lobes = [(ilon, ilat, R * 0.78)]
        for _ in range(nlob - 1):
            a = rng.uniform(0, 2 * np.pi); d = rng.uniform(0.35, 0.7) * R
            llon = ilon + d * np.cos(a) / max(np.cos(ilat), 0.3)
            llat = ilat + d * np.sin(a)
            lobes.append((llon, llat, R * rng.uniform(0.5, 0.75)))
        islands.append({"lon": ilon, "lat": ilat, "R": R, "lobes": lobes})
        placed += 1

# --- Formfeld aus Metaballs (Land + Kuestennaehe in einem) ---
shape = np.zeros((SS, SS))
for isl in islands:
    fi = np.zeros((SS, SS))
    for (llon, llat, lr) in isl["lobes"]:                     # Metaball-Summe
        lx, ly, lz = unit(llon, llat)
        a = np.arccos(np.clip(x * lx + y * ly + z * lz, -1, 1))
        fi += np.exp(-(a / lr) ** 2 * 2.2)
    shape = np.maximum(shape, fi)                              # Inseln getrennt halten

shape_c = shape + COAST_NOISE * coast      # fransige Kueste
land = shape_c > LAND

# --- Einfaerben ---
col = np.zeros((SS, SS, 3))

# Meer: Tiefe aus Kuestennaehe -> schmaler heller Saum, dahinter sofort tief/dunkel
dt = np.clip((LAND - shape_c) / SHELF, 0, 1)[..., None] ** 0.8
sea_col = np.where(dt < 0.35,
                   C_SHOAL + (C_SEA - C_SHOAL) * (dt / 0.35),
                   C_SEA + (C_ABYSS - C_SEA) * ((dt - 0.35) / 0.65))
col[~land] = sea_col[~land]

# Land: Hoehe aus shape (Mehrfach-Lappen -> Gebirge)
h = np.clip((shape_c - LAND) / 0.7, 0, 1)[..., None]
land_col = np.where(h < 0.12, C_BEACH, C_LOW + (C_HIGH - C_LOW) * h)
col[land] = land_col[land]

# kleine Polkappen (mit fransigem Rand)
ice = (np.abs(lat) + 0.05 * coast) > ICE_LAT
col[ice] = C_ICE

# --- Beleuchtung (Lambert oben-links-vorne) + Rim-Light ---
L = np.array([-0.5, 0.6, 0.75]); L = L / np.linalg.norm(L)
diff = np.clip(x * L[0] + y * L[1] + z * L[2], 0, 1)
shade = (0.30 + 0.88 * diff)[..., None]
col = col * shade
# Eis reflektiert stark -> hell halten, damit beide Polkappen sichtbar bleiben
col[ice] = np.clip(C_ICE * (0.72 + 0.42 * diff[..., None]), 0, 1)[ice]
rim = (np.clip(1 - z, 0, 1) ** 4)[..., None]
col = col + rim * (np.array([110, 155, 215]) / 255) * 0.30
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
print("gespeichert:", os.path.normpath(OUTFILE), im.size,
      "| Inseln:", len(islands))
