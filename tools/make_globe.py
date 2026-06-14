"""Erzeugt eine rotierende Weltkugel als PNG-Frame-Sequenz (transparenter Hintergrund).
Aufruf:  python tools/make_globe.py
Ausgabe: assets/images/entities/scene1/globe/frame_00.png ... (+ weltkugel.png als Standbild)

- Inseln in einem Aequatorguertel (max 1/3 der Welt), rund um die ganze Kugel verteilt
- fleckige Tiefseebecken (Teilbereiche tiefer/dunkler)
- dynamische, ausgefranste Polkappen + vereinzelte kleine Eisschollen
- N_FRAMES Einzelbilder fuer eine volle Umdrehung (in app.js als Loop abgespielt)
Stellschrauben siehe KONFIG.
"""
import numpy as np
from PIL import Image
import os

# =================== KONFIG ===================
SS = 680               # Render-Aufloesung pro Frame (wird auf FRAME_OUT verkleinert)
FRAME_OUT = 340        # Ausgabegroesse pro Frame (px)
N_FRAMES = 48          # Bilder fuer eine volle Umdrehung (mehr = fluessiger, groesser)
SEED = 7

# (Anzahl, R-min, R-max, Lappen) in Bogenmass. Grosse <= mittlere -> keine Riesen-Inseln.
ISLAND_SPECS = [
    (4, 0.12, 0.16, 2),    # "grosse" (auf mittlere Groesse gedeckelt)
    (3, 0.12, 0.16, 2),    # mittlere
    (8, 0.045, 0.075, 1),  # sehr kleine
]
LAT_BAND = 0.50        # Inselzentren nur +-0.50 rad (~28.6 Grad) -> Guertel < 1/3 der Welt
COAST_NOISE = 0.22     # Fransigkeit der Kuesten
LAND = 0.45            # Schwelle Land vs. Meer
SHELF = 0.30           # Breite des hellen Flachwassersaums

ICE_LAT = 1.28         # mittlere Eisgrenze (rad, ~73 Grad) -> kleine Kappen
ICE_DYN = 0.26         # wie stark der Eisrand schwankt (ausgefranst statt linear)
N_FLOES = 16           # vereinzelte Eisschollen nahe der Kappen
FLOE_R = (0.03, 0.06)  # Schollen-Radius (<= kleinste Inseln)

# Farben (RGB 0..255)
C_SHOAL = np.array([ 66, 130, 162]) / 255
C_SEA   = np.array([ 26,  78, 140]) / 255
C_ABYSS = np.array([  5,  22,  62]) / 255   # Tiefsee (dunkel)
C_BEACH = np.array([208, 198, 150]) / 255
C_LOW   = np.array([ 72, 140,  74]) / 255
C_HIGH  = np.array([122, 150,  92]) / 255
C_ICE   = np.array([238, 244, 250]) / 255
RIMCOL  = np.array([110, 155, 215]) / 255

OUTDIR  = os.path.join(os.path.dirname(__file__), "..", "assets", "images", "entities", "scene1", "globe")
STILL   = os.path.join(os.path.dirname(__file__), "..", "assets", "images", "entities", "scene1", "weltkugel.png")
# ==============================================

# --- Bildscheibe: -1..1, y nach oben ---
yy, xx = np.mgrid[0:SS, 0:SS]
x = (xx + 0.5) / SS * 2 - 1
y = 1 - (yy + 0.5) / SS * 2
r2 = x * x + y * y
inside = r2 <= 1.0
z = np.sqrt(np.clip(1 - r2, 0, 1))            # Kugel-Tiefe (Bildraum, fuer Licht)
rr = np.sqrt(r2)

# festes Licht im Bildraum (Kugel dreht sich darunter durch)
L = np.array([-0.5, 0.6, 0.75]); L = L / np.linalg.norm(L)
diff = np.clip(x * L[0] + y * L[1] + z * L[2], 0, 1)[..., None]
rim = (np.clip(1 - z, 0, 1) ** 4)[..., None]

def unit(lon, lat):
    return np.array([np.cos(lat) * np.sin(lon), np.sin(lat), np.cos(lat) * np.cos(lon)])

def snoise3(X, Y, Z, seed, octaves, base_freq):
    """Glattes, nahtloses 3D-Noise (Summe sinusoidaler Wellen) -> kein Naht-Problem beim Drehen."""
    rng = np.random.default_rng(seed)
    val = np.zeros_like(X); amp = 1.0; tot = 0.0; f = base_freq
    for _ in range(octaves):
        d = rng.normal(size=3); d /= np.linalg.norm(d)
        ph = rng.uniform(0, 2 * np.pi)
        val += amp * np.sin(f * (d[0] * X + d[1] * Y + d[2] * Z) + ph)
        tot += amp; amp *= 0.6; f *= 1.9
    return val / tot

# --- Inseln EINMAL platzieren (volle 360 Grad lon, Aequatorguertel) ---
def gc(lo1, la1, lo2, la2):
    return np.arccos(np.clip(np.sin(la1) * np.sin(la2)
                             + np.cos(la1) * np.cos(la2) * np.cos(lo2 - lo1), -1, 1))

