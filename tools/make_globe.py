"""Erzeugt eine rotierende Weltkugel als PNG-Frame-Sequenz (transparenter Hintergrund).
Aufruf:  python tools/make_globe.py
Ausgabe: assets/images/entities/scene1/globe/frame_00.png ... (+ weltkugel.png als Standbild)

Realismus:
- Inseln aus fraktalem Hoehenfeld (zerklueftete Kuesten) im Aequatorguertel
- echte Bathymetrie (Schelf hell -> Tiefsee dunkel) + Sonnenglanz auf dem Wasser
- dynamische, ausgefranste Polkappen + vereinzelte kleine Eisschollen
- halbtransparente Wolkenschicht mit weichem Schlagschatten
- N_FRAMES Einzelbilder fuer eine volle Umdrehung (in app.js als Loop)
Stellschrauben siehe KONFIG.
"""
import numpy as np
from PIL import Image
import os

# =================== KONFIG ===================
SS = 600               # Render-Aufloesung pro Frame
FRAME_OUT = 320        # Ausgabegroesse pro Frame (px)
N_FRAMES = 96          # Bilder fuer eine volle Umdrehung (mehr = fluessiger/langsamer wirkend)
SEED = 7

# (Anzahl, R-min, R-max, Lappen) Bogenmass: grobe Landmaske, Kueste formt das Terrain-Noise.
ISLAND_SPECS = [
    (4, 0.16, 0.20, 2),
    (3, 0.16, 0.20, 2),
    (8, 0.06, 0.10, 1),
]
LAT_BAND = 0.31        # Guertel ~1/5 der Welt
WARP = 0.20            # Domain-Warp (organische Verformung)
TERRAIN_AMP = 0.22     # Staerke der fraktalen Kuesten-Zerkluefterung
LAND = 0.40            # Meeresspiegel-Schwelle
SHELF = 0.30           # Tiefen-Skala fuers Meer

ICE_LAT = 1.28
ICE_DYN = 0.26
N_FLOES = 16
FLOE_R = (0.03, 0.06)

CLOUD_COVER = 0.45     # 0..1 wie viel Himmel bedeckt ist (hoeher = mehr Wolken)
CLOUD_SHADOW = 0.18    # Staerke des Wolken-Schlagschattens
SPEC_STR = 0.42        # Staerke des Sonnenglanzes auf dem Wasser

# Farben (RGB 0..255)
C_SHELF  = np.array([ 78, 150, 180]) / 255   # Flachwasser/Schelf
C_SEA    = np.array([ 42,  98, 158]) / 255   # offenes Meer
C_DEEP   = np.array([ 26,  64, 116]) / 255   # Tiefsee (hell genug)
C_TRENCH = np.array([ 16,  44,  88]) / 255   # Graeben
C_BEACH  = np.array([208, 198, 150]) / 255
C_LOW    = np.array([ 70, 138,  72]) / 255
C_HIGH   = np.array([120, 148,  90]) / 255
C_ROCK   = np.array([135, 125, 110]) / 255
C_SNOW   = np.array([236, 240, 244]) / 255
C_ICE    = np.array([238, 244, 250]) / 255
RIMCOL   = np.array([110, 155, 215]) / 255

OUTDIR = os.path.join(os.path.dirname(__file__), "..", "assets", "images", "entities", "scene1", "globe")
STILL  = os.path.join(os.path.dirname(__file__), "..", "assets", "images", "entities", "scene1", "weltkugel.png")
# ==============================================

yy, xx = np.mgrid[0:SS, 0:SS]
x = (xx + 0.5) / SS * 2 - 1
y = 1 - (yy + 0.5) / SS * 2
r2 = x * x + y * y
inside = r2 <= 1.0
z = np.sqrt(np.clip(1 - r2, 0, 1))
rr = np.sqrt(r2)

# festes Licht + Betrachter (Kugel dreht sich darunter durch)
L = np.array([-0.5, 0.6, 0.75]); L = L / np.linalg.norm(L)
V = np.array([0.0, 0.0, 1.0])
H = L + V; H = H / np.linalg.norm(H)            # Halfway-Vektor fuer Specular
diff_s = np.clip(x * L[0] + y * L[1] + z * L[2], 0, 1)
diff = diff_s[..., None]
rim = (np.clip(1 - z, 0, 1) ** 4)[..., None]
spec = np.clip(x * H[0] + y * H[1] + z * H[2], 0, 1) ** 110  # Sonnenglanz-Form (eng)

def unit(lon, lat):
    return np.array([np.cos(lat) * np.sin(lon), np.sin(lat), np.cos(lat) * np.cos(lon)])

def snoise3(X, Y, Z, seed, octaves, base_freq):
    """Glattes, nahtloses fraktales 3D-Noise (Summe sinusoidaler Wellen)."""
    rng = np.random.default_rng(seed)
    val = np.zeros_like(X); amp = 1.0; tot = 0.0; f = base_freq
    for _ in range(octaves):
        d = rng.normal(size=3); d /= np.linalg.norm(d)
        ph = rng.uniform(0, 2 * np.pi)
        val += amp * np.sin(f * (d[0] * X + d[1] * Y + d[2] * Z) + ph)
        tot += amp; amp *= 0.6; f *= 1.95
    return val / tot

