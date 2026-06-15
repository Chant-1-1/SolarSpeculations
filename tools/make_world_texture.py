"""Erzeugt ein PHOTOREALES Satelliten-Texturset (equirektangular 2:1) fuer die WebGL-Kugel.
Aufruf:  python tools/make_world_texture.py
Ausgabe (assets/images/entities/scene1/):
  world.png         -> Albedo im Satelliten-Look (Biome, Tiefenfarben, feines Korn)  -- OHNE Beleuchtung
  world_normal.png  -> Tangent-Space-Normal-Map aus dem Hoehenfeld (Relief -> Sonne wirft Schatten)
  world_spec.png    -> Specular/Glanz-Maske (Ozean hell = glaenzt, Land dunkel = matt)
  clouds.png        -> separate Wolkenschicht (unveraendert)
  flow.png          -> divergenzfreies Stroemungs-Wirbelfeld (unveraendert, Stil 3)

Die Beleuchtung (Sonne, Tag/Nacht, Glanz, Relief) macht der WebGL-Shader zur Laufzeit mit
world.png + world_normal.png + world_spec.png. Hier nur die fotorealen Daten.
Inselplatzierung/Seed wie gehabt -> es bleibt UNSERE Welt, nur photoreal.
"""
import numpy as np
from PIL import Image
from scipy import ndimage
import os

# =================== KONFIG ===================
W, H = 2048, 1024      # Texturgroesse (2:1)
SEED = 7

ISLAND_SPECS = [
    (4, 0.12, 0.16, 2),
    (3, 0.12, 0.16, 2),
    (8, 0.045, 0.075, 1),
]
LAT_BAND = 0.22        # Inseln um den Aequator
COAST_NOISE = 0.32     # Kuesten-Fransigkeit
WARP = 0.28            # organische Verformung
LAND = 0.45
SHELF = 0.30

ICE_LAT = 1.02         # Polkappen ~58 Grad
ICE_DYN = 0.16
N_FLOES = 16
FLOE_R = (0.03, 0.06)
CLOUD_COVER = 0.42
CLOUD_ALPHA = 0.85

# --- Foto-Palette (sRGB 0..255) ---
# Ozean: dunkel-marineblau in der Tiefe -> tuerkis am Schelf (Satelliten-Tiefenfarben)
C_TRENCH = np.array([  8,  26,  52]) / 255   # Tiefsee-Becken (dunkelstes Blau)
C_ABYSS  = np.array([ 16,  46,  86]) / 255   # tiefster Ozean
C_DEEP   = np.array([ 26,  66, 110]) / 255
C_SEA    = np.array([ 40,  98, 144]) / 255
C_SHELF  = np.array([ 74, 150, 166]) / 255   # flacher Schelf, tuerkis
C_SHOAL  = np.array([120, 184, 184]) / 255   # ganz flach an der Kueste
# Land-Biome
C_BEACH  = np.array([204, 192, 150]) / 255   # Kuestensand
C_TROP   = np.array([ 38,  86,  40]) / 255   # tropisches Gruen (Aequator, feucht)
C_VEG    = np.array([ 74, 104,  54]) / 255   # gemaessigtes Gruen
C_DRY    = np.array([150, 132,  82]) / 255   # trockenes Grasland
C_DESERT = np.array([176, 146,  98]) / 255   # Wueste/aride Zone
C_ROCK   = np.array([122, 108,  92]) / 255   # Hochland/Fels
C_PEAK   = np.array([225, 228, 230]) / 255   # Schnee auf Gipfeln
C_ICE    = np.array([234, 242, 249]) / 255   # Polkappe
C_ICE_SH = np.array([196, 214, 234]) / 255   # blaeulicher Eis-Schatten

OUTFILE    = os.path.join(os.path.dirname(__file__), "..", "assets", "images", "entities", "scene1", "world.png")
NORMALFILE = os.path.join(os.path.dirname(__file__), "..", "assets", "images", "entities", "scene1", "world_normal.png")
SPECFILE   = os.path.join(os.path.dirname(__file__), "..", "assets", "images", "entities", "scene1", "world_spec.png")
CLOUDFILE  = os.path.join(os.path.dirname(__file__), "..", "assets", "images", "entities", "scene1", "clouds.png")
FLOWFILE   = os.path.join(os.path.dirname(__file__), "..", "assets", "images", "entities", "scene1", "flow.png")
# ==============================================

# equirektangulares Gitter -> 3D-Punkte auf der Einheitskugel
j, i = np.mgrid[0:H, 0:W]
lon = (i + 0.5) / W * 2 * np.pi - np.pi
lat = np.pi / 2 - (j + 0.5) / H * np.pi
px = np.cos(lat) * np.sin(lon)
py = np.sin(lat)
pz = np.cos(lat) * np.cos(lon)