rng = np.random.default_rng(SEED)
islands = []
for count, rmin, rmax, nlob in ISLAND_SPECS:
    placed = 0; tries = 0
    while placed < count and tries < 12000:
        tries += 1
        ilon = rng.uniform(-np.pi, np.pi)
        ilat = rng.uniform(-LAT_BAND, LAT_BAND)
        R = rng.uniform(rmin, rmax)
        if any(gc(ilon, ilat, c[0], c[1]) < (R + c[2]) * 1.25 for c in islands):
            continue
        lobes = [(unit(ilon, ilat), R * 0.8)]
        for _ in range(nlob - 1):
            a = rng.uniform(0, 2 * np.pi); d = rng.uniform(0.35, 0.7) * R
            llon = ilon + d * np.cos(a) / max(np.cos(ilat), 0.3)
            llat = ilat + d * np.sin(a)
            lobes.append((unit(llon, llat), R * rng.uniform(0.5, 0.75)))
        islands.append((ilon, ilat, R, lobes))
        placed += 1

# --- Eisschollen platzieren (nahe Kappen, beide Hemisphaeren) ---
floes = []
for _ in range(N_FLOES):
    s = 1 if rng.random() < 0.5 else -1
    flat = s * rng.uniform(0.95, ICE_LAT + 0.05)
    flon = rng.uniform(-np.pi, np.pi)
    floes.append((unit(flon, flat), rng.uniform(*FLOE_R)))

def metaballs(xr, yr, zr, lobes):
    out = np.zeros_like(xr)
    for (v, lr) in lobes:
        dot = xr * v[0] + yr * v[1] + zr * v[2]
        a2 = 2.0 * np.clip(1.0 - dot, 0, 2)          # ~ Winkel^2 (Sehnen-Naeherung)
        out = np.maximum(out, np.exp(-2.2 * a2 / (lr * lr)))
    return out

def render(theta):
    ct, st = np.cos(theta), np.sin(theta)
    xr = x * ct + z * st                              # Welt um y-Achse gedreht
    zr = -x * st + z * ct
    yr = y
    lat = np.arcsin(np.clip(yr, -1, 1))

    coast  = snoise3(xr, yr, zr, 40, 5, 6.0)
    depthn = snoise3(xr, yr, zr, 70, 3, 1.7)
    polarn = snoise3(xr, yr, zr, 90, 4, 5.0)

    shape = np.zeros((SS, SS))
    for (_, _, _, lobes) in islands:
        shape = np.maximum(shape, metaballs(xr, yr, zr, lobes))
    shape_c = shape + COAST_NOISE * coast
    land = shape_c > LAND

    col = np.zeros((SS, SS, 3))
    # Meer: schmaler Kuestensaum, dahinter FLECKIGE Tiefe (Teilbereiche dunkler)
    shelf_t = np.clip((LAND - shape_c) / SHELF, 0, 1)
    shallow = np.clip(shelf_t / 0.4, 0, 1)[..., None]
    basin = np.clip(0.5 + 0.7 * depthn, 0, 1)[..., None]
    offshore = np.clip((shelf_t - 0.4) / 0.6, 0, 1)[..., None]
    sea_shallow = C_SHOAL + (C_SEA - C_SHOAL) * shallow
    sea_deep = C_SEA + (C_ABYSS - C_SEA) * basin
    ocean = sea_shallow * (1 - offshore) + sea_deep * offshore
    col[~land] = ocean[~land]
    # Land
    h = np.clip((shape_c - LAND) / 0.45, 0, 1)[..., None]
    land_col = np.where(h < 0.12, C_BEACH, C_LOW + (C_HIGH - C_LOW) * h)
    col[land] = land_col[land]

    # Eis: dynamische Kappe (ausgefranst) + vereinzelte Schollen
    cap = np.abs(lat) > (ICE_LAT - ICE_DYN * np.clip(polarn, -1, 1))
    floe_field = np.zeros((SS, SS))
    for (v, lr) in floes:
        dot = xr * v[0] + yr * v[1] + zr * v[2]
        a2 = 2.0 * np.clip(1.0 - dot, 0, 2)
        floe_field = np.maximum(floe_field, np.exp(-2.2 * a2 / (lr * lr)))
    ice = cap | ((floe_field + 0.18 * coast) > 0.5)

    col[ice] = C_ICE

    # Beleuchtung (fest) + Eis hell halten + Rim
    col = col * (0.30 + 0.88 * diff)
    col[ice] = np.clip(C_ICE * (0.72 + 0.42 * diff), 0, 1)[ice]
    col = col + rim * RIMCOL * 0.30
    col = np.clip(col, 0, 1)

    alpha = np.where(inside, 1.0, 0.0)
    halo = np.exp(-((rr - 1.0) / 0.045) ** 2) * 0.45
    halo[inside] = 0
    rgb = np.where(inside[..., None], col, RIMCOL)
    alpha = np.clip(alpha + halo, 0, 1)
    img = np.dstack([(rgb * 255).astype(np.uint8), (alpha * 255).astype(np.uint8)])
    return Image.fromarray(img, "RGBA").resize((FRAME_OUT, FRAME_OUT), Image.LANCZOS)

# --- alle Frames rendern ---
os.makedirs(OUTDIR, exist_ok=True)
for i in range(N_FRAMES):
    theta = 2 * np.pi * i / N_FRAMES
    frame = render(theta)
    frame.save(os.path.join(OUTDIR, f"frame_{i:02d}.png"))
    if i == 0:
        frame.save(STILL)
    print(f"\rFrame {i+1}/{N_FRAMES}", end="", flush=True)
print(f"\nfertig: {N_FRAMES} Frames in {os.path.normpath(OUTDIR)} | Inseln: {len(islands)} | Schollen: {len(floes)}")