def vnoise3(X, Y, Z, period, seed):
    """Isotropes 3D-Value-Noise (trilinear) -> klumpig & nahtlos auf der Kugel."""
    rng = np.random.default_rng(seed)
    g = rng.random((period + 2, period + 2, period + 2))
    fx = (X * 0.5 + 0.5) * period; fy = (Y * 0.5 + 0.5) * period; fz = (Z * 0.5 + 0.5) * period
    ix = np.clip(np.floor(fx).astype(np.int32), 0, period)
    iy = np.clip(np.floor(fy).astype(np.int32), 0, period)
    iz = np.clip(np.floor(fz).astype(np.int32), 0, period)
    tx = fx - ix; ty = fy - iy; tz = fz - iz
    sx = tx * tx * (3 - 2 * tx); sy = ty * ty * (3 - 2 * ty); sz = tz * tz * (3 - 2 * tz)
    def G(dz, dy, dx): return g[iz + dz, iy + dy, ix + dx]
    x00 = G(0,0,0) + (G(0,0,1) - G(0,0,0)) * sx
    x10 = G(0,1,0) + (G(0,1,1) - G(0,1,0)) * sx
    x01 = G(1,0,0) + (G(1,0,1) - G(1,0,0)) * sx
    x11 = G(1,1,0) + (G(1,1,1) - G(1,1,0)) * sx
    y0 = x00 + (x10 - x00) * sy; y1 = x01 + (x11 - x01) * sy
    return y0 + (y1 - y0) * sz                       # 0..1

def fbm3(X, Y, Z, seed, octaves, period0):
    """Fraktales Value-Noise -> -1..1."""
    v = np.zeros_like(X); amp = 1.0; tot = 0.0; per = period0
    for o in range(octaves):
        v += amp * vnoise3(X, Y, Z, per, seed + o * 7)
        tot += amp; amp *= 0.5; per *= 2
    return (v / tot) * 2 - 1