def unit(lo, la):
    return np.array([np.cos(la) * np.sin(lo), np.sin(la), np.cos(la) * np.cos(lo)])

def snoise3(X, Y, Z, seed, octaves, base_freq):
    rng = np.random.default_rng(seed)
    val = np.zeros_like(X); amp = 1.0; tot = 0.0; f = base_freq
    for _ in range(octaves):
        d = rng.normal(size=3); d /= np.linalg.norm(d)
        ph = rng.uniform(0, 2 * np.pi)
        val += amp * np.sin(f * (d[0] * X + d[1] * Y + d[2] * Z) + ph)
        tot += amp; amp *= 0.6; f *= 1.9
    return val / tot

def vnoise3(X, Y, Z, period, seed):
    period = int(round(period))
    rng = np.random.default_rng(seed)
    g = rng.random((period + 2, period + 2, period + 2))
    fx = (X * 0.5 + 0.5) * period; fy = (Y * 0.5 + 0.5) * period; fz = (Z * 0.5 + 0.5) * period
    ix = np.clip(np.floor(fx).astype(np.int32), 0, period)
    iy = np.clip(np.floor(fy).astype(np.int32), 0, period)
    iz = np.clip(np.floor(fz).astype(np.int32), 0, period)
    tx = fx - ix; ty = fy - iy; tz = fz - iz
    sx = tx*tx*(3-2*tx); sy = ty*ty*(3-2*ty); sz = tz*tz*(3-2*tz)
    def G(dz, dy, dx): return g[iz+dz, iy+dy, ix+dx]
    x00 = G(0,0,0)+(G(0,0,1)-G(0,0,0))*sx; x10 = G(0,1,0)+(G(0,1,1)-G(0,1,0))*sx
    x01 = G(1,0,0)+(G(1,0,1)-G(1,0,0))*sx; x11 = G(1,1,0)+(G(1,1,1)-G(1,1,0))*sx
    y0 = x00+(x10-x00)*sy; y1 = x01+(x11-x01)*sy
    return y0 + (y1 - y0) * sz

def fbm3(X, Y, Z, seed, octaves, period0):
    v = np.zeros_like(X); amp = 1.0; tot = 0.0; per = period0
    for o in range(octaves):
        v += amp * vnoise3(X, Y, Z, per, seed + o * 7)
        tot += amp; amp *= 0.5; per *= 2
    return (v / tot) * 2 - 1

