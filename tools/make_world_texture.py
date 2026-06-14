"""Erzeugt eine equirectangulare Weltkarten-Textur (2:1) fuer die WebGL-Kugel.
Aufruf:  python tools/make_world_texture.py
Ausgabe: assets/images/entities/scene1/world.png  (Albedo, OHNE Beleuchtung)

Die Beleuchtung macht WebGL zur Laufzeit -> hier nur die Grundfarben (Land/Meer/Eis/Wolken).
Inselplatzierung/Look wie gehabt (Metaballs, Aequatorguertel, fleckige Tiefe, Eis+Schollen, Wolken).
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
LAT_BAND = 0.22        # enger -> Inseln staerker um den Aequator
COAST_NOISE = 0.32     # mehr Kuesten-Fransigkeit (realistischer)
WARP = 0.28            # staerkere organische Verformung
LAND = 0.45
SHELF = 0.30

ICE_LAT = 1.02         # niedriger -> groessere, klar sichtbare Polkappen (~58 Grad)
ICE_DYN = 0.16         # weniger Schwankung -> Kappe nicht zu loechrig
N_FLOES = 16
FLOE_R = (0.03, 0.06)
CLOUD_COVER = 0.42     # Bedeckung; mit kleiner Frequenz -> kleine, gestreute Wolken
CLOUD_ALPHA = 0.85     # max Deckkraft der separaten Wolkenschicht

C_SHOAL = np.array([ 66, 130, 162]) / 255
C_SEA   = np.array([ 26,  78, 140]) / 255
C_ABYSS = np.array([ 28,  68, 118]) / 255
C_BEACH = np.array([208, 198, 150]) / 255
C_LOW   = np.array([ 72, 140,  74]) / 255
C_HIGH  = np.array([122, 150,  92]) / 255
C_ICE   = np.array([238, 244, 250]) / 255

COAST_PX = 55          # Breite der Kuesten-Ablenkungszone (px) fuer die Stroemung
OUTFILE = os.path.join(os.path.dirname(__file__), "..", "assets", "images", "entities", "scene1", "world.png")
CLOUDFILE = os.path.join(os.path.dirname(__file__), "..", "assets", "images", "entities", "scene1", "clouds.png")
FLOWFILE = os.path.join(os.path.dirname(__file__), "..", "assets", "images", "entities", "scene1", "flow.png")
# ==============================================

# equirectangulares Gitter -> 3D-Punkte auf der Einheitskugel
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

# Inseln + Schollen platzieren (deterministisch)
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

# --- Warp + Felder ---
wx = snoise3(px, py, pz, 200, 3, 3.0); wy = snoise3(px, py, pz, 210, 3, 3.0); wz = snoise3(px, py, pz, 220, 3, 3.0)
xw = px + WARP*wx; yw = py + WARP*wy; zw = pz + WARP*wz
nrm = np.sqrt(xw*xw + yw*yw + zw*zw) + 1e-9; xw /= nrm; yw /= nrm; zw /= nrm

coast = snoise3(px, py, pz, 40, 5, 6.0)
depthn = snoise3(px, py, pz, 70, 3, 1.7)
polarn = snoise3(px, py, pz, 90, 4, 5.0)

shape = np.zeros((H, W))
for (_, _, _, lobes) in islands:
    shape = np.maximum(shape, metaballs(xw, yw, zw, lobes))
shape_c = shape + COAST_NOISE * coast
land = shape_c > LAND

col = np.zeros((H, W, 3))
shelf_t = np.clip((LAND - shape_c) / SHELF, 0, 1)
shallow = np.clip(shelf_t / 0.4, 0, 1)[..., None]
basin = np.clip(0.5 + 0.7 * depthn, 0, 1)[..., None]
offshore = np.clip((shelf_t - 0.4) / 0.6, 0, 1)[..., None]
ocean = (C_SHOAL + (C_SEA - C_SHOAL) * shallow) * (1 - offshore) + (C_SEA + (C_ABYSS - C_SEA) * basin) * offshore
col[~land] = ocean[~land]
h = np.clip((shape_c - LAND) / 0.45, 0, 1)[..., None]
land_col = np.where(h < 0.12, C_BEACH, C_LOW + (C_HIGH - C_LOW) * h)
col[land] = land_col[land]

cap = np.abs(lat) > (ICE_LAT - ICE_DYN * np.clip(polarn, -1, 1))
ff = np.zeros((H, W))
for (v, lr) in floes:
    a2 = 2.0 * np.clip(1.0 - (px*v[0]+py*v[1]+pz*v[2]), 0, 2)
    ff = np.maximum(ff, np.exp(-2.2 * a2 / (lr*lr)))
ice = cap | ((ff + 0.18 * coast) > 0.5)
col[ice] = C_ICE

# Oberflaeche OHNE Wolken speichern (kraeftige Albedo; Beleuchtung macht WebGL)
col = np.clip(col, 0, 1)
Image.fromarray((col * 255).astype(np.uint8), "RGB").save(OUTFILE)

# Separate Wolkenschicht (RGBA: weiss + Alpha) -> zieht in app.js eigenstaendig ueber den Globus
craw = fbm3(px, py, pz, 300, 4, 6) * 0.5 + 0.5   # kleinere Wolkenfetzen
cloud = smooth(craw, 1 - CLOUD_COVER, 1 - CLOUD_COVER + 0.13)
calpha = (cloud * CLOUD_ALPHA * 255).astype(np.uint8)
white = np.full((H, W), 255, np.uint8)
Image.fromarray(np.dstack([white, white, white, calpha]), "RGBA").save(CLOUDFILE)

# --- Stroemungs-Flowmap: globale Stroemung, an Kuesten tangential um Inseln abgelenkt ---
D = ndimage.distance_transform_edt(~land)              # Abstand zu Land (px, in Wasser)
gy, gx = np.gradient(D)                                # Gradient zeigt von Land weg
gn = np.sqrt(gx*gx + gy*gy) + 1e-6
nx, ny = gx/gn, gy/gn                                  # Kuestennormale (von Land weg)
# globale Grundstroemung: Baender entlang Breitengrad + sanfter Maeander
gxf = np.cos(lat * 3.0)
gyf = 0.35 * np.sin(lon * 4.0)
gl = np.sqrt(gxf*gxf + gyf*gyf) + 1e-6
gxf, gyf = gxf/gl, gyf/gl
into = np.minimum(gxf*nx + gyf*ny, 0.0)                # Komponente, die ins Land zeigt
defx, defy = gxf - into*nx, gyf - into*ny              # diese entfernen -> tangential zur Kueste
w = np.clip(D / COAST_PX, 0, 1)
fx = defx*(1-w) + gxf*w                                # nahe Kueste abgelenkt, weit weg global
fy = defy*(1-w) + gyf*w
fln = np.sqrt(fx*fx + fy*fy) + 1e-6
fx, fy = fx/fln, fy/fln
fx[land], fy[land] = 0, 0
spd = np.clip(1.0 - w*0.4, 0.55, 1.0)                  # an Kueste (eng) etwas schneller
flow = np.dstack([(fx*0.5+0.5)*255, (fy*0.5+0.5)*255, spd*255]).astype(np.uint8)
Image.fromarray(flow, "RGB").save(FLOWFILE)

print("gespeichert:", os.path.normpath(OUTFILE), "+ clouds.png + flow.png", (W, H),
      "| Inseln:", len(islands), "| Schollen:", len(floes))