def smooth(a, e0, e1):
    t = np.clip((a - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)

def gc(lo1, la1, lo2, la2):
    return np.arccos(np.clip(np.sin(la1) * np.sin(la2)
                             + np.cos(la1) * np.cos(la2) * np.cos(lo2 - lo1), -1, 1))

# --- Inseln + Eisschollen einmal platzieren ---
rng = np.random.default_rng(SEED)
islands = []
for count, rmin, rmax, nlob in ISLAND_SPECS:
    placed = 0; tries = 0
    while placed < count and tries < 12000:
        tries += 1
        ilon = rng.uniform(-np.pi, np.pi); ilat = rng.uniform(-LAT_BAND, LAT_BAND)
        R = rng.uniform(rmin, rmax)
        if any(gc(ilon, ilat, c[0], c[1]) < (R + c[2]) * 1.2 for c in islands):
            continue
        lobes = [(unit(ilon, ilat), R * 0.85)]
        for _ in range(nlob - 1):
            a = rng.uniform(0, 2 * np.pi); d = rng.uniform(0.35, 0.7) * R
            llon = ilon + d * np.cos(a) / max(np.cos(ilat), 0.3); llat = ilat + d * np.sin(a)
            lobes.append((unit(llon, llat), R * rng.uniform(0.55, 0.8)))
        islands.append((ilon, ilat, R, lobes)); placed += 1

floes = []
for _ in range(N_FLOES):
    s = 1 if rng.random() < 0.5 else -1
    floes.append((unit(rng.uniform(-np.pi, np.pi), s * rng.uniform(0.95, ICE_LAT + 0.05)),
                  rng.uniform(*FLOE_R)))

def metaballs(X, Y, Z, lobes):
    out = np.zeros_like(X)
    for (v, lr) in lobes:
        a2 = 2.0 * np.clip(1.0 - (X * v[0] + Y * v[1] + Z * v[2]), 0, 2)
        out = np.maximum(out, np.exp(-2.2 * a2 / (lr * lr)))
    return out

def render(theta):
    ct, st = np.cos(theta), np.sin(theta)
    xr = x * ct + z * st; zr = -x * st + z * ct; yr = y
    lat = np.arcsin(np.clip(yr, -1, 1))

    # Domain-Warp -> organische Grundform
    wx = snoise3(xr, yr, zr, 200, 3, 3.0)
    wy = snoise3(xr, yr, zr, 210, 3, 3.0)
    wz = snoise3(xr, yr, zr, 220, 3, 3.0)
    xw = xr + WARP * wx; yw = yr + WARP * wy; zw = zr + WARP * wz
    nrm = np.sqrt(xw * xw + yw * yw + zw * zw) + 1e-9
    xw /= nrm; yw /= nrm; zw /= nrm

    base = np.zeros((SS, SS))                       # grobe Landmaske aus Inseln
    for (_, _, _, lobes) in islands:
        base = np.maximum(base, metaballs(xw, yw, zw, lobes))

    terrain = fbm3(xw, yw, zw, 50, 6, 3)            # isotropes Detail -> zerklueftete Kueste
    elev = base + TERRAIN_AMP * terrain             # "Hoehe"
    land = elev > LAND

    depthvar = snoise3(xr, yr, zr, 70, 3, 1.6)
    polarn = snoise3(xr, yr, zr, 90, 4, 5.0)

    col = np.zeros((SS, SS, 3))

    # --- Meer: Bathymetrie (Schelf -> Tiefsee -> Graeben), fleckige Tiefe ---
    depth = np.clip((LAND - elev) / SHELF + 0.18 * depthvar, 0, 2)[..., None]
    t1 = smooth(depth, 0.0, 0.10)        # schmaler Schelf -> offenes Meer
    t2 = smooth(depth, 0.10, 0.6)        # offenes Meer -> Tiefsee
    t3 = smooth(depth, 0.6, 1.2)         # Tiefsee -> Graben
    ocean = C_SHELF + (C_SEA - C_SHELF) * t1
    ocean = ocean + (C_DEEP - C_SEA) * t2
    ocean = ocean + (C_TRENCH - C_DEEP) * t3
    col[~land] = ocean[~land]

    # --- Land: Hoehe -> Strand/Gruen/Fels/Schnee ---
    h = np.clip((elev - LAND) / 0.6, 0, 1)[..., None]
    lc = C_BEACH + (C_LOW - C_BEACH) * smooth(h, 0.0, 0.10)
    lc = lc + (C_HIGH - C_LOW) * smooth(h, 0.10, 0.60)
    lc = lc + (C_ROCK - C_HIGH) * smooth(h, 0.60, 1.0)   # kein Schnee am Aequator
    col[land] = lc[land]

    # --- Eis: dynamische Kappen + Schollen ---
    cap = np.abs(lat) > (ICE_LAT - ICE_DYN * np.clip(polarn, -1, 1))
    ff = np.zeros((SS, SS))
    for (v, lr) in floes:
        a2 = 2.0 * np.clip(1.0 - (xr * v[0] + yr * v[1] + zr * v[2]), 0, 2)
        ff = np.maximum(ff, np.exp(-2.2 * a2 / (lr * lr)))
    ice = cap | ((ff + 0.18 * terrain) > 0.55)
    col[ice] = C_ICE

    # --- Beleuchtung ---
    col = col * (0.28 + 0.90 * diff)
    col[ice] = np.clip(C_ICE * (0.72 + 0.42 * diff), 0, 1)[ice]
    # Sonnenglanz nur auf Wasser (nicht Land/Eis), nur Tagseite
    water = (~land) & (~ice)
    glint = (spec * SPEC_STR * diff_s)[..., None]
    col = np.where(water[..., None], np.clip(col + glint, 0, 1), col)

    # --- Wolken (eigene Schicht, rotiert mit) + Schlagschatten ---
    craw = fbm3(xr, yr, zr, 300, 5, 3) * 0.5 + 0.5
    cloud = smooth(craw, 1 - CLOUD_COVER, 1 - CLOUD_COVER + 0.18)
    # Schatten: Wolkenmaske leicht in Lichtrichtung versetzt -> dunkelt Oberflaeche
    sh = max(1, int(SS * 0.012))
    shadow = np.roll(np.roll(cloud, sh, axis=0), sh, axis=1)
    col = col * (1 - CLOUD_SHADOW * shadow[..., None] * (~ice)[..., None])
    cloud_col = np.clip((0.6 + 0.45 * diff) * np.array([1.0, 1.0, 1.0]), 0, 1)
    ca = (cloud * 0.9 * (0.35 + 0.65 * diff_s))[..., None]   # Wolken auf Nachtseite schwaecher
    col = col * (1 - ca) + cloud_col * ca

    # --- Rim + Alpha + Halo ---
    col = np.clip(col + rim * RIMCOL * 0.28, 0, 1)
    alpha = np.where(inside, 1.0, 0.0)
    halo = np.exp(-((rr - 1.0) / 0.045) ** 2) * 0.45
    halo[inside] = 0
    rgb = np.where(inside[..., None], col, RIMCOL)
    alpha = np.clip(alpha + halo, 0, 1)
    img = np.dstack([(rgb * 255).astype(np.uint8), (alpha * 255).astype(np.uint8)])
    return Image.fromarray(img, "RGBA").resize((FRAME_OUT, FRAME_OUT), Image.LANCZOS)

os.makedirs(OUTDIR, exist_ok=True)
for i in range(N_FRAMES):
    frame = render(2 * np.pi * i / N_FRAMES)
    frame.save(os.path.join(OUTDIR, f"frame_{i:02d}.png"))
    if i == 0:
        frame.save(STILL)
    print(f"\rFrame {i+1}/{N_FRAMES}", end="", flush=True)
print(f"\nfertig: {N_FRAMES} Frames | Inseln: {len(islands)} | Schollen: {len(floes)}")