def smooth(a, e0, e1):
    t = np.clip((a - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)

def gc(lo1, la1, lo2, la2):
    return np.arccos(np.clip(np.sin(la1)*np.sin(la2) + np.cos(la1)*np.cos(la2)*np.cos(lo2-lo1), -1, 1))

# Inseln + Schollen platzieren (deterministisch, wie gehabt)
rng = np.random.default_rng(SEED)
islands = []
for count, rmin, rmax, nlob in ISLAND_SPECS:
    placed = 0; tries = 0
    while placed < count and tries < 12000:
        tries += 1
        ilon = rng.uniform(-np.pi, np.pi); ilat = rng.uniform(-LAT_BAND, LAT_BAND)
        R = rng.uniform(rmin, rmax)
        if any(gc(ilon, ilat, c[0], c[1]) < (R + c[2]) * 1.25 for c in islands):
            continue
        lobes = [(unit(ilon, ilat), R * 0.8)]
        for _ in range(nlob - 1):
            a = rng.uniform(0, 2*np.pi); d = rng.uniform(0.35, 0.7) * R
            llon = ilon + d*np.cos(a)/max(np.cos(ilat), 0.3); llat = ilat + d*np.sin(a)
            lobes.append((unit(llon, llat), R * rng.uniform(0.5, 0.75)))
        islands.append((ilon, ilat, R, lobes)); placed += 1

floes = []
for _ in range(N_FLOES):
    s = 1 if rng.random() < 0.5 else -1
    floes.append((unit(rng.uniform(-np.pi, np.pi), s*rng.uniform(0.95, ICE_LAT+0.05)), rng.uniform(*FLOE_R)))

def metaballs(X, Y, Z, lobes):
    out = np.zeros_like(X)
    for (v, lr) in lobes:
        a2 = 2.0 * np.clip(1.0 - (X*v[0]+Y*v[1]+Z*v[2]), 0, 2)
        out = np.maximum(out, np.exp(-2.2 * a2 / (lr*lr)))
    return out

# --- Warp + Grundfelder ---
wx = snoise3(px, py, pz, 200, 3, 3.0); wy = snoise3(px, py, pz, 210, 3, 3.0); wz = snoise3(px, py, pz, 220, 3, 3.0)
xw = px + WARP*wx; yw = py + WARP*wy; zw = pz + WARP*wz
nrm = np.sqrt(xw*xw + yw*yw + zw*zw) + 1e-9; xw /= nrm; yw /= nrm; zw /= nrm

coast = snoise3(px, py, pz, 40, 5, 6.0)
depthn = snoise3(px, py, pz, 70, 3, 1.7)        # grossraeumige Ozean-Variation
basinn = snoise3(px, py, pz, 55, 2, 0.9)        # SEHR grossraeumig -> Tiefsee-Becken
polarn = snoise3(px, py, pz, 90, 4, 5.0)
moist = fbm3(px, py, pz, 130, 4, 2.4) * 0.5 + 0.5   # Feuchte -> Vegetation vs. Wueste
mtn   = fbm3(xw, yw, zw, 500, 5, 7.0) * 0.5 + 0.5   # Gebirgs-Detail
grain = fbm3(px, py, pz, 800, 3, 40.0)              # feines Satelliten-Korn (hochfrequent)

shape = np.zeros((H, W))
for (_, _, _, lobes) in islands:
    shape = np.maximum(shape, metaballs(xw, yw, zw, lobes))
shape_c = shape + COAST_NOISE * coast
land = shape_c > LAND

# ============ ALBEDO (Satelliten-Look) ============
col = np.zeros((H, W, 3))

# --- Ozean: glatte Bathymetrie aus dem Inselfeld (KEIN Kuesten-Rauschen -> keine Streifen) ---
bath = np.clip((LAND - shape) / SHELF, 0, 1)               # 0 = an Land .. 1 = offen/tief
shw  = 1.0 - bath                                          # Flachheit: 1 an Kueste, 0 offen Meer
shelf_t = bath                                             # (fuer Hoehenfeld weiter unten)
deepv = np.clip(0.5 + 0.6 * depthn, 0, 1)[...,None]        # grossraeumige Abyss-Variation (dunkel)
ocean = C_ABYSS[None,None,:] * (1 - deepv) + C_DEEP[None,None,:] * deepv
w_sea   = smooth(shw, 0.30, 0.55)[...,None]                # mittleres Wasser
ocean = ocean * (1 - w_sea) + C_SEA[None,None,:] * w_sea
w_shelf = smooth(shw, 0.60, 0.82)[...,None]                # Schelf (tuerkis)
ocean = ocean * (1 - w_shelf) + C_SHELF[None,None,:] * w_shelf
w_shoal = smooth(shw, 0.86, 0.97)[...,None]                # ganz flach an der Kueste
ocean = ocean * (1 - w_shoal) + C_SHOAL[None,None,:] * w_shoal
# Tiefsee-Becken: nur im offenen Ozean (nicht an Schelfen) Richtung sehr dunkel abdunkeln
openmask = (1.0 - smooth(shw, 0.0, 0.30))                  # 1 = offenes Meer, 0 = Schelf/Kueste
trench = smooth(basinn * 0.5 + 0.5, 0.52, 0.86) * openmask
ocean = ocean * (1 - trench[...,None]) + C_TRENCH[None,None,:] * trench[...,None]
col[~land] = ocean[~land]

# --- Land: Biome aus Hoehe + Feuchte + Breite ---
h = np.clip((shape_c - LAND) / 0.45, 0, 1)                  # 0 Kueste .. 1 Inselkern
elev_land = h * (0.55 + 0.45 * mtn)                         # Hoehe mit Gebirgs-Detail
trop = np.clip(1.0 - np.abs(lat) / 0.5, 0, 1)               # 1 am Aequator -> tropisch
# Grundvegetation: trocken<->feucht, tropisch<->gemaessigt
veg = (C_DRY[None,None,:] * (1 - moist[...,None]) + C_VEG[None,None,:] * moist[...,None])
veg = veg * (1 - trop[...,None]) + C_TROP[None,None,:] * trop[...,None]
arid = smooth(0.5 - moist, 0.0, 0.18)[...,None]             # sehr trocken -> Wueste
veg = veg * (1 - arid) + C_DESERT[None,None,:] * arid
# Hoehe schichten: Strand -> Vegetation -> Fels -> Schnee
land_col = np.where(elev_land[...,None] < 0.10, C_BEACH[None,None,:], veg)
rock_t = smooth(elev_land, 0.45, 0.72)[...,None]
land_col = land_col * (1 - rock_t) + C_ROCK[None,None,:] * rock_t
snow_t = smooth(elev_land, 0.80, 0.92)[...,None] * (1.0 - 0.7*trop[...,None])  # am Aequator kaum Schnee
land_col = land_col * (1 - snow_t) + C_PEAK[None,None,:] * snow_t
col[land] = land_col[land]

# --- Eis: Kappen + Schollen, mit blaeulichem Schatten ---
cap = np.abs(lat) > (ICE_LAT - ICE_DYN * np.clip(polarn, -1, 1))
ff = np.zeros((H, W))
for (v, lr) in floes:
    a2 = 2.0 * np.clip(1.0 - (px*v[0]+py*v[1]+pz*v[2]), 0, 2)
    ff = np.maximum(ff, np.exp(-2.2 * a2 / (lr*lr)))
ice = cap | ((ff + 0.18 * coast) > 0.5)
ice_tone = np.clip(0.5 + 0.7 * polarn, 0, 1)[...,None]      # Eis-Struktur
ice_col = C_ICE_SH[None,None,:] + (C_ICE - C_ICE_SH)[None,None,:] * ice_tone
col[ice] = ice_col[ice]

# --- feines Korn ueberall (Satelliten-Textur, sehr subtil) ---
col *= (1.0 + 0.05 * grain[...,None])
col = np.clip(col, 0, 1)
Image.fromarray((col * 255).astype(np.uint8), "RGB").save(OUTFILE)

# ============ HOEHENFELD -> NORMAL-MAP ============
# signiertes Hoehenfeld: 0.5 = Meeresspiegel; Land hoch, Ozean (leicht) tief
elev = np.full((H, W), 0.5)
elev[~land] = 0.5 - 0.06 * shelf_t[~land]                   # Ozeanboden fast flach (Glanz macht den Rest)
elev[land]  = 0.5 + 0.5 * elev_land[land]
elev[ice]   = np.maximum(elev[ice], 0.5 + 0.04)             # Eis leicht erhaben
elev = ndimage.gaussian_filter(elev, sigma=1.0)             # glaetten gegen Treppen

# Gradient (equirektangular: x=lon umlaufend, y=lat). Relief vor allem auf Land.
gy, gx = np.gradient(elev)
relief = 9.0
nx = -gx * relief
ny = -gy * relief
nz = np.ones_like(elev)
ln = np.sqrt(nx*nx + ny*ny + nz*nz) + 1e-9
normal = np.dstack([nx/ln, ny/ln, nz/ln]) * 0.5 + 0.5       # tangent-space, in 0..1
Image.fromarray((normal * 255).astype(np.uint8), "RGB").save(NORMALFILE)

# ============ SPECULAR-MASKE ============
# Ozean glaenzt stark (Sonnen-Glitzer), Eis mittel, Land matt.
spec = np.full((H, W), 0.06)
spec[~land] = 0.85
spec[ice]   = 0.35
spec = ndimage.gaussian_filter(spec, sigma=0.8)
Image.fromarray((np.clip(spec,0,1) * 255).astype(np.uint8), "L").save(SPECFILE)

# ============ Wolken (unveraendert) ============
craw = fbm3(px, py, pz, 300, 4, 6) * 0.5 + 0.5
cloud = smooth(craw, 1 - CLOUD_COVER, 1 - CLOUD_COVER + 0.13)
calpha = (cloud * CLOUD_ALPHA * 255).astype(np.uint8)
white = np.full((H, W), 255, np.uint8)
Image.fromarray(np.dstack([white, white, white, calpha]), "RGBA").save(CLOUDFILE)

# ============ Stroemungs-Flowmap (unveraendert, Stil 3) ============
psi = np.zeros((H, W))
rng2 = np.random.default_rng(SEED + 99)
for (ilon, ilat, R, lobes) in islands:
    sgn = 1.0 if rng2.random() < 0.5 else -1.0
    d = gc(lon, lat, ilon, ilat)
    psi += sgn * (R / 0.14) * np.exp(-(d * d) / (0.42 ** 2))
dN, dS = np.pi/2 - lat, np.pi/2 + lat
psi += 1.3 * np.exp(-(dN * dN) / (0.55 ** 2))
psi += -1.3 * np.exp(-(dS * dS) / (0.55 ** 2))
gj, gi = np.gradient(psi)
fx = -gj + 0.5
fy = gi
fln = np.sqrt(fx*fx + fy*fy) + 1e-6
fx, fy = fx/fln, fy/fln
fx[land], fy[land] = 0, 0
spd = np.ones((H, W))
flow = np.dstack([(fx*0.5+0.5)*255, (fy*0.5+0.5)*255, spd*255]).astype(np.uint8)
Image.fromarray(flow, "RGB").save(FLOWFILE)

print("gespeichert:", os.path.normpath(OUTFILE))
print("  + world_normal.png, world_spec.png, clouds.png, flow.png", (W, H),
      "| Inseln:", len(islands), "| Schollen:", len(floes))
