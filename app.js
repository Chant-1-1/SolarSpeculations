/* =========================================================================
   SolarSpeculations - index.html Engine
   p5.js (Rendering/Entities/Trajektorien) + Tone.js (Ambient/Reverb-Busse)
   Inhalt liegt komplett in data/*.json - dieser Code rendert nur.
   Laeuft auch ohne Assets: fehlende Bilder -> Platzhalter-Form, fehlende
   Sounds -> Stille.
   ========================================================================= */

// ---- globaler Zustand --------------------------------------------------
let scenesData = null;
let entitiesData = null;
let scenes = [];          // Szenen inkl. geladenem Hintergrundbild
let allEntities = [];     // alle Entity-Instanzen
let currentScene = 0;
let nextScene = -1;       // Ziel waehrend Crossfade, sonst -1
let sceneFade = 1;        // 0..1 Crossfade-Fortschritt zur neuen Szene
const SCENE_FADE_SPEED = 0.6; // pro Sekunde

// Zoom-Uebergang Scene 2 <-> Scene 3 (Station-Aussenansicht -> Innenraum)
let zoomTransition = false;
let zoomProgress = 0;
let zoomDirection = 1;        // +1 = rein (sea->interior), -1 = raus (interior->sea)
const ZOOM_DURATION = 2.2;    // Sekunden (laenger als normaler Crossfade)
const ZOOM_MAX_SCALE = 8.3;   // Endvergroesserung
const ZOOM_TARGET_X = 0.49;    // Zoom-Zentrum horizontal (Mitte)
const ZOOM_TARGET_Y = 0.27;   // Zoom-Zentrum vertikal (Stationskuppel)
function easeInOutCubic(t) { return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3) / 2; }
// Quelle der Wahrheit fuer die Zoom-Transition: szenenbezogene IDs. Indizes werden in
// buildWorld() aus diesen IDs aufgeloest -> Reihenfolge in scenes.json kann sich aendern,
// ohne dass die Zoom-Logik (Backdrop-Skalierung, Entity-Mitskalierung, Crossfade, goToScene) bricht.
const ZOOM_SEA_ID = 'scene2';
const ZOOM_INTERIOR_ID = 'scene3';
let zoomSeaIndex = -1;
let zoomInteriorIndex = -1;

// Generalisierte Zoom-Parameter (werden je Uebergang in goToScene gesetzt). Defaults = Station-Zoom 2<->3.
// zoomPivotIndex = die Szene, die SKALIERT wird (Sea bzw. Weltkugel-Szene); die Zielszene blendet ein.
let zoomPivotIndex = -1;
let zoomTargetX = ZOOM_TARGET_X;
let zoomTargetY = ZOOM_TARGET_Y;
let zoomMaxScale = ZOOM_MAX_SCALE;

// ===== ZOOM Weltkugel (Szene 1) <-> ATMOSPHERE / WATER (zwei Zoom-Ansichten) =====
const SPACE_ID = 'scene1';        // die Weltkugel-/Weltraum-Szene (Pivot beim Zoom)
const ATMO_ID = 'atmosphere';     // Erd-Rand + obere Schichten
const WATER_ID = 'water';         // Berg + Wasser (Querschnitt)
let spaceIndex = -1;
let atmosphereIndex = -1;
let waterIndex = -1;
const SECTION_ZOOM_SCALE = 9.5;   // Endvergroesserung beim Rein-Zoomen in die Kugel
const RIM_MARK_K = 0.98;          // Oberrand-Marker: Anteil des Radius ueber der Kugelmitte
let atmoSpin = 0;                 // eigene, langsame Rotation des Erd-Limbs in der Atmosphaeren-Szene
const ATMO_SPIN_VEL = 0.045;      // rad/s (langsam)
let atmoRenderTick = 0;           // Drossel: Erd-Rand nur jeden N. Frame neu rendern (Rotation ist langsam)
// Meeresspiegel-Anstieg im Schnitt (0 = alter Stand, 1 = jetziger, hoeherer Stand). Klick-getriggert.
let sectionSeaRise = 0;
let sectionSeaRiseActive = false;
const SEA_RISE_DURATION = 6.0;    // Sekunden fuer den langsamen Anstieg
const SECTION_OLD_SEA_Y = 1.06;   // Start-Meeresspiegel: UNTER dem Bildrand -> am Anfang kein Wasser sichtbar
const SECTION_NEW_SEA_Y = 0.40;   // jetziger Meeresspiegel (steigt ins Bild hoch; etwas ueber den Berggipfel)
// Berg-/Land-Bild (assets/images/entities/section/land.png, transparentes PNG). Position/Groesse tunebar.
let SECTION_LAND_CX = 0.50;       // horizontale Mitte des Bergs (Anteil Breite)
let SECTION_LAND_BASE_Y = 1.00;   // Unterkante des Bergs (Anteil Hoehe; >1 = Fuss unter dem Bildrand)
// Berg-Bild wird UNIFORM (unverzerrt) auf SCALE*Bildschirmbreite gezogen; die HOEHE folgt dem Bild-
// Seitenverhaeltnis. D.h. Hoehe & Breite des Bergs steuerst du ueber die BILDDATEI selbst (Masse +
// transparente Raender). On-Screen-Hoehe = SCALE * Bildschirmbreite * (Bildhoehe/Bildbreite).
let SECTION_LAND_SCALE = 1.0;     // 1.0 = volle Bildschirmbreite (kleiner = schmaler)
const SECTION_WATER_OPACITY = 0.58; // Deckkraft des Wassers ueber dem Berg (halbtransparent -> Berg bleibt sichtbar)
// Randmarker: Einstieg (auf der Kugel) + Ausstieg (oben im Schnitt). Live-Position pro Frame aus draw().
let sectionMarkers = [];    // Einstiegs-Marker auf der Kugel (Szene 1): {x,y,r,idx,label}
let sectionBackMarker = { x: 0, y: 0, r: 0, visible: false };
let sectionHover = false;   // Maus ueber einem Randmarker -> Pointer-Cursor

let started = false;      // Audio-Geste erfolgt?
let openEntity = null;    // aktuell geoeffnetes Inhalts-Panel
let hoverEntity = null;
let heldEntity = null;    // Entity, das gerade per Maus festgehalten/gedreht wird
let globeBuf = null;      // gemeinsamer WebGL-Layer fuer 3D-Kugeln
let oceanShader = null;   // Shader fuer animierte Meeresstroemungen
let cloudShader = null;   // Shader fuer prozedurale, animierte Wolken
const GLOBE_BUF = 1280;   // Aufloesung des Globus-Layers (px). Hoeher = schaerferer Erd-Rand in der
                          // Atmosphaeren-Ansicht, kostet mehr GPU in Szene 1. Bei Rucklern runter (z.B. 900/600).
                          // Hinweis: die Erdtextur ist 2048px breit -> ab ~1500 bringt mehr Buffer kaum noch Schaerfe.
const GLOBE_R_FRAC = 0.37; // sphere(R)-Radius als Anteil von GLOBE_BUF
let globeProjFrac = null;  // tatsaechlich projizierter Kugelradius-Anteil (zur Laufzeit gemessen)

// ===== FOTO-GLOBUS-SHADER (echte Satellitentextur, beleuchtet) =====
// Albedo (earth_day) + Normal-Map (Relief) + Specular (Ozean-Glanz) + Wasser-Gain (heller,
// Struktur bleibt) + breiter Wasser-Schimmer + gerichtetes Sonnenlicht + Tag/Nacht-Terminator
// + Atmosphaeren-Fresnel-Rand. Beleuchtung im MODELLRAUM via uLight/uCam (toModelVec).
const SURF_VERT = `
precision highp float;
attribute vec3 aPosition; attribute vec2 aTexCoord;
uniform mat4 uModelViewMatrix, uProjectionMatrix;
varying vec2 vUv; varying vec3 vModelPos; varying vec3 vN0;
void main(){ vUv=aTexCoord; vModelPos=aPosition; vN0=normalize(aPosition);
  gl_Position = uProjectionMatrix * uModelViewMatrix * vec4(aPosition,1.0); }`;

const SURF_FRAG = `
precision highp float;
varying vec2 vUv; varying vec3 vModelPos; varying vec3 vN0;
uniform sampler2D uDay, uNormalMap, uSpec;
uniform vec3 uLight, uCam, uSunCol, uNightCol, uAtmoCol;
uniform float uRelief, uGloss, uSpecGain, uAmbient, uWaterGain, uSheen, uSheenPow;
void main(){
  vec3 N0 = normalize(vN0);
  vec3 T = normalize(vec3(N0.z, 0.0, -N0.x) + vec3(1e-5));
  vec3 B = cross(N0, T);
  vec3 nm = texture2D(uNormalMap, vUv).rgb * 2.0 - 1.0;
  vec3 N = normalize(N0 + (T*nm.x + B*nm.y) * uRelief);
  vec3 L = normalize(uLight);
  vec3 Vd = normalize(uCam - vModelPos);
  vec3 alb = texture2D(uDay, vUv).rgb;
  float spec = texture2D(uSpec, vUv).r;
  alb *= mix(1.0, uWaterGain, spec);                         // Wasser verstaerken -> heller + Struktur
  float diff = max(dot(N, L), 0.0);
  float term = smoothstep(-0.12, 0.22, dot(N0, L));          // Tag/Nacht-Kante
  vec3 Hh = normalize(L + Vd);
  float sp = pow(max(dot(N, Hh), 0.0), uGloss) * spec * uSpecGain * term;   // (uSpecGain=0 -> kein Hotspot)
  vec3 dayCol = alb * (uAmbient + diff) * uSunCol + sp * uSunCol;
  vec3 nightCol = alb * uNightCol;                           // dunkle Nachtseite, keine Lichter
  vec3 col = mix(nightCol, dayCol, term);
  float sheen = pow(max(dot(N, Hh), 0.0), uSheenPow) * spec * term * uSheen;   // dezenter breiter Schimmer
  col += sheen * vec3(0.70, 0.80, 1.00);
  float fres = pow(1.0 - max(dot(N0, Vd), 0.0), 3.0);        // Atmosphaeren-Rand
  col += uAtmoCol * fres * (0.18 + 0.82 * term);
  gl_FragColor = vec4(col, 1.0);
}`;

// Wolken: PROZEDURAL (animiertes 3D-Noise), dynamisch (Drift+Morph ueber uTime), Land-Maske via
// Specular (ueber Land hoehere Schwelle + schwaecher), Pol-Fade. WICHTIG: p5 blendMode(BLEND)
// ist PREMULTIPLIED -> vormultipliziert ausgeben (ccol*al, al), sonst bei Bedeckung opak weiss.
const CLOUD_VERT = SURF_VERT;
const CLOUD_FRAG = `
precision highp float;
varying vec2 vUv; varying vec3 vModelPos; varying vec3 vN0;
uniform sampler2D uLandSpec;
uniform vec3 uLight, uCam;
uniform float uCloudOp, uTime;
float hash(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7)))*43758.5453); }
float vnoise(vec3 p){ vec3 i=floor(p), f=fract(p); vec3 u=f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(i+vec3(0.,0.,0.)),hash(i+vec3(1.,0.,0.)),u.x),mix(hash(i+vec3(0.,1.,0.)),hash(i+vec3(1.,1.,0.)),u.x),u.y),
             mix(mix(hash(i+vec3(0.,0.,1.)),hash(i+vec3(1.,0.,1.)),u.x),mix(hash(i+vec3(0.,1.,1.)),hash(i+vec3(1.,1.,1.)),u.x),u.y),u.z); }
float fbm(vec3 p){ float v=0.0,a=0.5; for(int k=0;k<5;k++){ v+=a*vnoise(p); p*=2.0; a*=0.5; } return v; }
void main(){
  vec3 N0 = normalize(vN0);
  vec3 L = normalize(uLight);
  vec3 Vd = normalize(uCam - vModelPos);
  float water = texture2D(uLandSpec, vUv).r;                 // hoch=Wasser, niedrig=Land
  float t = uTime;
  float ca = cos(t*0.010), sa = sin(t*0.010);
  vec3 d = vec3(N0.x*ca + N0.z*sa, N0.y, -N0.x*sa + N0.z*ca); // Drift
  float base = fbm(d*2.6 + vec3(0.0, t*0.012, 0.0)) * 0.5 + 0.5;
  float det  = fbm(d*7.0 + 11.0) * 0.5 + 0.5;
  float raw = base*0.70 + det*0.30;
  float pole = 1.0 - smoothstep(0.80, 0.99, abs(N0.y));
  float lo = mix(0.82, 0.74, water);                         // hohe Schwelle -> wenige Wolken
  float a = smoothstep(lo, lo + 0.11, raw) * pole;
  a *= clamp(det*0.6 + 0.5, 0.0, 1.0);
  if(a < 0.01) discard;
  float term = smoothstep(-0.05, 0.28, dot(N0, L));
  vec3 ccol = mix(vec3(0.55,0.60,0.68), vec3(1.0), 0.3 + 0.7*term);
  float rim = smoothstep(0.0, 0.22, dot(N0, Vd));
  float landScale = mix(0.30, 1.0, water);
  float al = a * (0.10 + 0.90*term) * rim * landScale * uCloudOp;
  gl_FragColor = vec4(ccol * al, al);                        // VORMULTIPLIZIERT
}`;

function ensureGlobeBuffer() {
  if (!globeBuf) {
    globeBuf = createGraphics(GLOBE_BUF, GLOBE_BUF, WEBGL);
    globeBuf.pixelDensity(1);   // feste Aufloesung (sonst Display-Density -> 4x auf High-DPI)
    oceanShader = globeBuf.createShader(SURF_VERT, SURF_FRAG);
    cloudShader = globeBuf.createShader(CLOUD_VERT, CLOUD_FRAG);
  }
}

// ---- Foto-Globus: Beleuchtungs-Tuning (Werte aus globereal.html, von Lukas freigegeben) ----
const G_SUNCOL    = [1.0, 0.97, 0.90];
const G_NIGHTCOL  = [0.04, 0.05, 0.09];   // dunkle Nachtseite (keine Stadtlichter)
const G_ATMOCOL   = [0.92, 0.86, 0.72];   // Atmosphaeren-Rand: warmer Smog-Gold-Ton (passt zum 2D-Halo + Szene 2)
const G_RELIEF    = 0.85;
const G_GLOSS     = 240.0;                 // enger Glanz
const G_SPECGAIN  = 0.0;                   // Sonnen-Hotspot AUS
const G_AMBIENT   = 0.20;
const G_WATER_GAIN = 2.0;                  // Wasser heller + Struktur
const G_SHEEN      = 0.14;                 // dezenter breiter Wasser-Schimmer
const G_SHEEN_POW  = 7.0;
const G_CLOUD_OP   = 0.50;                 // Wolken-Deckkraft (premultiplied)

function norm3(v){ const m = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0]/m, v[1]/m, v[2]/m]; }
// Weltvektor -> Modellsystem der Kugel: Rx(-tilt) dann Ry(-spin). Fuer Licht UND Kamera,
// damit Beleuchtung/Glanz/Schimmer korrekt liegen, waehrend sich die Kugel dreht.
function toModelVec(v, tilt, spin) {
  let L = v.slice();
  let a = -tilt, c = Math.cos(a), s = Math.sin(a); L = [L[0], L[1]*c - L[2]*s, L[1]*s + L[2]*c];
  a = -spin; c = Math.cos(a); s = Math.sin(a);      L = [L[0]*c + L[2]*s, L[1], -L[0]*s + L[2]*c];
  return L;
}

// rendert die FOTO-Kugel: Albedo + Normal-Relief + Specular + Sonnenlicht + Tag/Nacht + Atmosphaere
// (Oberflaechen-Shader), darueber prozedurale dynamische Wolken (eigene, leicht groessere Kugel).
// Rendert in globeBuf (Default) ODER in einen uebergebenen Buffer + eigene Shader (fuer die hochaufgeloeste
// Atmosphaeren-Ansicht). Buffergroesse wird aus g.width abgeleitet -> aufloesungsunabhaengig.
function drawGlobe(ent, opts = {}) {
  const g = opts.buf || globeBuf;
  const os = (opts.oceanSh !== undefined) ? opts.oceanSh : oceanShader;
  const cs = (opts.cloudSh !== undefined) ? opts.cloudSh : cloudShader;
  const BUFSZ = g.width;
  const R = BUFSZ * GLOBE_R_FRAC;
  const camZ = (BUFSZ / 2) / Math.tan(Math.PI / 6);   // p5-Default-Kamera des Buffers
  g.clear();
  const gl = g.drawingContext;
  gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
  // Projektion: normal Perspektive (Szene 1); fuer den Cap-Zoom der Atmosphaere eine ORTHOGRAFISCHE Box,
  // die nur den sichtbaren Rand-Ausschnitt rahmt -> die volle Buffer-Aufloesung geht in die sichtbare Erde.
  if (opts.orthoBox) { const b = opts.orthoBox; g.ortho(b.left, b.right, b.bottom, b.top, b.near, b.far); }
  else g.perspective();
  const tNow = millis() / 1000;
  const tilt = ent.tilt, spin = ent.spinAngle;
  const cam = toModelVec([0, 0, camZ], tilt, spin);     // Kamera im Modellraum
  // Licht: normal die kreisende Sonne; bei opts.frontLit FRONTAL (nur winziger Hauch nach oben, KEIN
  // Seiten-Versatz) -> die ganze zugewandte Seite ist beleuchtet, kein schwarzer Seiten-Schatten.
  // (Sheen/Fresnel sind in der Atmosphaere aus, daher brennt frontal auch nicht mehr weiss aus.)
  const L = opts.frontLit ? toModelVec([0.0, 0.10 * camZ, 0.995 * camZ], tilt, spin)
                          : toModelVec(currentSunWorld(), tilt, spin);
  const cloudOp = (opts.cloudOp != null) ? opts.cloudOp : G_CLOUD_OP;
  const sunCol = (opts.sunScale != null) ? [G_SUNCOL[0]*opts.sunScale, G_SUNCOL[1]*opts.sunScale, G_SUNCOL[2]*opts.sunScale] : G_SUNCOL;

  // Oberflaeche
  g.push();
  g.noStroke();
  if (os && ent.normTex && ent.specTex) {
    g.shader(os);
    os.setUniform('uDay', ent.tex);
    os.setUniform('uNormalMap', ent.normTex);
    os.setUniform('uSpec', ent.specTex);
    os.setUniform('uLight', L); os.setUniform('uCam', cam);
    os.setUniform('uSunCol', sunCol);
    os.setUniform('uNightCol', opts.nightCol != null ? opts.nightCol : G_NIGHTCOL);   // atmo: hoeher -> Rand nicht dunkel
    os.setUniform('uAtmoCol', opts.atmoCol != null ? opts.atmoCol : G_ATMOCOL);   // atmo-zoom: aus -> kein grauer Fresnel-Schleier
    os.setUniform('uRelief', G_RELIEF); os.setUniform('uGloss', G_GLOSS);
    os.setUniform('uSpecGain', G_SPECGAIN);
    os.setUniform('uAmbient', opts.ambient != null ? opts.ambient : G_AMBIENT);   // atmo: hoeher -> Fuelllicht hebt den Rand
    os.setUniform('uWaterGain', opts.waterGain != null ? opts.waterGain : G_WATER_GAIN);   // atmo: kleiner -> Ozean nicht ausgebrannt
    os.setUniform('uSheen', opts.sheen != null ? opts.sheen : G_SHEEN);                     // atmo: 0 -> kein Front-Licht-Glanz
    os.setUniform('uSheenPow', G_SHEEN_POW);
  } else {
    g.noLights(); g.texture(ent.tex);
  }
  g.rotateX(tilt);
  g.rotateY(spin);
  g.sphere(R, 96, 64);
  g.pop();
  if (os) g.resetShader();

  // projizierten OBERFLAECHEN-Radius messen (vor der groesseren Wolkenkugel) -> Halo. Verhaeltnis
  // ist groessenunabhaengig, daher genuegt eine Messung (aus welchem Buffer auch immer zuerst).
  if (globeProjFrac === null) {
    const c2 = BUFSZ / 2;
    let r = BUFSZ / 2;
    for (let x = c2; x < BUFSZ; x++) { if (g.get(x, c2)[3] < 10) { r = x - c2; break; } }
    globeProjFrac = r / BUFSZ;
  }

  // Wolken: prozedural, dynamisch (Drift+Morph via uTime), leicht groessere Kugel.
  // Backface-Culling (nur vordere Halbkugel) + kein Tiefenschreiben + PREMULTIPLIED Alpha.
  if (cs && ent.specTex) {
    g.blendMode(BLEND);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.FRONT);
    gl.depthMask(false);
    g.push();
    g.noStroke();
    g.shader(cs);
    cs.setUniform('uLandSpec', ent.specTex);
    cs.setUniform('uLight', L); cs.setUniform('uCam', cam);
    cs.setUniform('uCloudOp', cloudOp);
    cs.setUniform('uTime', tNow);                 // Wolken driften unabhaengig vom Spin
    g.rotateX(tilt);
    g.rotateY(spin);
    g.sphere(R * 1.012, 96, 64);                   // schwebt knapp ueber der Oberflaeche
    g.pop();
    g.resetShader();
    gl.depthMask(true);
    gl.disable(gl.CULL_FACE);
  }
}
let duck = 0;             // 0..1 Audio-Ducking + Bewegungs-Verlangsamung bei offenem Panel

let audio = null;         // Tone-Graph

// =========================================================================
//  DATEN LADEN
// =========================================================================
async function loadData() {
  const [s, e] = await Promise.all([
    fetch('data/scenes.json').then(r => r.json()),
    fetch('data/entities.json').then(r => r.json())
  ]);
  scenesData = s;
  entitiesData = e;
}

// Bild laden mit Fallback (fehlt die Datei -> img bleibt null -> Platzhalter)
function tryLoadImage(path) {
  return new Promise(resolve => {
    if (!path) { resolve(null); return; }
    loadImage(path, img => resolve(img), () => resolve(null));
  });
}

async function buildWorld() {
  // Szenen + Hintergruende
  scenes = [];
  for (const sc of scenesData.scenes) {
    const bg = await tryLoadImage(sc.background);
    const landImg = sc.land ? await tryLoadImage(sc.land) : null;   // optionales Bild (z.B. Berg im Schnitt)
    scenes.push({ ...sc, bg, landImg });
  }
  // Zoom-Transition: Indizes aus den IDs aufloesen (Reihenfolge-unabhaengig)
  zoomSeaIndex = scenes.findIndex(s => s.id === ZOOM_SEA_ID);
  zoomInteriorIndex = scenes.findIndex(s => s.id === ZOOM_INTERIOR_ID);
  spaceIndex = scenes.findIndex(s => s.id === SPACE_ID);
  atmosphereIndex = scenes.findIndex(s => s.id === ATMO_ID);
  waterIndex = scenes.findIndex(s => s.id === WATER_ID);
  // Entities
  allEntities = [];
  for (const def of entitiesData.entities) {
    const img = await tryLoadImage(def.image);
    const ent = new Entity(def, img);
    if (def.frames) ent.frames = await loadFrames(def.frames);  // Animations-Sequenz
    if (def.variants) {                                          // Bild-Varianten-Ordner
      ent.variants = await loadVariants(def.variants);
      // einzelne, anders ausgerichtete Varianten spiegeln (1-basierte Indizes) -> Ordner konsistent
      if (def.flipVariants) for (const n of def.flipVariants) {
        const k = n - 1; if (ent.variants[k]) ent.variants[k] = flipImageH(ent.variants[k]);
      }
      ent.pickVariant();
    }
    if (def.globe) {
      ent.tex = await tryLoadImage(def.globe.texture);
      if (def.globe.normal) ent.normTex = await tryLoadImage(def.globe.normal);
      if (def.globe.spec) ent.specTex = await tryLoadImage(def.globe.spec);
      ensureGlobeBuffer();
    }
    allEntities.push(ent);
  }
  // Zeichenreihenfolge nach 'layer' (hoeher = weiter vorne gezeichnet). Die Station (Querschnitt)
  // liegt ueber den Kreaturen, damit nie eine Kreatur VOR der Station schwimmt. Stabil sortiert
  // (urspruengliche Reihenfolge als Tiebreak -> Kreaturen untereinander unveraendert).
  allEntities.forEach((e, i) => { e._ord = i; });
  allEntities.sort((a, b) => ((a.def.layer || 0) - (b.def.layer || 0)) || (a._ord - b._ord));
}

// Frame-Sequenz laden (z.B. rotierender Globus): frames = { dir, count, fps, pad }
async function loadFrames(spec) {
  const ps = [];
  for (let i = 0; i < spec.count; i++) {
    const n = String(i).padStart(spec.pad || 2, '0');
    ps.push(tryLoadImage(spec.dir + 'frame_' + n + '.png'));
  }
  return (await Promise.all(ps)).filter(Boolean);
}

// Variant-Ordner laden (Bild-Sprites). Wie loadFrames eine NUMMERIERTE Sequenz, aber mit Abbruch
// bei der ersten Luecke. Dateinamen-Praefix = Ordnername: ".../whale/" -> whale1, whale2, ...
// Pro Nummer wird ZUERST .webp (klein) versucht, dann .png (Fallback). Faellt auf bare 1,2,...
// zurueck, falls keine Praefix-Datei existiert. Max ~12 Varianten.
// Leeres Ergebnis -> Entity bleibt beim prozeduralen Platzhalter.
async function loadVariants(folder) {
  const name = folder.replace(/\/+$/, '').split('/').pop();   // Ordnername als Praefix
  let imgs = await loadVariantSeq(folder, name);              // erst <name>1.webp/.png, ...
  if (!imgs.length) imgs = await loadVariantSeq(folder, '');  // sonst bare 1.webp/.png, ...
  return imgs;
}
async function loadVariantSeq(folder, prefix) {
  const imgs = [];
  for (let i = 1; i <= 12; i++) {
    const base = folder + prefix + i;
    let img = await tryLoadImage(base + '.webp');             // WebP bevorzugt (deutlich kleiner)
    if (!img) img = await tryLoadImage(base + '.png');        // sonst PNG-Fallback
    if (!img) break;                                          // erste fehlende Nummer -> Sequenz-Ende
    imgs.push(img);
  }
  return imgs;
}

// horizontale Spiegelung eines Bildes -> p5.Graphics (fuer Varianten, die anders herum gezeichnet sind)
function flipImageH(img) {
  const g = createGraphics(img.width, img.height);
  g.pixelDensity(1);
  g.push(); g.translate(img.width, 0); g.scale(-1, 1); g.image(img, 0, 0); g.pop();
  return g;
}

// =========================================================================
//  ENTITY
// =========================================================================
class Entity {
  constructor(def, img) {
    this.def = def;
    this.img = img;
    this.frames = null;               // optionale Animations-Sequenz
    this.variants = null;             // optionaler Ordner mit Bild-Varianten (zufaellig gewaehlt)
    this.spinTime = 0;                // akkumulierte Dreh-Zeit (pausierbar)
    // 3D-Kugel (WebGL): freie Drehung mit Schwung
    this.isGlobe = !!def.globe;
    if (this.isGlobe) {
      this.tex = null; this.normTex = null; this.specTex = null;
      this.baseVel = def.globe.baseVel != null ? def.globe.baseVel : 0.3;  // rad/s Normaltempo
      this.tilt = def.globe.tilt != null ? def.globe.tilt : 0.35;
      this.baseTilt = this.tilt;   // Ausgangs-Neigung, zu der der Pitch zurueckschwingt
      this.spinAngle = 0;
      this.spinVel = this.baseVel;
      this.tiltVel = 0;            // Pitch-Schwung (Hoch/Runter-Drehung)
    }
    this.path = def.path || [{ x: 0.5, y: 0.5 }];
    this.loop = def.loop || 'loop';
    this.closed = this.loop === 'loop' && this.path.length > 2;
    this.u = Math.random() * 0.6;     // Startposition gestreut
    this.dir = 1;                      // fuer pingpong
    this.faceDir = 1;                  // horizontale Blickrichtung (faceForward): +1 rechts, -1 links
    this.swimPhase = Math.random() * TWO_PI;  // eigene Phase fuer Schwimm-Rhythmus (de-synchronisiert)
    this.dartT = 0;                    // Rest-Zeit eines seltenen Kalmar-Dashes
    this.respawnAlpha = 1;            // fuer drift-Ein-/Ausblenden
    this.bobPhase = Math.random() * TWO_PI;
    this.highlight = 0;               // 0..1 weiches Hervorheben beim Klick
    this.color = colorFromId(def.id); // Platzhalterfarbe
    // Zufaellige Groesse pro Instanz (Tiere): Multiplikator 0.6..0.9 fuer natuerliche Groessen-Varianz
    // und mehr Tiefe. Globus, Station (placeholder) und Szenen-Bilder bleiben unveraendert (Multiplikator 1).
    this.sizeMul = (this.isGlobe || def.placeholder || def.sceneImage) ? 1 : (0.6 + Math.random() * 0.3);
    this.pos = { x: 0, y: 0 };        // letzte Bildschirmposition (px)
    this.radius = 40;
  }

  // waehlt zufaellig eine geladene Bild-Variante als aktuelles Bild (bei drift/loop pro Respawn neu)
  pickVariant() {
    if (this.variants && this.variants.length) {
      this.img = this.variants[Math.floor(Math.random() * this.variants.length)];
    }
  }

  update(dt) {
    // Bewegung verlangsamt sich, wenn ein Panel offen ist
    const slow = 1 - 0.85 * duck;
    let step = (this.def.speed || 0.03) * dt * slow;
    // Schwimm-Rhythmus (aus der Recherche): asymmetrische Tempo-Huellkurven statt konstanter Fahrt.
    const tNow = millis() / 1000;
    if (this.def.swim === 'pulse') {
      // Qualle: kurzer Schub, dann langes passives Ausgleiten (Energie-Recapture) -> Ratschen
      const T = this.def.pulsePeriod || 2.6;
      const pp = (((tNow / T) + this.swimPhase) % 1 + 1) % 1;
      this.pulse = pp < 0.22 ? Math.sin(pp / 0.22 * Math.PI) : 0.18 * Math.exp(-(pp - 0.22) * 4.0);
      step *= this.pulse * 3.2;                                       // Spitze ~3x, Boden ~0
    } else if (this.def.swim === 'jet') {
      // Kalmar: schneller Jet-Stoss + langes Ausgleiten; sehr selten ein crisper Dash
      const T = this.def.pulsePeriod || 1.8;
      const saw = (((tNow / T) + this.swimPhase) % 1 + 1) % 1;
      const env = saw < 0.18 ? saw / 0.18 : Math.pow(1 - (saw - 0.18) / 0.82, 1.6);
      step *= 0.25 + 0.9 * env;
      if (this.dartT <= 0 && Math.random() < 0.003) this.dartT = 0.5;  // ~alle 5-10s ein Dash
      if (this.dartT > 0) { step *= 3.0; this.dartT -= dt; }
    } else if (this.def.ease) {
      // langsames Ebben/Fluten -> die Kreatur treibt zeitweise fast still (Hover/Kriechen)
      step *= 1 - this.def.ease * (0.5 + 0.5 * Math.sin(this.bobPhase * 0.3 + this.u * 5.0));
    }

    if (this.path.length > 1) {
      this.u += step * this.dir;
      if (this.loop === 'pingpong') {
        if (this.u > 1) { this.u = 1; this.dir = -1; }
        if (this.u < 0) { this.u = 0; this.dir = 1; }
      } else if (this.loop === 'drift') {
        // einmal durchlaufen, dann am Anfang neu auftauchen (mit Fade) -> dabei neue Variante
        if (this.u > 1) { this.u = 0; this.respawnAlpha = 0; this.pickVariant(); }
        this.respawnAlpha = min(1, this.respawnAlpha + dt * 0.8);
        if (this.u > 0.9) this.respawnAlpha = max(0, (1 - this.u) / 0.1);
      } else { // loop
        if (this.u >= 1) this.pickVariant();   // pro Zyklus eine neue Variante (Schwarm variiert)
        this.u = (this.u % 1 + 1) % 1;
      }
    }
    this.bobPhase += dt * 1.4;

    // Drehung der Frame-Sequenz laeuft weiter, solange nicht festgehalten
    if (this.frames && this.frames.length && heldEntity !== this) this.spinTime += dt;

    // 3D-Kugel: dreht von selbst; Schwung klingt sanft auf Normaltempo ab
    if (this.isGlobe) {
      if (heldEntity !== this) {
        // Yaw (links/rechts): klingt auf Normaltempo ab
        this.spinAngle += this.spinVel * dt;
        this.spinVel += (this.baseVel - this.spinVel) * Math.min(1, dt * 1.2);
        // Pitch (hoch/runter): nach dem Loslassen zurueck zur Ausgangs-Neigung schwingen (gedaempfte Feder)
        this.tiltVel += (this.baseTilt - this.tilt) * 22.0 * dt;
        this.tiltVel *= Math.max(0, 1 - 4.5 * dt);
        this.tilt += this.tiltVel * dt;
      }
    }

    const target = openEntity === this ? 1 : 0;   // weiches Hervorheben, solange dieses Panel offen ist
    this.highlight += (target - this.highlight) * min(1, dt * 4);
  }

  // normierte Position (0..1) entlang des Pfades (+ bob, + optionales Pendeln/Zittern)
  normPos() {
    // Viz-Hotspots (station_cut/habitat, derzeit unverlinkt): dynamisch auf ihrem Feature
    if (this.def.hotspot) {
      const v = vizHotspotNorm(this.def.id);
      if (v) return v;
    }
    const p = pointAt(this.path, this.u, this.closed);
    let ox = 0, oy = (this.def.bob || 0) * Math.sin(this.bobPhase);
    const tt = millis() / 1000;
    // 'weave': langsames seitliches Pendeln (Qualle driftet nicht schnurgerade)
    if (this.def.weave) ox += this.def.weave * Math.sin(tt * (this.def.weaveSpeed || 0.45) + this.swimPhase);
    // 'jitter': feines Station-Keeping-Zittern (Sea Devils / Seespinne sind nie ganz eingefroren)
    if (this.def.jitter) {
      const j = this.def.jitter;
      ox += j * (0.6 * Math.sin(tt * 0.5 + this.swimPhase) + 0.4 * Math.sin(tt * 0.31 + this.swimPhase * 2.3));
      oy += j * 0.7 * Math.sin(tt * 0.7 + this.swimPhase * 1.7);
    }
    return { x: p.x + ox, y: p.y + oy };
  }

  draw() {
    const np = this.normPos();
    const x = np.x * width;
    const y = np.y * height;
    const sz = (this.def.scale || 0.12) * Math.min(width, height) * 2 * this.sizeMul;
    this.pos = { x, y };
    this.radius = sz * 0.5;

    // Blickrichtung (faceForward): horizontale Richtung aus der Pfad-Tangente (geschwindigkeits-
    // unabhaengig; Hysterese-Schwelle -> kein Flackern an fast senkrechten Wendepunkten)
    if (this.def.faceForward && this.path.length > 1) {
      const u2 = this.u + 0.01 * this.dir;
      const uu = this.closed ? ((u2 % 1) + 1) % 1 : Math.max(0, Math.min(1, u2));
      const dnx = pointAt(this.path, uu, this.closed).x - np.x;
      if (Math.abs(dnx) > 1e-4) this.faceDir = dnx > 0 ? 1 : -1;
    }

    let alpha = (this.def.opacity != null ? this.def.opacity : 1) * this.respawnAlpha;
    alpha *= currentSceneAlphaFor(this);
    // Tiefen-Verdunkelung: je tiefer das Tier, desto dunkler/schemenhafter. NUR in Unterwasser-Szenen
    // (Scene 2); Station ausgenommen. In Scene 3 (heller Innenraum) bleiben Figuren unverdunkelt.
    const dk = (this.def.placeholder === 'island' || !sceneIsUnderwater(this.def.scene)) ? 1 : depthDim(np.y);

    push();
    translate(x, y);
    const glow = 0.15 + this.highlight * 0.5 + (hoverEntity === this ? 0.2 : 0);

    // 3D-Kugel: WebGL-Layer rendern, Atmosphaeren-Halo dahinter, Kugel-Bild, Tag/Nacht-Schatten
    let handled = false;
    if (this.isGlobe && this.tex && globeBuf) {
      drawGlobe(this);
      const ctx = drawingContext, r = sz * (globeProjFrac || GLOBE_R_FRAC);
      // weicher Atmosphaeren-Halo (ragt ueber den Kugelrand hinaus, hinter der Kugel).
      // Schmaler/enger an den Rand gezogen (nur noch ~halbe Aussenreichweite) und im warmen
      // Smog-Goldton aus Szene 2 (#ecdcb8) -> koppelt Szene 1 farblich an die Stationskulisse.
      let halo = ctx.createRadialGradient(0, 0, r * 0.90, 0, 0, r * 1.17);
      halo.addColorStop(0, 'rgba(236,220,184,0)');
      halo.addColorStop(0.45, `rgba(236,220,184,${0.25 * alpha})`);
      halo.addColorStop(1, 'rgba(236,220,184,0)');
      ctx.fillStyle = halo; ctx.fillRect(-r * 1.3, -r * 1.3, r * 2.6, r * 2.6);
      // Kugel-Bild
      imageMode(CENTER);
      tint(255, 255 * alpha);
      image(globeBuf, 0, 0, sz, sz);
      noTint();
      // Tag/Nacht-Kante + Atmosphaeren-Rand laufen jetzt IM Shader (kein 2D-Overlay noetig).
      handled = true;
    }

    // aktuelles Bild: bei Frame-Sequenz das laufende Einzelbild, sonst das Standbild
    let drawImg = handled ? null : this.img;
    if (!handled && this.frames && this.frames.length) {
      const fps = (this.def.frames && this.def.frames.fps) || 12;
      const idx = Math.floor(this.spinTime * fps) % this.frames.length;
      drawImg = this.frames[idx];
    }

    if (drawImg) {
      // weicher Schein bei Hover/Highlight
      if (glow > 0.16) {
        drawingContext.shadowBlur = 40 * glow;
        drawingContext.shadowColor = `rgba(216,178,90,${0.6 * glow})`;
      }
      imageMode(CENTER);
      const ratio = drawImg.height / drawImg.width;
      push();
      // nach vorne ausrichten: Sprite horizontal spiegeln, sodass die Vorderseite in Bewegungsrichtung zeigt
      // (facing = native Blickrichtung der Grafik: 'left' -> Kunst zeigt nach links)
      if (this.def.faceForward) scale(this.faceDir * (this.def.facing === 'left' ? -1 : 1), 1);
      // dunkler/schemenhafter mit der Tiefe. dk auf 12 Stufen quantisiert: ein FARB-Tint (RGB<255)
      // zwingt p5 sonst, das getintete Bild pro Frame neu zu bauen (getImageData/putImageData ueber
      // alle Quellpixel), weil dk sich beim Schwimmen staendig minimal aendert. Mit 12 diskreten
      // Stufen cached p5 die getinteten Bilder und baut nicht mehr neu -> ~45% guenstiger, Look identisch.
      const dkQ = Math.round(dk * 12) / 12;
      tint(255 * dkQ, 255 * dkQ, 255 * dkQ, 255 * alpha);
      image(drawImg, 0, 0, sz, sz * ratio);
      // Esca (Anglerfisch-Leuchtkoeder): additiver, pulsierender Leuchtpunkt am erkannten warmen
      // Fleck im Sprite. Biolumineszenz -> nicht von der Tiefe gedimmt (leuchtet im Dunkeln staerker).
      if (this.def.glowLure) {
        if (drawImg.__lure === undefined) drawImg.__lure = findLureSpot(drawImg);
        const L = drawImg.__lure;
        if (L) {
          const lx = (L.x - 0.5) * sz, ly = (L.y - 0.5) * sz * ratio;
          const ms = millis() * 0.001;
          const puls = 0.55 + 0.30 * Math.sin(ms * 1.7 + this.swimPhase)   // langsames Glühen
                            + 0.15 * Math.sin(ms * 9.3 + this.bobPhase);    // feines Flackern
          const p = Math.max(0.15, Math.min(1, puls));
          const r = sz * 0.13 * (0.8 + 0.4 * p);
          const ctx = drawingContext;
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          const grad = ctx.createRadialGradient(lx, ly, 0, lx, ly, r);
          grad.addColorStop(0.0, 'rgba(255,252,225,' + (0.85 * p * alpha) + ')');
          grad.addColorStop(0.35, 'rgba(255,226,150,' + (0.45 * p * alpha) + ')');
          grad.addColorStop(1.0, 'rgba(255,210,120,0)');
          ctx.fillStyle = grad;
          ctx.fillRect(lx - r, ly - r, r * 2, r * 2);
          ctx.fillStyle = 'rgba(255,255,245,' + (0.9 * p * alpha) + ')';   // heller Kern
          ctx.beginPath(); ctx.arc(lx, ly, r * 0.16, 0, 6.2831853); ctx.fill();
          ctx.restore();
        }
      }
      pop();
      drawingContext.shadowBlur = 0;
    } else if (!handled && this.def.placeholder === 'island') {
      // prozedurale Bimsstein-Insel als Platzhalter, bis station_cutaway.png existiert.
      // An der Wasserlinie verankert: wlLocalY ist die Wasserlinie in lokalen (entity-)Koords.
      const wlLocalY = WATERLINE_FRAC * height - y;
      drawIslandPlaceholder(sz, wlLocalY, alpha);
    } else if (!handled && this.def.hotspot) {
      // Section-Hotspot: dezenter pulsierender Gold-Ring (kein Bild) -> ruhige Klickpunkte im Schnitt
      drawHotspotMarker(this, sz, alpha, hoverEntity === this);
    } else if (!handled && this.def.sceneImage) {
      // Szenen-Bild-Slot ohne geladenes Bild -> NICHTS zeichnen (kein Platzhalter-Kleks);
      // die Unterszene zeigt dann einfach weiter ihr prozedurales Motiv.
    } else if (!handled) {
      // Platzhalter-Form: weicher Leuchtkleks (treibende Kreaturen-Leuchtpunkte)
      // global ~10% gedimmt + Tiefen-Verdunkelung (Station/Stein + Scene 1 unberuehrt)
      const a = alpha * 0.9 * dk;
      noStroke();
      const c = this.color;
      for (let i = 3; i >= 0; i--) {
        const r = sz * 0.5 * (0.5 + i * 0.22);
        fill(c[0], c[1], c[2], a * (10 + glow * 30) * (4 - i));
        ellipse(0, 0, r * 2);
      }
      fill(c[0], c[1], c[2], a * 220);
      ellipse(0, 0, sz * 0.42);
      fill(255, a * 60);
      ellipse(-sz * 0.08, -sz * 0.08, sz * 0.14);
    }
    pop();

    // Hover-Label (DESCENT: lowercase Mono, hell auf dunklem Schleier)
    if (hoverEntity === this && alpha > 0.4 && this.def.label) {
      push();
      textAlign(CENTER, BOTTOM);
      textSize(11);
      const lbl = this.def.label.toLowerCase();
      const ty = y - this.radius - 10;
      noStroke();
      fill(3, 6, 8, 190); rect(x - textWidth(lbl) / 2 - 9, ty - 18, textWidth(lbl) + 18, 23, 3);
      fill(232, 214, 164, 255 * Math.min(1, glow * 3 + 0.5));
      text(lbl, x, ty);
      pop();
    }
  }

  contains(mx, my) {
    return dist(mx, my, this.pos.x, this.pos.y) < this.radius * 0.7;
  }
}

// =========================================================================
//  PFAD-INTERPOLATION (Catmull-Rom fuer weiche Kurven)
// =========================================================================
function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}
function pointAt(pts, p, closed) {
  const n = pts.length;
  if (n === 1) return { x: pts[0].x, y: pts[0].y };
  if (n === 2) return { x: lerp(pts[0].x, pts[1].x, p), y: lerp(pts[0].y, pts[1].y, p) };
  const segs = closed ? n : n - 1;
  let fp = p * segs;
  let i = Math.floor(fp);
  let t = fp - i;
  if (closed) { i = ((i % segs) + segs) % segs; }
  else { if (i >= segs) { i = segs - 1; t = 1; } if (i < 0) { i = 0; t = 0; } }
  const idx = k => closed ? ((k % n) + n) % n : Math.max(0, Math.min(n - 1, k));
  const a = pts[idx(i - 1)], b = pts[idx(i)], c = pts[idx(i + 1)], d = pts[idx(i + 2)];
  return { x: catmull(a.x, b.x, c.x, d.x, t), y: catmull(a.y, b.y, c.y, d.y, t) };
}

// Tiefen-Verdunkelung: normierte Bildschirm-y -> Helligkeitsfaktor. 1.0 an der Wasserlinie,
// ~0.28 am dunklen Grund (smoothstep -> oberes Mittelwasser bleibt lesbar, nur die Tiefe kippt
// in Schemen/Silhouette). Gemeinsam fuer Sprites, Platzhalter-Leuchtklekse und prozedurale Fauna.
function depthDim(ny) {
  // Originaler weicher Verlauf, nach oben gestaucht: erreicht den dunklen Boden frueher (~ny 0.72
  // statt 1.0), passt zum nach oben geschobenen Wasser-Verlauf. Sanft (smoothstep), kein harter Schnitt.
  let t = (ny - WATERLINE_FRAC) / (0.72 - WATERLINE_FRAC);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  t = t * t * (3 - 2 * t);          // smoothstep
  return 1.0 - 0.72 * t;            // 1.0 .. 0.28
}

// Sucht den hellsten WARMEN (gelb-weissen) Fleck im Sprite -> Position der Esca (Anglerfisch-Koeder,
// vom Nutzer in Photoshop markiert). Liefert normierte Bildkoordinaten {x,y} in [0..1] (Schwerpunkt
// der warm-hellen Pixel) oder null. Einmalig pro Bild (Ergebnis wird auf img.__lure gecacht).
function findLureSpot(img) {
  try {
    img.loadPixels();
    const w = img.width, h = img.height, px = img.pixels;
    if (!px || !px.length) return null;
    let sx = 0, sy = 0, sw = 0;
    for (let y = 0; y < h; y += 2) {                 // grobes Sampling reicht
      for (let x = 0; x < w; x += 2) {
        const i = (y * w + x) * 4;
        if (px[i + 3] < 60) continue;                // transparent -> ignorieren
        const r = px[i], g = px[i + 1], b = px[i + 2];
        const bright = (r + g + b) / 3;
        if (bright < 160) continue;                  // nur HELLE Pixel (Koerper ist dunkel)
        if (b > Math.min(r, g) + 25) continue;       // klar BLAUE Pixel raus (faengt Gelb UND Weiss)
        const warm = (r + g) * 0.5 - b;              // gelb hat warm>0; weiss ~0
        const wgt = (bright - 150) * (1.0 + Math.max(0, warm) * 0.04);
        sx += x * wgt; sy += y * wgt; sw += wgt;
      }
    }
    if (sw <= 0) return null;
    return { x: sx / sw / w, y: sy / sw / h };
  } catch (e) { return null; }
}

function colorFromId(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  // in p5-RGB umwandeln (HSL grob)
  const c = hslToRgb(h, 0.5, 0.6);
  return c;
}
function hslToRgb(h, s, l) {
  h /= 360; let r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3); g = hue2rgb(p, q, h); b = hue2rgb(p, q, h - 1 / 3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

// =========================================================================
//  SZENEN-CROSSFADE-HELFER
// =========================================================================
// Gehoert die Szene (per id) zu einem Unterwasser-Setup? (steuert die Tiefen-Verdunkelung)
function sceneIsUnderwater(id) {
  const s = scenes.find(x => x.id === id);
  return !!(s && s.underwater);
}

// Sichtbarkeits-Alpha eines Entitys abhaengig vom aktuellen Crossfade
function currentSceneAlphaFor(ent) {
  const curId = scenes[currentScene]?.id;
  const nxtId = nextScene >= 0 ? scenes[nextScene]?.id : null;
  let alpha;
  if (ent.def.scene === curId && ent.def.scene === nxtId) alpha = 1;
  else if (ent.def.scene === curId) alpha = 1 - sceneFadeT();
  else if (ent.def.scene === nxtId) alpha = sceneFadeT();
  else return 0;
  if (zoomTransition && zoomPivotIndex >= 0 && ent.def.scene === scenes[zoomPivotIndex]?.id && !ent.def.zoomAnchor) {
    alpha *= 1 - Math.max(0, Math.min(1, (zoomProgress - 0.15) / 0.35));
  }
  return alpha;
}
function sceneFadeT() { return nextScene >= 0 ? sceneFade : 0; }

// =========================================================================
//  AUDIO (Tone.js) - drei geteilte Reverb-Busse, szenenbezogenes Routing
// =========================================================================
function buildAudio() {
  const master = new Tone.Volume(0).toDestination();

  // Drei geteilte Reverb-Busse (kurz/lang/riesig) - NICHT pro Sound!
  const makeBus = decay => {
    const r = new Tone.Reverb({ decay, wet: 1 });
    r.connect(master);
    return r;
  };
  const buses = { short: makeBus(3), long: makeBus(10), huge: makeBus(16) };

  audio = { master, buses, players: {}, ducker: master };

  // pro Szene einen Ambient-Player anlegen (lazy: nur wenn Datei existiert)
  for (const sc of scenesData.scenes) {
    if (!sc.ambient) continue;
    const vol = new Tone.Volume(-60).connect(master); // startet stumm
    const send = sc.reverbSend && buses[sc.reverbSend.bus]
      ? new Tone.Gain(sc.reverbSend.amount || 0.3) : null;
    if (send) send.connect(buses[sc.reverbSend.bus]);

    const player = new Tone.Player({
      url: sc.ambient,
      loop: true,
      fadeIn: 1, fadeOut: 1,
      onerror: () => { audio.players[sc.id] = null; } // Datei fehlt -> Stille
    });
    player.connect(vol);
    if (send) player.connect(send);
    audio.players[sc.id] = { player, vol, baseVol: sc.ambientVolume != null ? sc.ambientVolume : -12 };
  }
}

function playSceneAudio(index, fadeSec = 2) {
  if (!audio) return;
  scenes.forEach((sc, i) => {
    const slot = audio.players[sc.id];
    if (!slot) return;
    const target = i === index ? slot.baseVol : -60;
    try {
      if (i === index && slot.player.loaded && slot.player.state !== 'started') slot.player.start();
      slot.vol.volume.rampTo(target, fadeSec);
    } catch (e) { /* Player evtl. noch nicht geladen */ }
  });
}

function setDuck(on) {
  if (!audio) return;
  audio.master.volume.rampTo(on ? -9 : 0, on ? 0.4 : 0.9);
}

// =========================================================================
//  p5 LIFECYCLE
// =========================================================================
// Viewport-Maße robust ermitteln (windowWidth ist in manchen Umgebungen 0)
function vw() { return window.innerWidth || windowWidth || document.documentElement.clientWidth; }
function vh() { return window.innerHeight || windowHeight || document.documentElement.clientHeight; }

// Performance: Backing-Store-Pixel deckeln. p5 nimmt sonst window.devicePixelRatio (Windows-
// Skalierung / Retina 2-3x -> bis 9x so viele Fragmente pro Frame). Statt fester Dichte ein
// PIXEL-BUDGET: auf grossen/High-DPI-Screens wird die Dichte gesenkt, bis die Backing-Flaeche
// unter MAX_BACKING_PX bleibt -> Fuell-Last (Wasser-Upscale, Fauna, Tints) gedeckelt. Auf kleinen
// Fenstern bleibt bis 1.5 Schaerfe. Nie unter 1.0 -> nie unter logischer Aufloesung (kein Matsch).
// Genau das war die Ursache fuers Ruckeln in Vollbild/High-DPI (im Preview dpr=1 -> unsichtbar).
const MAX_BACKING_PX = 2.6e6;   // ~1080p bei ~1.12x; Ziel: stabile 60fps statt maximaler Schaerfe
// Opt-in Performance-Anzeige: Seite mit ?perf oeffnen -> kleine FPS/Dichte-HUD oben links.
// Damit kannst du auf DEINEM Rechner (Vollbild, echte DPI) pruefen, ob es jetzt 60fps haelt.
let PERF_HUD = false;
let PERF_FLAT = false;   // ?flat -> statisches 2D-Wasser statt WebGL-Shader (testet den GL->2D-Blit-Stall)
let PERF_NOFAUNA = false;// ?nofauna -> Krill+Fische aus (testet, ob die Fauna der Engpass ist)
// Marine Snow (weisse schwebende Punkte im Wasser): AN (1), in reduzierter Dichte (Shader-Schwelle
// 0.99). Gilt fuer Shader-Wasser UND 2D-Fallback. 0..1 regelt die Staerke.
let SNOW_AMOUNT = 1;
// Kaustik (kleine helle Lichtflecken knapp unter der Oberflaeche): wenige Punkte (nur 1 Worley-Lage,
// siehe caustics()), dafuer normal hell. 0..1 regelt die HELLIGKEIT (nicht die Anzahl).
let CAUSTICS_AMOUNT = 1.0;
// Schwarz-Weiss-Modus: setzt Klasse 'bw' auf <body> -> CSS-Graustufenfilter (siehe index.html).
// Toggle per Taste 's' oder Start mit ?bw. Rein visuell, kein Einfluss auf die Render-Pipeline.
let bwMode = false;
try {
  // FPS-HUD: lokal (localhost/127.0.0.1/file://) standardmaessig AN -> dauerhaft beim Bearbeiten
  // sichtbar; auf der Live-Seite (GitHub Pages) aus, ausser mit ?perf. ?noperf schaltet lokal aus.
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || location.protocol === 'file:';
  PERF_HUD = (isLocal || /[?&]perf\b/.test(location.search)) && !/[?&]noperf\b/.test(location.search);
  PERF_FLAT = /[?&]flat\b/.test(location.search);
  PERF_NOFAUNA = /[?&]nofauna\b/.test(location.search);
  if (/[?&]nosnow\b/.test(location.search)) SNOW_AMOUNT = 0;       // Snow zum Vergleich aus
  bwMode = /[?&]bw\b/.test(location.search);                        // ?bw -> in Schwarz-Weiss starten
} catch (e) { /* kein location */ }
let perfFpsEMA = 60;
function chooseDensity() {
  const dpr = window.devicePixelRatio || 1;
  const area = Math.max(1, vw() * vh());
  const budgetD = Math.sqrt(MAX_BACKING_PX / area);   // groesste Dichte, die das Budget noch haelt
  return Math.max(1, Math.min(dpr, 1.5, budgetD));
}

function setup() {
  const c = createCanvas(vw(), vh());
  c.parent('canvas-holder');
  pixelDensity(chooseDensity());
  imageMode(CENTER);
  textFont('Courier New');   // DESCENT-Typo: Mono auch fuer alle Canvas-Texte
  applyBW();        // ?bw-Startzustand auf die Seite anwenden
  // Glow-Cursor (DESCENT): DOM-Punkt folgt der Maus; Zustaende (hover/grab) setzt updateUICursor().
  const curEl = document.getElementById('cursor');
  if (curEl) document.addEventListener('mousemove', e => {
    curEl.style.left = e.clientX + 'px';
    curEl.style.top = e.clientY + 'px';
  });
  noLoop(); // erst nach Datenladen + Geste loopen

  // Barrierefreiheit: bei prefers-reduced-motion das ruhige drawUnderwater() statt des bewegten Shaders
  try { waterReduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* matchMedia fehlt -> Shader */ }

  loadData()
    .then(buildWorld)
    .then(() => {
      buildNav();
      document.getElementById('status').style.display = 'none';
      const gate = document.getElementById('gate');
      gate.classList.remove('hidden');
      gate.addEventListener('click', startExperience, { once: true });
    })
    .catch(err => {
      document.getElementById('status').textContent = 'failed to load: ' + err.message;
      console.error(err);
    });
}

async function startExperience() {
  await Tone.start();
  buildAudio();
  started = true;
  document.getElementById('gate').classList.add('hidden');
  updateSceneName();
  // kleine Verzoegerung, damit Reverb-Impulse generiert sind
  setTimeout(() => playSceneAudio(currentScene, 3), 200);
  loop();
}

// ============ WELTRAUM-HINTERGRUND (Nebel + Sterne + ruhige Zone, EINMAL gecacht) ============
// Synthese aus drei Subagenten-Rezepten: dunkler Void + faint Nebel (Quarter-Res-Noise hochskaliert)
// + realistisches Sternenfeld (Potenzgesetz-Helligkeit, Blackbody-Farbe, Glow) + Vignette/ruhige
// Zone hinter dem Globus. Statisch -> einmal in einen Buffer rendern, pro Frame nur ein image().
let spaceBuf = null;          // gecachter Backdrop (QUADRATISCH = Diagonale -> deckt jede Drehung ab)
const STAR_COUPLE = 0.06;     // wie stark die Sterne mit der Erde mitdrehen (leicht, selbe Achse)
let twinkleStars = [];        // wenige helle Sterne, die live funkeln
let spaceResizeTimer = null;

// ===== UNTERWASSER-BACKDROP (Scene 2) =====
// Analog zum Weltraum: statischer Tiefenverlauf einmal in einen Buffer cachen, pro Frame nur
// ein image() + die lebendigen, additiven Schichten (Gottesstrahlen, Kaustik, Marine Snow).
let underwaterBuf = null;     // gecachter statischer Verlauf (Smog -> Wasserlinie -> Tiefe) [Fallback]
let marineSnow = [];          // langsam sinkende Partikel (Position normiert 0..1, Tempo, Groesse) [Fallback]
const WATERLINE_FRAC = 0.30;  // Wasserlinie im oberen Drittel (Anteil der Hoehe)

// ===== WASSER-SHADER (Scene 2) =====
// Shader-basierter Backdrop: bewegte Oberflaeche + glaesernes Unterwasser. EIGENER WebGL-Buffer,
// getrennt von globeBuf (schuetzt Scene-1-Shader/Tiefen-State). Faellt auf drawUnderwater() zurueck,
// wenn createShader scheitert ODER prefers-reduced-motion gesetzt ist.
let waterBuf = null;           // WebGL-Graphics in reduzierter Aufloesung (hochskaliert wie GLOBE_BUF)
let waterShader = null;
let waterShaderFailed = false; // Shader nicht nutzbar -> dauerhaft Fallback drawUnderwater()
let waterReduceMotion = false; // prefers-reduced-motion -> Fallback (Ruhe statt Bewegung)
let waterProbed = false;       // einmalige Sicht-Pruefung nach dem ersten Render (faengt stillen Compile-Fehler)
const WATER_RENDER_SCALE = 0.5;// halbe Aufloesung -> ein Fragment-Pass, dann hochskaliert (60fps)
const WATER_MAX = 860;         // Deckel fuer die laengste Buffer-Kante
// ----- SONNEN-SHADER (Scene 1): eigener kleiner, QUADRATISCHER WebGL-Buffer (fixe Aufloesung) -----
// Die Sonne lebt im lokalen UV-Raum dieses Buffers (Scheibe + Protuberanzen + Korona); die Orbit-
// Position bleibt 2D und wird per ADD-Blit gesetzt. Faellt wie Wasser/Solar auf 2D zurueck.
let sunBuf = null;
let sunShader = null;
let sunShaderFailed = false;   // Shader nicht nutzbar -> dauerhaft 2D-Fallback drawSunFallback()
let sunProbed = false;         // einmalige Sicht-Pruefung nach dem ersten Render
const SUN_BUF = 512;           // feste Kantenlaenge (auflösungsunabhaengig, beim Blit skaliert)
const WATER_LIGHTDIR = [0.18, 1.0];       // Richtung ZUM Licht (uv-Raum, leicht rechts wie die Scene-1-Sonne)
const WATER_LIGHTCOL = [1.0, 0.95, 0.82]; // warm-weiss/gold (gefilterte Sonne durch den Smog)

// ===== SOLAR-SPACE-SHADER (Scene 3 „das eye") =====
// Heller Innenraum als GEGENPOL zu Scene 2: weisse Kuppel, Oculus im Scheitel, herabfallender
// Lichtkegel, ruhige Wasserflaeche unten, deren Licht RIPPELND an die Kuppel zurueckgeworfen wird
// (Kaustik-/Worley-Technik aus WATER_FRAG, hier nach OBEN projiziert). Eigener WebGL-Buffer wie
// das Wasser; faellt bei Shader-Fehler / reduced-motion auf das gecachte 2D-drawSolarSpaceFallback().
let solarBuf = null;
let solarShader = null;
let solarShaderFailed = false;     // Shader nicht nutzbar -> dauerhaft 2D-Fallback
let solarProbed = false;           // einmalige Sicht-Pruefung nach erstem Render
let solarStaticBuf = null;         // gecachter statischer 2D-Verlauf (Fallback): Kuppel + Kegel + Pool
const SOLAR_POOL_Y = 0.20;         // Wasserflaeche als Anteil von UNTEN (untere 20%)
const SOLAR_LIGHTCOL = [1.0, 0.97, 0.88]; // warm-weiss/gold (gefiltertes Oculus-Licht)

function buildSpace() {
  if (spaceBuf) spaceBuf.remove();
  const D = Math.ceil(Math.sqrt(vw() * vw() + vh() * vh())) + 4;   // Diagonale: Buffer deckt jede Rotation ab
  spaceBuf = createGraphics(D, D);
  spaceBuf.pixelDensity(1);
  drawDeepSpace(spaceBuf, D, D);    // Void + Nebel + Vignette (radial -> drehinvariant)
  buildStarfield(spaceBuf, D, D);   // Sterne darueber, fuellt twinkleStars
  bakeGlobeCalm(spaceBuf, D, D);    // ruhige, leicht abgedunkelte Zone hinter dem Globus (Buffer-Mitte = Bildmitte)
}

// alpha (0..1) blendet den ganzen Weltraum-Backdrop ein/aus (fuer den Szenen-Crossfade).
function drawSpace(alpha = 1) {
  if (!spaceBuf) buildSpace();
  // ganz leichte Drehung um die Bildmitte, gekoppelt an die Erddrehung (selbe Achse, Radius "hinter" dem Blick)
  const gl = allEntities.find(e => e.isGlobe);
  const ang = (gl ? gl.spinAngle : millis() / 1000 * -0.1) * STAR_COUPLE;
  push();
  imageMode(CENTER);
  translate(width / 2, height / 2);
  rotate(ang);
  tint(255, 255 * alpha);
  image(spaceBuf, 0, 0);   // Buffer-Mitte auf Bildmitte
  noTint();
  if (twinkleStars.length) {
    blendMode(ADD); noStroke();
    const now = millis() * 0.002, cx = spaceBuf.width / 2, cy = spaceBuf.height / 2;
    for (const s of twinkleStars) {
      const a = constrain(s.a + Math.sin(now + s.ph) * 40, 0, 255);
      fill(s.c[0], s.c[1], s.c[2], a * 0.6 * alpha);
      ellipse(s.x - cx, s.y - cy, s.r);   // Buffer-Koords relativ zur Mitte (im rotierten Frame)
    }
    blendMode(BLEND);
  }
  pop();
}

// Tiefer Raum: Void + faint Nebel + Staub + dezente Milchstrasse (Noise in Quarter-Res, hochskaliert)
function drawDeepSpace(g, w, h) {
  const VOID = [5, 6, 11];
  const NEB = [[40, 30, 52], [20, 40, 55], [55, 38, 30], [34, 22, 42]];   // entsaettigt: lila/teal/braun/magenta
  // RUHIG/realistisch (Erdnaehe): Nebel nur ein Hauch, Milchstrasse aus, viel Schwarz
  const NEB_CAP = 0.10, DUST_CAP = 0.18, MW_CAP = 0.0, VIGN = 0.55;
  const DS = 4;
  const sw = Math.max(2, Math.round(w / DS)), sh = Math.max(2, Math.round(h / DS));
  const buf = createGraphics(sw, sh); buf.pixelDensity(1);
  noiseSeed(7); noiseDetail(5, 0.55);
  buf.loadPixels();
  for (let py = 0; py < sh; py++) for (let px = 0; px < sw; px++) {
    const u = px / sw, v = py / sh;
    let r = VOID[0], gg = VOID[1], b = VOID[2];
    const wx = noise(u * 2.2, v * 2.2, 0.1), wy = noise(u * 2.2 + 3.3, v * 2.2 + 1.7, 0.1);
    let neb = noise(u * 2.6 + (wx - 0.5) * 0.9, v * 2.6 + (wy - 0.5) * 0.9, 0.1);
    neb = Math.pow(Math.max(0, (neb - 0.5) / 0.5), 1.7);
    const cn = noise(u * 0.8, v * 0.8, 10) * 3, i0 = Math.min(3, Math.floor(cn)), i1 = Math.min(3, i0 + 1), fr = cn - Math.floor(cn);
    const nA = neb * NEB_CAP;
    r += lerp(NEB[i0][0], NEB[i1][0], fr) * nA; gg += lerp(NEB[i0][1], NEB[i1][1], fr) * nA; b += lerp(NEB[i0][2], NEB[i1][2], fr) * nA;
    let dust = noise(u * 3.4 + 5, v * 3.4 + 9, 20); dust = Math.pow(Math.max(0, (dust - 0.55) / 0.45), 2);
    const dA = dust * DUST_CAP; r *= (1 - dA); gg *= (1 - dA); b *= (1 - dA);
    const diag = u * 0.9 + v, dd = Math.abs(diag - 0.95);
    const mA = Math.exp(-(dd * dd) / (2 * 0.16 * 0.16)) * (0.4 + 0.6 * noise(u * 5, v * 5, 30)) * MW_CAP;
    r += 150 * mA; gg += 150 * mA; b += 175 * mA;
    const k = 4 * (py * sw + px);
    buf.pixels[k] = Math.min(255, r); buf.pixels[k + 1] = Math.min(255, gg); buf.pixels[k + 2] = Math.min(255, b); buf.pixels[k + 3] = 255;
  }
  buf.updatePixels();
  g.background(VOID[0], VOID[1], VOID[2]);
  if (g.drawingContext) g.drawingContext.imageSmoothingEnabled = true;
  g.image(buf, 0, 0, w, h);
  const ctx = g.drawingContext;
  const diag = Math.hypot(vw(), vh());
  const vg = ctx.createRadialGradient(w * 0.5, h * 0.5, Math.min(vw(), vh()) * 0.22, w * 0.5, h * 0.5, diag * 0.46);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,' + VIGN + ')');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);
  buf.remove();
}

// Sternenfeld: viele schwache, wenige helle (Potenzgesetz), Blackbody-Farbe, Glow + Spikes fuer die hellsten
function buildStarfield(g, w, h) {
  g.noStroke(); twinkleStars = [];
  const N = Math.floor(w * h / 8000);   // SEHR SPARSAM: ~1 Stern / 8000 px^2 (ruhiger, realistischer Himmel; Zahl hoeher = noch weniger)
  const ctx = g.drawingContext;
  for (let i = 0; i < N; i++) {
    const x = Math.random() * w, y = Math.random() * h;
    const bMag = Math.pow(Math.random(), 3.2);          // viele schwach, wenige hell
    const alpha = 30 + bMag * 225;
    const temp = Math.pow(Math.random(), 0.55); let c;  // meist blau-weiss, wenige warm
    if (temp < 0.5) { const tt = temp / 0.5; c = [255, lerp(185, 245, tt), lerp(140, 235, tt)]; }
    else { const tt = (temp - 0.5) / 0.5; c = [lerp(255, 205, tt), lerp(245, 228, tt), 255]; }
    if (bMag < 0.92) {                                   // nur die obersten ~8% bekommen Glow -> ruhiger
      const dia = bMag < 0.5 ? 1.0 : 1.5;
      g.fill(c[0], c[1], c[2], alpha); g.ellipse(x, y, dia, dia);
    } else {
      const core = map(bMag, 0.92, 1, 1.6, 3.0), glow = map(bMag, 0.92, 1, 4, 12);
      const grad = ctx.createRadialGradient(x, y, 0, x, y, glow);
      grad.addColorStop(0, `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${(alpha / 255) * 0.9})`);
      grad.addColorStop(0.25, `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${(alpha / 255) * 0.32})`);
      grad.addColorStop(1, `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},0)`);
      ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(x, y, glow, 0, Math.PI * 2); ctx.fill();
      g.fill(255, 255, 255, alpha); g.ellipse(x, y, core, core);
      if (twinkleStars.length < 18 && Math.random() < 0.4)
        twinkleStars.push({ x, y, r: core, c, a: alpha, ph: Math.random() * Math.PI * 2 });
    }
  }
}

// ruhige, leicht abgedunkelte Zone hinter dem (mittig sitzenden) Globus -> Sterne stoeren den Halo nicht
function bakeGlobeCalm(g, w, h) {
  const cx = w / 2, cy = h / 2, gr = Math.min(vw(), vh()) * 0.19;
  const ctx = g.drawingContext;
  const grad = ctx.createRadialGradient(cx, cy, gr * 0.6, cx, cy, gr * 1.7);
  grad.addColorStop(0, 'rgba(5,7,13,0.6)'); grad.addColorStop(1, 'rgba(5,7,13,0)');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
}

// ============ UNTERWASSER-HINTERGRUND (Smog + Wasserlinie + Tiefe + lebendiges Licht) ============
// Querschnitt an der Wasserlinie (oberes Drittel): oben diesig-greller weissgoldener Smog-Himmel,
// darunter Verlauf Petrol -> Tiefblau -> nahezu Schwarz. Darueber leben Gottesstrahlen, Kaustik
// direkt unter der Oberflaeche und langsam sinkende Marine Snow. Statik gecacht, Rest pro Frame.

// statischen Verlauf einmal in einen Buffer backen (wie buildSpace) -> pro Frame nur ein image()
function buildUnderwater() {
  if (underwaterBuf) underwaterBuf.remove();
  const w = vw(), h = vh();
  underwaterBuf = createGraphics(w, h);
  underwaterBuf.pixelDensity(1);
  drawWaterColumn(underwaterBuf, w, h);
}

// Smog-Himmel + Wasserlinie + Tiefenverlauf + Lichtsaum + Tiefen-Vignette in einen Buffer zeichnen
function drawWaterColumn(g, w, h) {
  const wl = Math.round(h * WATERLINE_FRAC);   // y der Wasserlinie
  const ctx = g.drawingContext;
  // 1) Smog-Himmel ueber Wasser: diesig hell weissgold, zur Wasserlinie hin etwas satter
  let sky = ctx.createLinearGradient(0, 0, 0, wl);
  sky.addColorStop(0.0, '#f5edd6');            // grell weissgold
  sky.addColorStop(0.55, '#ecdcb8');
  sky.addColorStop(1.0, '#d8c79c');            // an der Wasserlinie waermer/satter
  ctx.fillStyle = sky; ctx.fillRect(0, 0, w, wl);
  // 2) Wassersaeule: Petrol (sonnendurchflutet) -> Tiefblau -> nahezu Schwarz in der Tiefe
  let sea = ctx.createLinearGradient(0, wl, 0, h);
  sea.addColorStop(0.0, '#2f6f7c');            // Petrol direkt unter der Oberflaeche
  sea.addColorStop(0.16, '#1c4f63');
  sea.addColorStop(0.46, '#0e2f47');           // Tiefblau
  sea.addColorStop(1.0, '#03070d');            // nahezu schwarz
  ctx.fillStyle = sea; ctx.fillRect(0, wl, w, h - wl);
  // 3) heller Lichtsaum direkt unter der Wasserlinie (Sonnenlicht bricht ein)
  let band = ctx.createLinearGradient(0, wl, 0, wl + h * 0.14);
  band.addColorStop(0, 'rgba(226,240,224,0.55)');
  band.addColorStop(1, 'rgba(226,240,224,0)');
  ctx.fillStyle = band; ctx.fillRect(0, wl, w, h * 0.14);
  // 4) Wasserlinie selbst: schmaler heller Saum
  ctx.fillStyle = 'rgba(244,248,234,0.8)'; ctx.fillRect(0, wl - 1, w, 2);
  // 5) Tiefen-Vignette: zieht den Blick nach unten in die Dunkelheit
  let vg = ctx.createRadialGradient(w * 0.5, wl + h * 0.12, Math.min(w, h) * 0.18,
                                    w * 0.5, h * 0.78, Math.hypot(w, h) * 0.62);
  vg.addColorStop(0, 'rgba(0,0,6,0)');
  vg.addColorStop(1, 'rgba(0,0,8,0.6)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);
}

// Partikel-Liste fuer Marine Snow einmal anlegen (normierte Koords -> resize-fest)
function buildMarineSnow() {
  marineSnow = [];
  const N = 150;
  for (let i = 0; i < N; i++) {
    marineSnow.push({
      x: Math.random(), y: Math.random(),
      vy: 0.018 + Math.random() * 0.04,   // normierte Sinkgeschwindigkeit /s (langsam)
      vx: (Math.random() - 0.5) * 0.01,   // ganz leichtes seitliches Driften /s
      r: 1 + Math.random() * 2.2,
      a: 35 + Math.random() * 95,
      ph: Math.random() * TWO_PI
    });
  }
}

// ein weicher Gottesstrahl (Lichtkegel) von der Wasserlinie nach unten, additiv, mit Tiefen-Fade
function drawGodRay(x, top, topW, botW, len, a) {
  const ctx = drawingContext;
  const grad = ctx.createLinearGradient(0, top, 0, top + len);
  grad.addColorStop(0, `rgba(255,250,224,${a})`);
  grad.addColorStop(0.5, `rgba(255,247,214,${a * 0.5})`);
  grad.addColorStop(1, 'rgba(255,247,214,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(x - topW / 2, top);
  ctx.lineTo(x + topW / 2, top);
  ctx.lineTo(x + botW / 2, top + len);
  ctx.lineTo(x - botW / 2, top + len);
  ctx.closePath();
  ctx.fill();
}

// flimmerndes Kaustik-Netz direkt unter der Wasserlinie (helle Knoten, additiv)
function drawCaustics(w, wl, h, t, alpha) {
  noStroke();
  const bandH = h * 0.18, rows = 11;
  for (let r = 0; r < rows; r++) {
    const yy = wl + (r / rows) * bandH;
    const fade = 1 - r / rows;                          // direkt unter der Linie am hellsten
    for (let x = 0; x <= w; x += 24) {
      // zwei ueberlagerte Sinus -> wanderndes Interferenzmuster
      const n = Math.sin(x * 0.028 + t * 0.9 + r * 0.6) * Math.sin(x * 0.011 - t * 0.6 + r * 1.3);
      const b = Math.max(0, n);
      const aa = b * b * 30 * fade * alpha;
      if (aa < 1) continue;
      fill(202, 236, 222, aa);
      const s = 5 + b * 7;
      ellipse(x + Math.sin(t * 0.5 + r) * 7, yy, s, s * 0.55);
    }
  }
}

// Hilfsfunktion: gecachten/gerenderten Buffer bildschirmfuellend (CORNER) mit Alpha blitten.
// Gekapselt mit push/pop, damit tint/imageMode den umliegenden p5-State nicht beeinflussen.
function blitBufferFull(buf, alpha) {
  push();
  imageMode(CORNER);
  tint(255, 255 * alpha);
  image(buf, 0, 0, width, height);
  pop();
}

// kompletter Unterwasser-Backdrop bei gegebenem Alpha (0..1) -> deckend bei 1, ausblendbar fuer Crossfade
function drawUnderwater(alpha = 1) {
  if (!underwaterBuf) buildUnderwater();
  if (!marineSnow.length) buildMarineSnow();
  const w = width, h = height, wl = h * WATERLINE_FRAC;
  const t = millis() / 1000, dt = Math.min(0.05, deltaTime / 1000);

  // statischer Verlauf (deckend bei alpha=1) als Basis
  blitBufferFull(underwaterBuf, alpha);

  // lebendige Schichten additiv darueber
  push();
  blendMode(ADD);
  noStroke();
  // Gottesstrahlen: wenige weiche Kegel von der Oberflaeche, langsam wandernd + sanft pulsierend
  const rays = 5;
  for (let i = 0; i < rays; i++) {
    const baseX = (i + 0.5) / rays * w;
    const sway = Math.sin(t * 0.06 + i * 1.7) * w * 0.05;          // langsames Wandern
    const x = baseX + sway;
    const len = h * (0.55 + 0.18 * Math.sin(t * 0.05 + i));
    const a = (0.05 + 0.035 * Math.sin(t * 0.4 + i * 2.1)) * alpha; // dezentes Pulsieren (0..~0.09)
    drawGodRay(x, wl, w * 0.045, w * 0.16, len, Math.max(0, a));
  }
  // Kaustik direkt unter der Wasserlinie
  if (CAUSTICS_AMOUNT > 0) drawCaustics(w, wl, h, t, alpha);
  // Marine Snow: langsam sinkende, feine Partikel (nur unter Wasser); SNOW_AMOUNT=0 -> aus
  if (SNOW_AMOUNT > 0) for (const p of marineSnow) {
    p.y += p.vy * dt;
    p.x += p.vx * dt;
    if (p.y > 1.03) { p.y = -0.03; p.x = Math.random(); }           // oben neu auftauchen
    const py = p.y * h;
    if (py < wl) continue;
    const px = (((p.x % 1) + 1) % 1) * w;
    fill(212, 226, 230, p.a * alpha);
    ellipse(px, py, p.r, p.r);
  }
  blendMode(BLEND);
  pop();
}

// =========================================================================
//  WASSER-SHADER (Scene 2) — bewegte Oberflaeche + glaesernes Unterwasser
//  Integration wie der Globus: eigener createGraphics(W,H,WEBGL)-Buffer + createShader,
//  als Vollbild-Backdrop komponiert; Entities zeichnen unveraendert im 2D-Layer darueber.
//
//  Die Techniken sind NACHGEBAUT (eigenes GLSL), inspiriert von diesen Shadertoy-Werken
//  (CC BY-NC-SA; dieses Projekt ist nicht-kommerziell/edukativ — HCU-Studienprojekt):
//    - Oberflaechen-/exp(sin)-Wellen + Fresnel/Glanz: "Seascape" von TDM            (Ms2SD1)
//    - Lichtschaefte / God Rays:                       "Light rays"                  (lljGDt)
//    - animierte Kaustik (Voronoi/Worley):             "Caustic Study #02: Pool"     (tX3BWl)
//  Angepasst an unsere SEITEN-Ansicht (Querschnitt an der Wasserlinie) + Smog-Palette.
// =========================================================================

// Vertex: simpler Durchreicher fuer das Vollbild-Plane (p5 liefert aPosition + Matrizen).
const WATER_VERT = `
precision highp float;
attribute vec3 aPosition;
uniform mat4 uModelViewMatrix, uProjectionMatrix;
void main(){ gl_Position = uProjectionMatrix * uModelViewMatrix * vec4(aPosition, 1.0); }`;

// Geteilter GLSL-Noise-Block fuer WATER_FRAG + SOLAR_FRAG: hash21 / vnoise / fbm / worley.
// Numerisch identisch in beiden Shadern -> hier einmal definiert, per String-Konkatenation
// in beide Fragmente eingebaut. GLSL-ES-1.00 tauglich (eigenstaendig, keine externen Includes).
const GLSL_NOISE = `
float hash21(vec2 p){
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  float a=hash21(i), b=hash21(i+vec2(1.0,0.0)), c=hash21(i+vec2(0.0,1.0)), d=hash21(i+vec2(1.0,1.0));
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}
float fbm(vec2 p){
  float v=0.0, a=0.5;
  for(int i=0;i<4;i++){ v += a*vnoise(p); p = p*2.0 + vec2(1.7,9.2); a*=0.5; }
  return v;
}
float worley(vec2 p, float t){
  vec2 ip=floor(p), fp=fract(p);
  float md=1.0;
  for(int j=-1;j<=1;j++)
  for(int i=-1;i<=1;i++){
    vec2 g=vec2(float(i),float(j));
    vec2 o=vec2(hash21(ip+g), hash21(ip+g+19.19));
    o = 0.5 + 0.5*sin(t + 6.2831*o);                   // Zellpunkte wandern (Animation)
    md = min(md, length(g+o-fp));
  }
  return md;
}
`;

// Fragment: rechnet pro Pixel ueber gl_FragCoord/uResolution (kein TexCoord noetig).
// Header (uniforms) + GLSL_NOISE + szenenspezifische Funktionen + main.
const WATER_FRAG = `
precision highp float;
uniform float uTime;
uniform vec2  uResolution;
uniform float uWaterlineY;   // Wasserlinie als Anteil von OBEN (0=oben .. 1=unten), ~0.30
uniform vec2  uLightDir;     // Richtung ZUM Licht (uv-Raum, y nach oben)
uniform vec3  uLightColor;   // warm-weiss/gold (gefilterte Sonne)
uniform float uSnow;         // Marine-Snow-Staerke (0 = aus)
uniform float uCaustics;     // Kaustik-Staerke (0 = aus)
` + GLSL_NOISE + `
// ---------- Oberflaeche: exp(sin)-Wellen (Technik: "Seascape", TDM / Ms2SD1) ----------
// Edge-on (1D): Summe weniger exp(sin)-Terme schaerft die Kaemme; leicht rauschmoduliert
// gegen Periodizitaet. Liefert die animierte Hoehe der Wasserlinie an Spalte x.
float waveHeight(float x, float t){
  float h=0.0, amp=1.0, freq=4.0, ph=0.0;
  for(int i=0;i<4;i++){
    float s = sin(x*freq + t*(0.6 + 0.25*freq) + ph);
    s = exp(s - 1.0);                                  // exp(sin): spitze Kaemme, flache Taeler
    s *= 0.6 + 0.4*vnoise(vec2(x*freq*0.5, t*0.2));    // dezente Unruhe
    h += s*amp;
    amp*=0.5; freq*=1.9; ph+=1.7;
  }
  return h;
}

// ---------- Kaustik: animiertes Worley (Technik: "Caustic Study #02: Pool" / tX3BWl) ----------
// worley() kommt aus GLSL_NOISE (oben einmal definiert).
float caustics(vec2 uv, float t){
  // 3 gestaffelte Lagen fuer Tiefen-/3D-Effekt: tiefere Lagen WENIGER Punkte UND durchsichtiger,
  // jede mit eigener Scroll-Geschwindigkeit (Parallaxe). Punktanzahl ~ Zellskala^2.
  float c = 0.0;
  // Lage 1 (vorn): Referenz -> volle Punktdichte (sc=7.0), volle Deckkraft
  float w1 = worley(uv*7.00 + vec2(t*0.12, t*0.03),        t*0.7);
  c += 1.00 * pow(max(0.0, 1.0 - w1), 6.0);
  // Lage 2 (Mitte): 25% weniger Punkte (sc*sqrt(0.75)=6.06), durchsichtiger
  float w2 = worley(uv*6.06 + vec2(t*0.24, t*0.03) + 11.3, t*0.7);
  c += 0.60 * pow(max(0.0, 1.0 - w2), 6.0);
  // Lage 3 (hinten): 50% weniger Punkte (sc*sqrt(0.5)=4.95), am durchsichtigsten
  float w3 = worley(uv*4.95 + vec2(t*0.36, t*0.03) + 23.7, t*0.7);
  c += 0.35 * pow(max(0.0, 1.0 - w3), 6.0);
  return c;
}

// ---------- God Rays: Lichtschaefte (Technik: "Light rays" / lljGDt) ----------
// Entlang der Lichtrichtung akkumulierte, von scrollendem Noise verdeckte Helligkeit
// -> leicht schwankende Schaefte. <= 24 Samples.
float godrays(vec2 uv, vec2 ldir, float t){
  float acc=0.0;
  vec2 p=uv;
  for(int i=0;i<24;i++){
    p += ldir * 0.02;                                   // Schritt Richtung Licht (zur Oberflaeche)
    float m = vnoise(vec2(p.x*7.0 + t*0.10, p.y*2.2 - t*0.03));  // scrollende Verdeckung
    acc += smoothstep(0.42, 0.95, m);
  }
  return acc / 24.0;
}

void main(){
  vec2 uv = gl_FragCoord.xy / uResolution;              // 0..1, y von UNTEN
  float aspect = uResolution.x / uResolution.y;
  float t = uTime;

  float surfaceY = 1.0 - uWaterlineY;                   // Wasserlinie als y-von-unten
  float xw = uv.x * aspect;                             // seitenverhaeltnis-korrigiertes x

  // animierte Oberflaechenhoehe (kleine Auslenkung)
  float wave = (waveHeight(xw*2.2, t) - 0.55) * 0.022;
  float surf = surfaceY + wave;                         // Oberflaeche an dieser Spalte
  float d = uv.y - surf;                                // >0 ueber Wasser, <0 unter Wasser

  // glaesernes Volumen: leichte horizontale Refraktions-Verzerrung, mit Tiefe zunehmend
  float depth = clamp((surf - uv.y) / max(surf, 0.001), 0.0, 1.0); // 0 Oberflaeche .. 1 Grund
  float wob = (fbm(vec2(uv.y*9.0 - t*0.08, t*0.05)) - 0.5);
  vec2 ruv = vec2(uv.x + wob*0.012*depth, uv.y);        // gebrochene UV fuer Tiefe/Kaustik

  // ===== Basisfarben IMMER berechnen (guenstig) -> erlaubt weichen Uebergang statt hartem if =====
  // Smog-Himmel (weiss-gold, nach oben heller)
  vec3 skyLo = vec3(0.82, 0.76, 0.58);
  vec3 skyHi = vec3(0.96, 0.93, 0.83);
  vec3 skyCol = mix(skyLo, skyHi, smoothstep(surfaceY, 1.0, uv.y));
  skyCol += (fbm(vec2(uv.x*3.0, uv.y*2.0) + t*0.015) - 0.5) * 0.04;  // Hauch Smog-Struktur
  // glaesernes Wasservolumen (Petrol/Teal -> Tiefblau -> fast Schwarz)
  vec3 teal = vec3(0.16, 0.40, 0.42);
  vec3 deep = vec3(0.04, 0.14, 0.24);
  vec3 ink  = vec3(0.01, 0.03, 0.06);
  // Teal->Tiefblau oben wie gehabt; das fast-schwarze Ink aber erst WEIT unten (~Wal-Hoehe, depth~0.74)
  // -> die mittlere Tiefblau-Zone (deep) wird deutlich laenger (Nutzerwunsch).
  vec3 waterCol = mix(teal, deep, smoothstep(0.0, 0.28, depth));
  waterCol = mix(waterCol, ink, smoothstep(0.60, 0.92, depth));

  // ===== WEICHER Wasserlinie-Uebergang (analytisches Anti-Aliasing) =====
  // smoothstep ueber ein schmales, AUFLOESUNGS-ABHAENGIGES Band (~2.5 Buffer-Pixel) -> glatte
  // Kante trotz halber Buffer-Aufloesung; ersetzt den harten if(d>0)-Sprung (war "pixelig").
  float aa = 2.5 / uResolution.y;
  float below = smoothstep(-aa, aa, -d);                 // 0 = Himmel, 1 = Wasser
  vec3 col = mix(skyCol, waterCol, below);

  // ===== Unterwasser-Lichteffekte: nur unter Wasser, weich ueber 'below' eingeblendet =====
  if(d < aa){
    // God Rays: mit der Tiefe ausblendend, additiv warm
    float gr = godrays(ruv, normalize(uLightDir), t);
    float grFade = 1.0 - smoothstep(0.0, 0.05,depth);   // ~1/3 so lang (frueher bis 0.85)
    col += uLightColor * gr * grFade * 0.5 * below;
    // Kaustik: am staerksten direkt unter der Oberflaeche, mit Tiefe schwaecher
    float ca = (uCaustics > 0.0) ? caustics(ruv * vec2(aspect, 1.0) * 3.0, t) : 0.0;
    float caFade = 1.0 - smoothstep(0.0, 0.1, depth);
    col += uLightColor * ca * caFade * 0.35 * below * uCaustics;
    // Marine Snow: SEHR WENIGE, langsam sinkende, feine Specks (additiv). Schwelle 0.99 statt
    // 0.965 + groebere Kachelung -> ~25% der bisherigen Dichte (auf Nutzerwunsch: viel weniger
    // weisse schwirrende Punkte im Wasser).
    vec2 sq = vec2(uv.x*aspect, uv.y) * 30.0;
    sq.y += t*0.5;                                       // sinkt langsam
    vec2 sip = floor(sq), sfp = fract(sq);
    if(uSnow > 0.0 && hash21(sip) > 0.99){               // uSnow=0 -> komplett aus
      float dd = length(sfp - 0.5);
      col += uLightColor * smoothstep(0.13, 0.0, dd) * 0.4 * (1.0 - depth*0.5) * below * uSnow;
    }
  }

  // ===== OBERFLAECHEN-BAND (edge-on): DUNKLE, dezente Linie + nur VEREINZELTE Glanzreflexe =====
  // (kein durchgehender heller Streifen mehr -> Oberflaeche dunkler, Licht blitzt nur stellenweise)
  float aw = abs(d);
  float line = exp(-pow(aw / 0.008, 2.0));              // sehr duenne, dezente Oberflaechenlinie
  // gedaempfte Smog-Reflexion knapp unter der Oberflaeche; 'below' (weich) statt hartem step
  float band = exp(-pow(max(0.0, -d) / 0.040, 2.0)) * below;
  vec3 reflCol = vec3(0.74, 0.70, 0.58);                // gedaempfte Smog-Reflexion (dunkler)
  col = mix(col, reflCol, band * 0.10);
  // vereinzelte, wandernde Glanzreflexe: nur die Rauschspitzen (hohe Schwelle) -> selten, verstreut
  float gz = vnoise(vec2(xw*15.0 - t*0.5, t*0.55));
  float spark = smoothstep(0.86, 0.99, gz);
  spark *= spark;                                       // schaerfer -> wirklich vereinzelt
  float sparkMask = exp(-pow(d / 0.014, 2.0));          // schmales Band um die Oberflaeche
  col += uLightColor * (line * 0.07 + spark * sparkMask * 0.75);

  // sanfte Tiefen-/Rand-Vignette (zieht den Blick in die Tiefe)
  float vig = smoothstep(1.15, 0.25, length((uv - vec2(0.5, surfaceY)) * vec2(aspect*0.7, 1.0)));
  col *= mix(0.78, 1.0, vig);

  gl_FragColor = vec4(col, 1.0);
}`;

// eigenen WebGL-Buffer + Shader anlegen (reduzierte Aufloesung, hochskaliert). Bei Fehler -> Fallback.
function ensureWaterBuffer() {
  if (waterReduceMotion || waterShaderFailed || waterBuf) return;
  try {
    let bw = Math.round(vw() * WATER_RENDER_SCALE);
    let bh = Math.round(vh() * WATER_RENDER_SCALE);
    const m = Math.max(bw, bh);
    if (m > WATER_MAX) { const k = WATER_MAX / m; bw = Math.round(bw * k); bh = Math.round(bh * k); }
    bw = Math.max(2, bw); bh = Math.max(2, bh);
    const buf = createGraphics(bw, bh, WEBGL);
    buf.pixelDensity(1);                                 // feste reduzierte Aufloesung (kein Retina-Doppeln)
    const sh = buf.createShader(WATER_VERT, WATER_FRAG);
    waterBuf = buf; waterShader = sh; waterProbed = false;
  } catch (e) {
    console.warn('Wasser-Shader nicht verfuegbar -> Fallback drawUnderwater()', e);
    waterShaderFailed = true;
    if (waterBuf) { waterBuf.remove(); waterBuf = null; }
    waterShader = null;
  }
}

// Shader-Wasser als Vollbild-Backdrop (Crossfade-Alpha wie space/underwater). Faellt auf
// drawUnderwater() zurueck bei reduced-motion, createShader-Fehler oder leerem ersten Render.
function drawWater(alpha = 1) {
  if (waterReduceMotion || waterShaderFailed || PERF_FLAT) { drawUnderwater(alpha); return; }
  ensureWaterBuffer();
  if (!waterBuf || !waterShader) { drawUnderwater(alpha); return; }
  try {
    const g = waterBuf;
    g.clear();
    g.noStroke();
    g.shader(waterShader);
    waterShader.setUniform('uTime', millis() / 1000);
    waterShader.setUniform('uResolution', [g.width, g.height]);
    waterShader.setUniform('uWaterlineY', WATERLINE_FRAC);
    waterShader.setUniform('uLightDir', WATER_LIGHTDIR);
    waterShader.setUniform('uLightColor', WATER_LIGHTCOL);
    waterShader.setUniform('uSnow', SNOW_AMOUNT);
    waterShader.setUniform('uCaustics', CAUSTICS_AMOUNT);
    g.plane(g.width + 2, g.height + 2);                  // Vollbild-Quad (kleiner Overscan gegen Randnaht)
    g.resetShader();
    // einmalige Sicht-Pruefung: rendert der Shader gar nichts (stiller Compile-Fehler) -> Fallback
    if (!waterProbed) {
      waterProbed = true;
      const px = g.get(g.width >> 1, g.height >> 1);
      if (!px || px[3] < 5) throw new Error('leerer Render (vermutlich Shader-Compile-Fehler)');
    }
  } catch (e) {
    console.warn('Wasser-Shader Render fehlgeschlagen -> Fallback drawUnderwater()', e);
    waterShaderFailed = true;
    if (waterBuf) { waterBuf.remove(); waterBuf = null; }
    waterShader = null;
    drawUnderwater(alpha);
    return;
  }
  blitBufferFull(waterBuf, alpha);                       // reduzierte Aufloesung hochskaliert
}

// =========================================================================
//  SOLAR-SPACE-SHADER (Scene 3 „das eye") — heller Kuppel-Innenraum mit Oculus
//  Aufbau wie das Wasser (eigener WebGL-Buffer, halbe Aufloesung, hochskaliert). Rehabilitiert
//  die Worley-/Kaustik-Technik aus WATER_FRAG als nach OBEN projizierte Decken-Reflexion.
// =========================================================================
const SOLAR_FRAG = `
precision highp float;
uniform float uTime;
uniform vec2  uResolution;
uniform float uPoolY;       // Wasserflaeche als Anteil von UNTEN (~0.20)
uniform vec3  uLightColor;  // warm-weiss/gold (Oculus-Licht)
` + GLSL_NOISE + `
// weiche, BREITE Rippel-Baender (niedriger Exponent) -> ruhige Decken-Reflexion, nicht punktig
float ripple(vec2 uv, float t){
  float w1=worley(uv*3.00 + vec2( t*0.10, t*0.05),       t*0.5);
  float w2=worley(uv*2.05 + vec2(-t*0.07, t*0.04)+7.3,   t*0.5);
  return pow(max(0.0,1.0-w1),2.5) + 0.55*pow(max(0.0,1.0-w2),2.5);
}
// schaerferes Kaustik-Geflecht fuer die Wasseroberflaeche
float caustics(vec2 uv, float t){
  float w=worley(uv*5.0 + vec2(t*0.12, t*0.04), t*0.6);
  return pow(max(0.0,1.0-w),5.0);
}

void main(){
  vec2 uv = gl_FragCoord.xy / uResolution;     // 0..1, y von UNTEN
  float aspect = uResolution.x / uResolution.y;
  float t = uTime * 0.18;                       // sehr ruhige, langsame Bewegung
  float poolY = uPoolY;
  vec2  oc = vec2(0.5, 0.92);                    // Oculus im Scheitel

  // ----- Kuppel: warmes Weiss, am hellsten am Oculus, sanft zur Peripherie verschattet -----
  vec2 q = (uv - oc) * vec2(aspect, 1.0);
  float r = length(q);
  vec3 warmWhite = vec3(1.0, 0.985, 0.95);
  vec3 domeShade = vec3(0.82, 0.815, 0.80);
  vec3 col = mix(warmWhite, domeShade, smoothstep(0.06, 1.05, r));
  col *= 1.0 + 0.015 * sin(r*22.0 - 0.4);       // zarte konzentrische Schalen (Andeutung Woelbung)
  col += (fbm(uv*vec2(aspect,1.0)*2.2 + t*0.05) - 0.5) * 0.025;  // Hauch Dunst-Struktur

  // ----- Oculus: heller warmer Kern + weicher Bloom-Halo -----
  col = mix(col, vec3(1.0, 0.99, 0.96), smoothstep(0.12, 0.0, r) * 0.95);
  col += uLightColor * smoothstep(0.55, 0.0, r) * 0.22;

  // ----- Lichtkegel: senkrecht vom Oculus, nach unten leicht aufweitend -----
  float descend = clamp((oc.y - uv.y) / (oc.y - poolY), 0.0, 1.0);  // 0 Oculus .. 1 Pool
  float coneHalf = mix(0.03, 0.20, descend);
  float dx = abs((uv.x - 0.5) * aspect);
  float cone = smoothstep(coneHalf, coneHalf*0.25, dx);
  cone *= (1.0 - 0.45*descend);                                     // nach unten leicht ausbleichend
  cone *= step(poolY, uv.y);                                        // nur ueber dem Wasser
  cone *= 0.8 + 0.2*vnoise(vec2(uv.x*6.0, uv.y*3.0 - t*0.3));       // leichte wandernde Verdeckung
  col += uLightColor * cone * 0.16;

  // ----- Staub im Strahl: sehr feine, langsam schwebende Specks, nur im Kegel -----
  vec2 dpp = vec2(uv.x*aspect, uv.y)*42.0;
  dpp.y += t*0.4;                                                   // langsames Treiben
  vec2 dip = floor(dpp), dfp = fract(dpp);
  if(uv.y > poolY && dx < coneHalf && hash21(dip) > 0.985){
    float dd = length(dfp - 0.5);
    col += uLightColor * smoothstep(0.16, 0.0, dd) * 0.5 * (0.6 + 0.4*sin(t*3.0 + dip.x));
  }

  // ----- Reflexion: der Pool wirft Licht RIPPELND an die Kuppel zurueck (nach oben projiziert) -----
  // am staerksten knapp ueber dem Wasser, zum Scheitel hin ausklingend; im Strahl betont.
  float lowness = 1.0 - smoothstep(poolY, oc.y, uv.y);              // 1 nahe Pool .. 0 am Oculus
  float rc = ripple(vec2(uv.x*aspect, (uv.y - poolY))*2.6, t);
  float reflMask = lowness * (0.5 + 0.5*cone);                      // im Kegel staerker
  col += uLightColor * rc * reflMask * 0.16 * step(poolY, uv.y);

  // ----- Wasserflaeche unten: ruhig, kuehler Hauch, gespiegeltes Oculus-Licht + Kaustik -----
  if(uv.y < poolY){
    float pd = (poolY - uv.y) / max(poolY, 0.001);                 // 0 Oberflaeche .. 1 Boden
    vec3 poolHi = vec3(0.80, 0.85, 0.89);                          // kuehler Hauch an der Wasserkante
    vec3 poolLo = vec3(0.52, 0.62, 0.70);
    vec3 pcol = mix(poolHi, poolLo, pd);
    float refl = smoothstep(0.18, 0.0, dx) * (1.0 - pd);           // Kegel-Fussabdruck auf dem Wasser
    pcol += uLightColor * refl * 0.45;
    float pc = caustics(vec2(uv.x*aspect, uv.y)*4.0, t);
    pcol += uLightColor * pc * 0.30 * (1.0 - pd*0.5);
    col = mix(col, pcol, smoothstep(0.0, 0.012, poolY - uv.y));    // weiche Wasserkante
  }

  // ----- weiche, helle Vignette + Hauch Weiss-Dunst (luftig, NICHT dunkel) -----
  float vig = smoothstep(1.5, 0.2, length((uv - vec2(0.5, 0.55)) * vec2(aspect*0.8, 1.0)));
  col *= mix(0.92, 1.0, vig);
  col = mix(col, vec3(0.985, 0.975, 0.95), 0.06);

  gl_FragColor = vec4(col, 1.0);
}`;

// =========================================================================
//  SONNEN-SHADER (Scene 1) — lebendiger Stern statt statischer Verlauf.
//  Realismus-Technik wie das Meer: geteilter GLSL_NOISE (fbm/worley) + domain warping.
//  Bausteine: Randverdunkelung (limb darkening), Granulation (Konvektionszellen),
//  turbulente Protuberanzen am Rand, rauschdurchzogene Korona. OPAKE Ausgabe auf
//  Schwarz -> wird additiv (ADD) an die Orbit-Position geblittet. uHeat/uIntensity
//  kommen aus dem CPU-Flackern (bleibt erhalten).
// =========================================================================
const SUN_FRAG = `
precision highp float;
uniform float uTime;
uniform vec2  uResolution;
uniform float uHeat;        // 0..1: Rotverschiebung gold -> rot-orange (atmet mit dem Flackern)
uniform float uIntensity;   // Helligkeits-Pumpen (Flackern)
` + GLSL_NOISE + `
void main(){
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec2 p  = uv - 0.5;                       // zentriert, Scheibe in der Mitte
  float r = length(p);
  float ang = atan(p.y, p.x);
  float t = uTime;

  const float RD = 0.165;                   // Scheibenradius in UV

  // organische Verformung (domain warping) fuer Granulation + Protuberanzen
  vec2 warp = vec2(fbm(p*6.0 + t*0.04), fbm(p*6.0 + 5.2 - t*0.05));

  // ----- Oberflaeche: Granulation (Konvektionszellen) + Randverdunkelung -----
  float gran  = fbm(p*15.0 + warp*1.4 + t*0.03);
  float cells = worley(p*11.0 + warp*0.8, t*0.18);         // grosse Zellen, langsam wabernd
  float mu    = sqrt(max(0.0, 1.0 - (r*r)/(RD*RD)));       // cos(Blickwinkel) -> limb darkening
  float limb  = 0.30 + 0.70*mu;
  float surf  = limb * (0.78 + 0.40*gran) * (0.72 + 0.45*(1.0 - cells));
  float disk  = smoothstep(RD, RD - 0.012, r);             // weiche Scheibenkante

  // ----- Hitze-Farbe: gold -> aggressives Rot-Orange (Flackern + Granulationstiefe) -----
  vec3 hot   = vec3(1.0, 0.42, 0.12);
  vec3 gold  = vec3(1.0, 0.83, 0.42);
  vec3 white = vec3(1.0, 0.96, 0.86);
  vec3 base    = mix(gold, hot, clamp(uHeat*0.55 + (1.0 - gran)*0.35, 0.0, 1.0));
  vec3 diskCol = mix(base, white, smoothstep(0.75, 1.25, surf)) * surf * uIntensity;
  vec3 col = diskCol * disk;

  // ----- Protuberanzen/Flares: turbulente Zungen knapp ueber dem Rand -----
  float fl = fbm(vec2(ang*2.2, r*7.0 - t*0.5) + warp*2.2);
  fl = pow(max(0.0, fl), 1.6);
  float promOuter = RD + 0.075 * fl;                       // Reichweite der Zunge nach aussen
  float prom = smoothstep(promOuter, RD - 0.01, r);        // 1 am Rand .. 0 aussen
  prom *= (1.0 - disk) * fl;                               // nur ausserhalb der Scheibe
  col += hot * prom * (0.9 + 0.7*uHeat) * uIntensity;

  // ----- Korona: weicher Aussen-Glow mit wandernden Straehnen -----
  float corona = clamp(exp(-(r - RD) * 6.5), 0.0, 1.0) * (1.0 - disk);
  float streak = 0.55 + 0.70*fbm(vec2(ang*3.0, r*3.5 - t*0.25));
  col += mix(hot, gold, 0.5) * corona * streak * (0.45 + 0.40*uIntensity);

  // kreisfoermige Randmaske: garantiert Schwarz VOR der quadratischen Buffer-Kante (r=0.5),
  // sonst wuerde der additive Blit einen sichtbaren rechteckigen Glow-Rand zeigen.
  col *= smoothstep(0.5, 0.34, r);

  gl_FragColor = vec4(col, 1.0);                           // opak auf Schwarz -> additiv geblittet
}`;

// kleinen quadratischen WebGL-Buffer + Sonnen-Shader anlegen. Bei Fehler -> 2D-Fallback.
function ensureSunBuffer() {
  if (waterReduceMotion || sunShaderFailed || sunBuf) return;
  try {
    const buf = createGraphics(SUN_BUF, SUN_BUF, WEBGL);
    buf.pixelDensity(1);                                   // feste Aufloesung (kein Retina-Doppeln)
    const sh = buf.createShader(WATER_VERT, SUN_FRAG);     // generischer Vollbild-Vertex (wie Wasser)
    sunBuf = buf; sunShader = sh; sunProbed = false;
  } catch (e) {
    console.warn('Sonnen-Shader nicht verfuegbar -> 2D-Fallback drawSunFallback()', e);
    sunShaderFailed = true;
    if (sunBuf) { sunBuf.remove(); sunBuf = null; }
    sunShader = null;
  }
}

// eigenen WebGL-Buffer + Shader anlegen (reduzierte Aufloesung). Bei Fehler -> 2D-Fallback.
function ensureSolarBuffer() {
  if (waterReduceMotion || solarShaderFailed || solarBuf) return;
  try {
    let bw = Math.round(vw() * WATER_RENDER_SCALE);
    let bh = Math.round(vh() * WATER_RENDER_SCALE);
    const m = Math.max(bw, bh);
    if (m > WATER_MAX) { const k = WATER_MAX / m; bw = Math.round(bw * k); bh = Math.round(bh * k); }
    bw = Math.max(2, bw); bh = Math.max(2, bh);
    const buf = createGraphics(bw, bh, WEBGL);
    buf.pixelDensity(1);
    const sh = buf.createShader(WATER_VERT, SOLAR_FRAG);   // generischer Vollbild-Vertex (wie Wasser)
    solarBuf = buf; solarShader = sh; solarProbed = false;
  } catch (e) {
    console.warn('Solar-Shader nicht verfuegbar -> 2D-Fallback', e);
    solarShaderFailed = true;
    if (solarBuf) { solarBuf.remove(); solarBuf = null; }
    solarShader = null;
  }
}

// Scene-3-Backdrop als Vollbild (Crossfade-Alpha wie space/underwater). Faellt auf
// drawSolarSpaceFallback() zurueck bei reduced-motion, ?flat, Shader-Fehler oder leerem Render.
function drawSolarSpace(alpha = 1) {
  if (waterReduceMotion || solarShaderFailed || PERF_FLAT) { drawSolarSpaceFallback(alpha); return; }
  ensureSolarBuffer();
  if (!solarBuf || !solarShader) { drawSolarSpaceFallback(alpha); return; }
  try {
    const g = solarBuf;
    g.clear();
    g.noStroke();
    g.shader(solarShader);
    solarShader.setUniform('uTime', millis() / 1000);
    solarShader.setUniform('uResolution', [g.width, g.height]);
    solarShader.setUniform('uPoolY', SOLAR_POOL_Y);
    solarShader.setUniform('uLightColor', SOLAR_LIGHTCOL);
    g.plane(g.width + 2, g.height + 2);
    g.resetShader();
    if (!solarProbed) {
      solarProbed = true;
      const px = g.get(g.width >> 1, g.height >> 1);
      if (!px || px[3] < 5) throw new Error('leerer Render (vermutlich Shader-Compile-Fehler)');
    }
  } catch (e) {
    console.warn('Solar-Shader Render fehlgeschlagen -> 2D-Fallback', e);
    solarShaderFailed = true;
    if (solarBuf) { solarBuf.remove(); solarBuf = null; }
    solarShader = null;
    drawSolarSpaceFallback(alpha);
    return;
  }
  blitBufferFull(solarBuf, alpha);
}

// ----- 2D-Fallback (reduced-motion / Shader-Fehler): gecachte statische Kuppel + Pool + Kegel,
// darueber pro Frame nur wenige guenstige, langsame Rippel-Baender + Staub. -----
function buildSolarStatic() {
  if (solarStaticBuf) solarStaticBuf.remove();
  const w = Math.max(2, vw()), h = Math.max(2, vh());
  const g = createGraphics(w, h); g.pixelDensity(1);
  const ctx = g.drawingContext;
  const poolTopY = h * (1 - SOLAR_POOL_Y);     // Wasserkante (px von oben)
  const ocx = w * 0.5, ocy = h * 0.08;          // Oculus nahe oben
  ctx.clearRect(0, 0, w, h);
  // Kuppel: radialer Verlauf vom Oculus (warm-weiss -> sanftes Grau-Weiss)
  let dome = ctx.createRadialGradient(ocx, ocy, 0, ocx, ocy, Math.hypot(w, h) * 0.9);
  dome.addColorStop(0.0, '#fffdf6'); dome.addColorStop(0.5, '#f1ede4'); dome.addColorStop(1.0, '#d6d2ca');
  ctx.fillStyle = dome; ctx.fillRect(0, 0, w, poolTopY);
  // Lichtkegel (nach unten aufweitend)
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(ocx - w * 0.03, ocy); ctx.lineTo(ocx + w * 0.03, ocy);
  ctx.lineTo(ocx + w * 0.17, poolTopY); ctx.lineTo(ocx - w * 0.17, poolTopY); ctx.closePath();
  let cone = ctx.createLinearGradient(0, ocy, 0, poolTopY);
  cone.addColorStop(0, 'rgba(255,250,228,0.40)'); cone.addColorStop(1, 'rgba(255,250,228,0.05)');
  ctx.fillStyle = cone; ctx.fill();
  ctx.restore();
  // Oculus-Scheibe (heller Kern + Halo)
  let ocl = ctx.createRadialGradient(ocx, ocy, 0, ocx, ocy, h * 0.17);
  ocl.addColorStop(0, 'rgba(255,253,246,1)'); ocl.addColorStop(1, 'rgba(255,250,236,0)');
  ctx.fillStyle = ocl; ctx.fillRect(0, 0, w, poolTopY);
  // Pool: kuehler vertikaler Verlauf
  let pool = ctx.createLinearGradient(0, poolTopY, 0, h);
  pool.addColorStop(0, '#ccd6dc'); pool.addColorStop(1, '#8493a0');
  ctx.fillStyle = pool; ctx.fillRect(0, poolTopY, w, h - poolTopY);
  // gespiegeltes Oculus-Licht auf dem Wasser
  let foot = ctx.createRadialGradient(ocx, poolTopY, 0, ocx, poolTopY, w * 0.24);
  foot.addColorStop(0, 'rgba(255,250,232,0.6)'); foot.addColorStop(1, 'rgba(255,250,232,0)');
  ctx.fillStyle = foot; ctx.fillRect(0, poolTopY, w, h - poolTopY);
  solarStaticBuf = g;
}
function drawSolarSpaceFallback(alpha = 1) {
  if (!solarStaticBuf) buildSolarStatic();
  blitBufferFull(solarStaticBuf, alpha);
  // ruhige, langsame Decken-Reflexion: ein paar breite, wandernde Lichtbaender knapp ueber dem Wasser
  push();
  const t = millis() * 0.0004;
  const poolTopPx = height * (1 - SOLAR_POOL_Y);
  blendMode(ADD); noStroke();
  for (let i = 0; i < 4; i++) {
    const yy = poolTopPx - (i * 0.10 + 0.02) * height + Math.sin(t * 6 + i) * 8;
    const bx = width * 0.5 + Math.sin(t * 3 + i * 1.7) * width * 0.18;
    const bw = width * (0.18 + 0.05 * i);
    const a = (28 - i * 5) * alpha;
    fill(255, 250, 232, Math.max(0, a));
    ellipse(bx, yy, bw, height * 0.05);
  }
  // Staub im Strahl
  for (let i = 0; i < 18; i++) {
    const dy = ((t * 30 + i * 53) % (poolTopPx - height * 0.10)) + height * 0.10;
    const dxr = width * 0.5 + Math.sin(t * 9 + i) * width * 0.06 * (dy / poolTopPx);
    fill(255, 250, 235, 70 * alpha);
    ellipse(dxr, dy, 2.2, 2.2);
  }
  blendMode(BLEND);
  pop();
}

// ===== PROZEDURALE KLEINFAUNA (Scene 2): Krill-Schwarm + Fisch-Boids (KEINE Bilder) =====
// Ueber dem Wasser-Backdrop, unter den Bild-Entities gezeichnet (drawSceneBackdrop), blendet mit
// dem Crossfade (alpha). Bewegung aus der Locomotion-Recherche: Krill = dichte Gauss-Wolke mit
// Kohaesions-Feder + metachronalem Schimmer + Diel-Heben; Fische = Boids (Separation/Alignment/
// Kohaesion + Wander), klein+viel, schwarze Silhouetten, tiefer = fester schwarz, eine Schule
// migriert vertikal. Positionen normiert (resize-fest).
const KRILL_COUNT = 30;  // Krill-Partikel (+50% ggue. letztem Stand 20; davor 80, urspruenglich 150)
let krillSwarm = null;   // { parts:[{hx,hy,x,y,r,a,ph,jx,jy}] }
let fishSchools = [];    // [{ fish:[{x,y,vx,vy,sc}], cx0,cy0,amp,sp,sizeFactor,cruise,deep,ph }]

function buildScene2Fauna() {
  // Krill: dichte Gauss-Wolke; jede Partikel federt zu ihrem Home-Offset (dichter Kern, duenner Rand)
  const kp = [];
  for (let i = 0; i < KRILL_COUNT; i++) {                              // 20 = 25% (war 80, davor 150)
    const gx = (Math.random() + Math.random() + Math.random()) / 3 - 0.5;   // ~Gauss
    const gy = (Math.random() + Math.random() + Math.random()) / 3 - 0.5;
    kp.push({
      hx: gx * 0.15, hy: gy * 0.10, x: 0.5 + gx * 0.15, y: 0.53 + gy * 0.10,
      r: 1.0 + Math.random() * 1.2, a: 28 + Math.random() * 55,
      ph: Math.random() * TWO_PI, jx: Math.random() * TWO_PI, jy: Math.random() * TWO_PI
    });
  }
  krillSwarm = { parts: kp };

  // Fischschwaerme: dicht, unregelmaessige Abstaende, je Schwarm eigene dynamische Gangart.
  // Positionen getrennt, damit keine zwei Schwaerme uebereinander liegen ('doppelt'-Eindruck).
  fishSchools = [];
  const CFG = [
    { n: 38, cx0: 0.24, cy0: 0.42, amp: 0.16, sp: 0.034, sz: 0.0020, cruise: 0.020, deep: false },
    { n: 80, cx0: 0.66, cy0: 0.36, amp: 0.18, sp: 0.026, sz: 0.0024, cruise: 0.018, deep: false },
    { n: 50, cx0: 0.80, cy0: 0.74, amp: 0.14, sp: 0.040, sz: 0.0022, cruise: 0.016, deep: true },   // tief, rechts (weg von den anderen)
    { n: 60, cx0: 0.50, cy0: 0.74, amp: 0.06, sp: 0.030, sz: 0.0021, cruise: 0.014, deep: false }   // dicht DIREKT unter der Station (kleines amp -> bleibt zentriert; zeichnet hinter der Station)
  ];
  for (const c of CFG) {
    const fish = [];
    const spread = 0.055;
    for (let i = 0; i < c.n; i++) {
      // dreieckig verteilter Start -> dichter Kern, ausgefranster Rand (nicht gleichmaessig)
      const gx = Math.random() + Math.random() - 1.0;
      const gy = Math.random() + Math.random() - 1.0;
      fish.push({
        x: c.cx0 + gx * spread, y: c.cy0 + gy * spread * 0.65,
        vx: (Math.random() - 0.5) * c.cruise, vy: 0, sc: 0.7 + Math.random() * 0.6,
        ps2: Math.pow(0.008 + Math.random() * 0.014, 2),     // individuelle Mindestabstaende -> unregelmaessig
        wph: Math.random() * TWO_PI, wsp: 0.6 + Math.random() * 1.1   // individuelles Wandern (entgittert)
      });
    }
    fishSchools.push({ fish, cx0: c.cx0, cy0: c.cy0, amp: c.amp, sp: c.sp,
      sizeFactor: c.sz, cruise: c.cruise, deep: c.deep, ph: Math.random() * TWO_PI,
      gait: 0.6, gaitTarget: 0.6, gaitTimer: Math.random() * 2.0, gaitRate: 0.06 });  // dynamische Gangart
  }
}

function drawScene2Fauna(alpha) {
  if (PERF_NOFAUNA) return;
  if (!krillSwarm) buildScene2Fauna();
  const w = width, h = height, mm = Math.min(w, h);
  const t = millis() / 1000, dt = Math.min(0.05, deltaTime / 1000);

  push();
  noStroke();

  // === Krill: dichte glitzernde Gauss-Wolke (additiv), Schwerpunkt wandert langsam + Diel-Heben ===
  const kcx = 0.5 + 0.15 * Math.sin(t * 0.045);
  const kcy = 0.53 + 0.05 * Math.sin(t * 0.030) + 0.03 * Math.sin(t * 0.012);   // + Diel-Migration
  blendMode(ADD);
  for (const p of krillSwarm.parts) {
    const tx = kcx + p.hx + Math.sin(t * 0.9 + p.jx) * 0.0016;       // Ziel = Schwerpunkt + Home + Jitter
    const ty = kcy + p.hy + Math.cos(t * 0.8 + p.jy) * 0.0013;
    p.x += (tx - p.x) * 0.05; p.y += (ty - p.y) * 0.05;             // Kohaesions-Feder
    const tw = 0.55 + 0.45 * Math.sin(t * 7.0 + p.ph);              // metachronaler Schimmer
    const d = depthDim(p.y);
    fill(200 * d, 226 * d, 218 * d, p.a * tw * d * alpha);
    ellipse(p.x * w, p.y * h, p.r, p.r);
  }
  blendMode(BLEND);

  // === Fischschwaerme: schwarze Silhouetten, Boids (Separation/Alignment/Kohaesion + Wander) ===
  const perc2 = 0.06 * 0.06;
  for (const sch of fishSchools) {
    // dynamische Gangart pro Schwarm: schleichen -> ploetzlich sprinten -> fast stehen, eigener
    // Zufall/Timing je Schwarm. gait = Tempo-Multiplikator, sanft zum jeweiligen Ziel gefuehrt.
    sch.gaitTimer -= dt;
    if (sch.gaitTimer <= 0) {
      const r = Math.random();
      if (r < 0.30)      { sch.gaitTarget = 0.06 + Math.random() * 0.12; sch.gaitTimer = 0.7 + Math.random() * 2.2; sch.gaitRate = 0.05; } // fast stehen
      else if (r < 0.55) { sch.gaitTarget = 2.4 + Math.random() * 1.8;  sch.gaitTimer = 0.4 + Math.random() * 1.0; sch.gaitRate = 0.20; } // Sprint
      else               { sch.gaitTarget = 0.5 + Math.random() * 0.5;  sch.gaitTimer = 1.5 + Math.random() * 3.0; sch.gaitRate = 0.06; } // Cruise
    }
    sch.gait += (sch.gaitTarget - sch.gait) * Math.min(1, sch.gaitRate * dt * 60);
    const tx = sch.cx0 + sch.amp * Math.sin(t * sch.sp + sch.ph);    // Wander-Ziel des Schwarms
    const ty = sch.deep ? (0.74 + 0.07 * Math.sin(t * 0.012))        // tiefer Schwarm: dezente Vertikal-Migration
                        : (sch.cy0 + 0.03 * Math.sin(t * sch.sp * 1.3 + sch.ph));
    const ebb = sch.gait * sch.cruise;                              // aktuelles Schwarm-Tempo
    const resp = 0.05 + 0.10 * Math.min(1, sch.gait / 2);           // Sprint -> schnellere Reaktion (knackig)
    for (const f of sch.fish) {
      let alx = 0, aly = 0, cox = 0, coy = 0, sepx = 0, sepy = 0, nn = 0;
      for (const g of sch.fish) {
        if (g === f) continue;
        const dx = g.x - f.x, dy = g.y - f.y, d2 = dx * dx + dy * dy;
        if (d2 < perc2) {
          alx += g.vx; aly += g.vy; cox += g.x; coy += g.y; nn++;
          if (d2 < f.ps2) { const dd = Math.sqrt(d2) + 1e-5; sepx -= dx / dd; sepy -= dy / dd; }  // individueller Mindestabstand
        }
      }
      let dvx = (tx - f.x) * 0.30, dvy = (ty - f.y) * 0.30;          // Wander zum Schwarm-Ziel
      if (nn > 0) {
        alx /= nn; aly /= nn; cox /= nn; coy /= nn;
        dvx += alx * 1.0 + (cox - f.x) * 0.45 + sepx * 0.012;        // Alignment + Kohaesion (fester=enger) + Separation
        dvy += aly * 1.0 + (coy - f.y) * 0.45 + sepy * 0.012;
      }
      dvx += Math.sin(t * f.wsp + f.wph) * 0.15;                     // individuelles Wandern -> unregelmaessige Abstaende
      dvy += Math.cos(t * f.wsp * 0.9 + f.wph) * 0.12;
      const dm = Math.hypot(dvx, dvy) + 1e-6;
      f.vx += ((dvx / dm) * ebb - f.vx) * resp;                      // sanft/knackig zur Wunschrichtung
      f.vy += ((dvy / dm) * ebb - f.vy) * resp;
      f.x += f.vx * dt; f.y += f.vy * dt;
      f.y = Math.max(0.33, Math.min(0.96, f.y));                     // unter der Wasserlinie halten
    }
    // zeichnen: schwarze Silhouetten als Strich-Kapseln (1 Op/Fisch statt push/rotate/ellipse/pop).
    // Ausrichtung an der Schwimmrichtung; Strichbreite = Koerperhoehe; tiefer = fester schwarz.
    const depthT = Math.max(0, Math.min(1, (ty - WATERLINE_FRAC) / (1 - WATERLINE_FRAC)));
    stroke(8, 12, 16, 200 * alpha * (1 + 0.25 * depthT));
    const bw = mm * sch.sizeFactor;                                  // Koerperhoehe = Strichbreite
    strokeWeight(bw); strokeCap(ROUND);
    for (const f of sch.fish) {
      const vm = Math.hypot(f.vx, f.vy) + 1e-6;
      const hx = f.vx / vm * bw * 1.3, hy = f.vy / vm * bw * 1.3;    // halbe Koerperlaenge in Schwimmrichtung
      line(f.x * w - hx, f.y * h - hy, f.x * w + hx, f.y * h + hy);
    }
    noStroke();
  }
  pop();
}

// Platzhalter fuer das Stations-Hero, bis station_cutaway.png existiert: eine prozedurale
// Bimsstein-Insel-Silhouette mit Blasenloechern (warm bewohnt / dunkel) + versiegelter Krone
// ueber Wasser (Schacht + Kollektor + glattes Dach). Origin = Entity-Mitte; top = Wasserlinie lokal.
function drawIslandPlaceholder(sz, top, alpha) {
  const ctx = drawingContext;
  const Wp = sz * 0.46;            // Breite des Steins
  const lx = -Wp / 2, rx = Wp / 2;
  // Hoehe haengt an der GROESSE (sz), nicht am Wasserlinie-Mitte-Abstand -> proportional skalierbar:
  // Krone an der Wasserlinie (top), Koerper ~0.62*sz tief darunter. So bleibt die Form bei kleinerer
  // scale gut proportioniert (statt zu schmalem Splitter) und laesst Wasser-Platz nach unten.
  const bottom = top + sz * 0.62;  // unteres Ende des Steins (lokal)
  ctx.save();
  ctx.globalAlpha = alpha;
  // poroese Stein-Silhouette (organische Bezier-Kontur, oben an der Wasserlinie, nach unten verjuengt)
  ctx.beginPath();
  ctx.moveTo(lx, top + sz * 0.05);
  ctx.bezierCurveTo(lx, top - sz * 0.015, -Wp * 0.20, top - sz * 0.02, -Wp * 0.04, top - sz * 0.01);
  ctx.bezierCurveTo(Wp * 0.16, top - sz * 0.02, rx, top - sz * 0.005, rx, top + sz * 0.06);
  ctx.bezierCurveTo(rx * 1.05, top + (bottom - top) * 0.5, Wp * 0.30, bottom, 0, bottom);
  ctx.bezierCurveTo(-Wp * 0.32, bottom, lx * 1.05, top + (bottom - top) * 0.5, lx, top + sz * 0.05);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, top, 0, bottom);
  g.addColorStop(0, 'rgb(104,98,90)');     // poroeser Stein, vom Smog beleuchtet
  g.addColorStop(0.45, 'rgb(58,60,62)');
  g.addColorStop(1, 'rgb(16,22,28)');      // unten in der Tiefe
  ctx.fillStyle = g; ctx.fill();
  // Blasenloecher: einige warm bewohnt (Glow), einige dunkel
  const holes = [
    [-0.22, 0.14, 0.052, 1], [0.12, 0.10, 0.044, 1], [0.26, 0.24, 0.040, 0],
    [-0.06, 0.30, 0.050, 1], [0.00, 0.50, 0.058, 0], [-0.28, 0.40, 0.038, 0],
    [0.30, 0.46, 0.046, 1], [-0.16, 0.58, 0.044, 0], [0.16, 0.66, 0.038, 1],
    [-0.02, 0.74, 0.050, 0], [0.34, 0.66, 0.034, 0]
  ];
  for (const [hx, hy, hr, warm] of holes) {
    const cx = hx * Wp, cy = top + hy * (bottom - top), r = hr * sz;
    if (warm) {
      const wg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.8);
      wg.addColorStop(0, 'rgba(255,198,122,0.95)');
      wg.addColorStop(0.5, 'rgba(232,150,80,0.5)');
      wg.addColorStop(1, 'rgba(232,150,80,0)');
      ctx.fillStyle = wg; ctx.beginPath(); ctx.arc(cx, cy, r * 1.8, 0, TWO_PI); ctx.fill();
      ctx.fillStyle = 'rgba(255,224,176,1)'; ctx.beginPath(); ctx.arc(cx, cy, r * 0.5, 0, TWO_PI); ctx.fill();
    } else {
      ctx.fillStyle = 'rgba(6,10,14,0.85)'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TWO_PI); ctx.fill();
    }
  }
  // Krone ueber Wasser: schlanker Schacht + Kollektor + versiegeltes glattes Dach
  const crownW = sz * 0.15, crownH = sz * 0.085, shaftH = sz * 0.11;
  ctx.fillStyle = 'rgb(208,212,212)';
  ctx.fillRect(-sz * 0.011, top - shaftH, sz * 0.022, shaftH);                  // Schacht
  ctx.fillStyle = 'rgb(240,240,230)';
  ctx.beginPath(); ctx.arc(0, top - shaftH, sz * 0.017, 0, TWO_PI); ctx.fill(); // Kollektor (Knauf)
  const dg = ctx.createLinearGradient(0, top - crownH, 0, top);
  dg.addColorStop(0, 'rgb(240,238,228)');
  dg.addColorStop(1, 'rgb(198,196,186)');
  ctx.fillStyle = dg;
  ctx.beginPath();
  ctx.moveTo(-crownW / 2, top);
  ctx.quadraticCurveTo(-crownW / 2, top - crownH, 0, top - crownH);
  ctx.quadraticCurveTo(crownW / 2, top - crownH, crownW / 2, top);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

// --- Sonne + Mond umkreisen die Erde (Bildmitte). Erd-Beleuchtung folgt der Sonne (currentSunWorld). ---
const SUN_ORBIT_SPEED = 0.06, MOON_ORBIT_SPEED = 0.13;   // rad/s (Sonne langsam, Mond sichtbar kreisend)
const SUN_ORBIT_R = 0.42, MOON_ORBIT_R = 0.30;           // Orbit-Radius * min(w,h)
const SUN_START = 0.5;                                    // Start-Winkel (~ oben-rechts wie zuvor)
const SUN_KXY = 0.6, SUN_KZ = 0.78;                       // seitlicher vs. frontaler Lichtanteil (KZ hoch -> meist Tag)

// Orbit-Winkel der Sonne in Radiant (zeitabhaengig). Quelle der Wahrheit fuer alle Stellen,
// die "wo steht die Sonne gerade?" wissen muessen (Erd-Beleuchtung + Sichtbare Sonnenposition).
function sunOrbitAngle() {
  return millis() / 1000 * SUN_ORBIT_SPEED + SUN_START;
}
// Weltrichtung zur Sonne aus dem Orbit-Winkel; +y_SUN = oben (empirisch), passt zur sichtbaren Sonnenposition
function currentSunWorld() {
  const a = sunOrbitAngle();
  return norm3([Math.cos(a) * SUN_KXY, -Math.sin(a) * SUN_KXY, SUN_KZ]);   // -sin: Erdlicht oben, wenn Sonne oben
}

// alpha (0..1) blendet Sonne + Mond mit der Weltraum-Szene ein/aus (Crossfade). globalAlpha
// skaliert alle nachfolgenden Canvas-Alphas der Gradienten in drawSun/drawMoon.
function drawSunMoon(alpha = 1) {
  if (alpha <= 0.001) return;
  const ctx = drawingContext, prevGA = ctx.globalAlpha;
  ctx.globalAlpha = alpha;
  const mm = Math.min(width, height), cx = width / 2, cy = height / 2;
  const sa = sunOrbitAngle();
  const ma = millis() / 1000 * MOON_ORBIT_SPEED;
  const sx = cx + Math.cos(sa) * SUN_ORBIT_R * mm, sy = cy - Math.sin(sa) * SUN_ORBIT_R * mm; // sin>0 -> oben
  const mx = cx + Math.cos(ma) * MOON_ORBIT_R * mm, my = cy - Math.sin(ma) * MOON_ORBIT_R * mm;
  drawSun(sx, sy, mm * 0.05);                              // groesser
  let ldx = sx - mx, ldy = sy - my; const ln = Math.hypot(ldx, ldy) || 1;  // Lichtrichtung Mond -> Sonne
  drawMoon(mx, my, mm * 0.032, ldx / ln, ldy / ln);        // kleiner, Phase folgt der Sonne
  ctx.globalAlpha = prevGA;
}

// Sonnensturm-Auswurf: kleine gluehende Partikel, die unregelmaessig vom Rand abgestossen werden.
// Wird in drawSun() (einmal pro Frame, wenn Szene 1 sichtbar) fortgeschrieben + gezeichnet.
let sunEjecta = [];
// lineare Farbmischung zweier RGB-Tripel (k=0..1)
function mixRGB(a, b, k) {
  return [Math.round(a[0] + (b[0] - a[0]) * k),
          Math.round(a[1] + (b[1] - a[1]) * k),
          Math.round(a[2] + (b[2] - a[2]) * k)];
}

// Multi-Frequenz-Flackern (0..1) -> treibt sowohl Shader (uHeat/uIntensity) als auch 2D-Fallback.
// Unregelmaessig durch ueberlagerte Sinus-Frequenzen, kein gleichmaessiges Pulsen.
function sunFlicker(t) {
  let f = 0.45 * Math.sin(t * 7.3) + 0.30 * Math.sin(t * 13.7 + 1.3)
        + 0.15 * Math.sin(t * 23.1 + 2.7) + 0.10 * Math.sin(t * 3.1);
  return 0.5 + 0.5 * f;   // 0..1, betont
}

// Sonne: WebGL-Shader-Pfad (lebendiger Stern). Faellt auf das 2D-drawSunFallback() zurueck bei
// reduced-motion, createShader-Fehler oder leerem ersten Render. Flackern bleibt CPU-seitig und
// geht als uHeat/uIntensity in den Shader (das Pumpen bleibt damit erhalten).
function drawSun(x, y, r) {
  if (waterReduceMotion || sunShaderFailed || PERF_FLAT) { drawSunFallback(x, y, r); return; }
  ensureSunBuffer();
  if (!sunBuf || !sunShader) { drawSunFallback(x, y, r); return; }
  const t = millis() / 1000;
  const flick = sunFlicker(t);
  const heat = 0.45 + 0.45 * flick;        // Rotverschiebung atmet mit
  const intensity = 0.85 + 0.40 * flick;   // Helligkeit pumpt
  try {
    const g = sunBuf;
    g.clear();
    g.noStroke();
    g.shader(sunShader);
    sunShader.setUniform('uTime', t);
    sunShader.setUniform('uResolution', [g.width, g.height]);
    sunShader.setUniform('uHeat', heat);
    sunShader.setUniform('uIntensity', intensity);
    g.plane(g.width + 2, g.height + 2);                  // Vollbild-Quad (kleiner Overscan gegen Randnaht)
    g.resetShader();
    // einmalige Sicht-Pruefung: rendert der Shader nichts (stiller Compile-Fehler) -> Fallback.
    // Mitte = heller Scheibenkern -> pruefe RGB-Summe (alpha ist konstant opak).
    if (!sunProbed) {
      sunProbed = true;
      const px = g.get(g.width >> 1, g.height >> 1);
      if (!px || (px[0] + px[1] + px[2]) < 8) throw new Error('leerer Sun-Render (vermutlich Shader-Compile-Fehler)');
    }
  } catch (e) {
    console.warn('Sonnen-Shader Render fehlgeschlagen -> 2D-Fallback drawSunFallback()', e);
    sunShaderFailed = true;
    if (sunBuf) { sunBuf.remove(); sunBuf = null; }
    sunShader = null;
    drawSunFallback(x, y, r);
    return;
  }
  // additiv an die Orbit-Position blitten; Buffer deckt Scheibe + Protuberanzen + Korona.
  // D = Blit-Durchmesser ~ Korona-Reichweite (Scheibenradius RD=0.165 -> Kern ~ r auf dem Schirm).
  push();
  blendMode(ADD);
  imageMode(CENTER);
  const D = r * 11;
  image(sunBuf, x, y, D, D);
  pop();
}

// 2D-Fallback (reduced-motion / Shader-Fehler): der prozedurale Sonnensturm auf Canvas-Basis.
function drawSunFallback(x, y, r) {
  const ctx = drawingContext;
  const t = millis() / 1000;
  const dt = Math.min(0.05, deltaTime / 1000);

  // unregelmaessiges Flackern (geteilt mit dem Shader-Pfad)
  const flick = sunFlicker(t);
  const intensity = 0.78 + 0.55 * flick;              // Glow-Helligkeit pumpt
  const heat = 0.45 + 0.45 * flick;                   // 0=gold .. 1=aggressiv rot-orange (atmet mit)

  // Farbpole: ruhiges Gold -> heisses Rot-Orange; mit dem Flackern dazwischen geblendet
  const goldGlow = [255, 222, 150], hotGlow = [255, 96, 44];
  const goldCore = [255, 252, 240], hotCore = [255, 188, 120];
  const cGlow = mixRGB(goldGlow, hotGlow, heat);
  const cCore = mixRGB(goldCore, hotCore, heat);

  push(); noStroke();
  blendMode(ADD);                                     // glueht auf dem dunklen Weltraum
  const GR = r * 7;
  let glow = ctx.createRadialGradient(x, y, 0, x, y, GR);
  glow.addColorStop(0.0, `rgba(${cGlow[0]},${cGlow[1]},${cGlow[2]},${0.85 * intensity})`);
  glow.addColorStop(0.10, `rgba(${cGlow[0]},${cGlow[1]},${cGlow[2]},${0.45 * intensity})`);
  glow.addColorStop(0.35, `rgba(${cGlow[0]},${Math.round(cGlow[1] * 0.82)},${cGlow[2]},${0.12 * intensity})`);
  glow.addColorStop(1.0, `rgba(${cGlow[0]},${cGlow[1]},${cGlow[2]},0)`);
  ctx.fillStyle = glow; ctx.fillRect(x - GR, y - GR, GR * 2, GR * 2);

  // --- Flares/Protuberanzen: schmale radiale Zungen am Rand, langsam rotierend, variabel ---
  const nF = 5;
  for (let i = 0; i < nF; i++) {
    const baseA = t * 0.25 + i * TWO_PI / nF;         // langsame Rotation
    const wob = 0.5 + 0.5 * Math.sin(t * 1.7 + i * 2.1);
    const len = r * (1.5 + 1.1 * wob) * (0.7 + 0.5 * flick);          // Laenge variiert + flackert
    const aw = 0.10 + 0.05 * Math.sin(t * 2.3 + i);   // halbe Winkelbreite an der Basis
    const bright = (0.16 + 0.20 * (0.5 + 0.5 * Math.sin(t * 3.1 + i * 1.9))) * intensity;
    const ex = x + Math.cos(baseA) * len, ey = y + Math.sin(baseA) * len;
    let fg = ctx.createLinearGradient(x, y, ex, ey);
    fg.addColorStop(0, `rgba(${cGlow[0]},${cGlow[1]},${cGlow[2]},${bright})`);
    fg.addColorStop(0.5, `rgba(${hotGlow[0]},${hotGlow[1]},${hotGlow[2]},${bright * 0.5})`);
    fg.addColorStop(1, `rgba(${hotGlow[0]},${hotGlow[1]},${hotGlow[2]},0)`);
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(baseA - aw) * r * 0.92, y + Math.sin(baseA - aw) * r * 0.92);
    ctx.lineTo(ex, ey);
    ctx.lineTo(x + Math.cos(baseA + aw) * r * 0.92, y + Math.sin(baseA + aw) * r * 0.92);
    ctx.closePath(); ctx.fill();
  }

  // --- Partikelauswurf: unregelmaessig neue Partikel (mehr bei hohem Flackern), driften + faden ---
  if (Math.random() < 0.22 + 0.45 * flick && sunEjecta.length < 40) {
    const a = Math.random() * TWO_PI;
    const spd = r * (1.4 + Math.random() * 2.6);
    sunEjecta.push({ x: x + Math.cos(a) * r * 0.95, y: y + Math.sin(a) * r * 0.95,
                     vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
                     life: 0.6 + Math.random() * 0.9, age: 0, sz: r * (0.05 + Math.random() * 0.10) });
  }
  for (let k = sunEjecta.length - 1; k >= 0; k--) {
    const p = sunEjecta[k];
    p.age += dt;
    if (p.age >= p.life) { sunEjecta.splice(k, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vx *= (1 - 1.6 * dt); p.vy *= (1 - 1.6 * dt);   // nach aussen abbremsen
    const lf = 1 - p.age / p.life;                    // 1..0 Restleben
    ctx.fillStyle = `rgba(${hotGlow[0]},${Math.round(110 + 110 * lf)},${hotGlow[2]},${0.5 * lf * intensity})`;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.sz * (0.5 + lf), 0, TWO_PI); ctx.fill();
  }

  blendMode(BLEND);
  // --- Kern (rot-verschoben, leicht atmend) ---
  let core = ctx.createRadialGradient(x, y, 0, x, y, r);
  core.addColorStop(0, `rgba(${cCore[0]},${cCore[1]},${cCore[2]},1)`);
  core.addColorStop(0.65, `rgba(${cCore[0]},${Math.round(cCore[1] * 0.93)},${Math.round(cCore[2] * 0.82)},1)`);
  core.addColorStop(1, `rgba(${hotCore[0]},${Math.round(hotCore[1] * 0.82)},${Math.round(hotCore[2] * 0.7)},0.95)`);
  ctx.fillStyle = core; ctx.beginPath(); ctx.arc(x, y, r * (1 + 0.04 * flick), 0, TWO_PI); ctx.fill();
  pop();
}

function drawMoon(x, y, r, ldx, ldy) {
  const ctx = drawingContext;
  push(); noStroke();
  ctx.save();
  ctx.beginPath(); ctx.arc(x, y, r, 0, TWO_PI); ctx.clip();
  // Phase: lineare Beleuchtung entlang Lichtrichtung (ferne Sonne -> Terminator durch die Scheibe)
  let g = ctx.createLinearGradient(x - ldx * r, y - ldy * r, x + ldx * r, y + ldy * r);
  g.addColorStop(0.0, 'rgba(22,22,28,1)');          // Nachtseite (Hauch Erdschein)
  g.addColorStop(0.45, 'rgba(58,58,64,1)');
  g.addColorStop(0.60, 'rgba(132,132,134,1)');
  g.addColorStop(1.0, 'rgba(222,222,216,1)');        // Sonnenseite
  ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  // Maria/Krater: ein paar weiche dunkle Flecken
  const maria = [[-0.25, -0.20, 0.30], [0.18, 0.05, 0.22], [-0.05, 0.35, 0.18], [0.35, -0.30, 0.14]];
  for (const m of maria) {
    let mg = ctx.createRadialGradient(x + m[0] * r, y + m[1] * r, 0, x + m[0] * r, y + m[1] * r, m[2] * r);
    mg.addColorStop(0, 'rgba(0,0,0,0.22)'); mg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = mg; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.restore();
  pop();
}

function draw() {
  const dt = Math.min(0.05, deltaTime / 1000); // s, gedeckelt gegen Tab-Sprung

  // Hintergrund: aktuelle Szene DECKEND als Basis, naechste Szene per Alpha darueber einblenden.
  // So ist der Crossfade ein sauberes B*f over A (kein Mittel-Abdunkeln, kein Pop am Umschalten).
  // drawSceneBackdrop kapselt prozedural (space/underwater), Bild- und Farbhintergruende inkl. Sonne/Mond.
  // Bei Zoom-Uebergang 2<->3: Scene 2 wird mit Canvas-Transform skaliert/verschoben.
  const zoom = zoomTransition ? getZoomTransform() : null;
  drawSceneWithZoom(currentScene, 1, zoom);
  if (nextScene >= 0) drawSceneWithZoom(nextScene, sceneFade, zoom);

  // Crossfade / Zoom-Uebergang fortschreiben
  if (nextScene >= 0) {
    if (zoomTransition) {
      zoomProgress = Math.min(1, zoomProgress + dt / ZOOM_DURATION);
      if (zoomDirection > 0) {
        sceneFade = Math.max(0, Math.min(1, (zoomProgress - 0.5) / 0.5));
      } else {
        sceneFade = Math.max(0, Math.min(1, zoomProgress / 0.5));
      }
      if (zoomProgress >= 1) {
        currentScene = nextScene; nextScene = -1; sceneFade = 1;
        zoomTransition = false; zoomProgress = 0;
      }
    } else {
      sceneFade = Math.min(1, sceneFade + dt * SCENE_FADE_SPEED);
      if (sceneFade >= 1) { currentScene = nextScene; nextScene = -1; sceneFade = 1; }
    }
  }

  // Ducking-Wert weich nachfuehren
  const duckTarget = openEntity ? 1 : 0;
  duck += (duckTarget - duck) * Math.min(1, dt * 4);

  // Meeresspiegel-Anstieg im Wasser-Schnitt (klick-getriggert): langsam von alt -> jetzt
  if (sectionSeaRiseActive && sectionSeaRise < 1) sectionSeaRise = Math.min(1, sectionSeaRise + dt / SEA_RISE_DURATION);
  // Erd-Limb (Atmosphaeren-Szene) dreht in DIESELBE Richtung wie der Globus weiter, nur langsamer.
  // Frueher lief atmoSpin fest positiv (+), der Globus aber negativ (baseVel=-0.10) -> beim Zoom in
  // die Atmosphaere kehrte sich die Drehung sichtbar um. Richtung folgt jetzt dem Vorzeichen von baseVel.
  const atmoGlobe = allEntities.find(e => e.isGlobe);
  atmoSpin += (atmoGlobe && atmoGlobe.baseVel < 0 ? -1 : 1) * ATMO_SPIN_VEL * dt;

  // Entities aktualisieren + zeichnen (nur sichtbare Szenen)
  const prevHover = hoverEntity;
  hoverEntity = null;
  for (const ent of allEntities) {
    if (currentSceneAlphaFor(ent) <= 0.01) continue;
    ent.update(dt);
  }
  // Hover-Erkennung (oberstes zuerst). Waehrend Zoom-Uebergang deaktiviert.
  if (!zoomTransition) {
    for (let i = allEntities.length - 1; i >= 0; i--) {
      const ent = allEntities[i];
      if (ent.def.interactive === false) continue;
      if (currentSceneAlphaFor(ent) > 0.4 && ent.contains(mouseX, mouseY)) { hoverEntity = ent; break; }
    }
  }
  // DESCENT: leiser Ping beim ERSTEN Beruehren eines Hotspots (nur bei Hover-Wechsel)
  if (hoverEntity && hoverEntity !== prevHover && hoverEntity.def.hotspot) playHoverPing();
  for (const ent of allEntities) {
    if (currentSceneAlphaFor(ent) <= 0.01) continue;
    const entIsPivot = zoomPivotIndex >= 0 && ent.def.scene === scenes[zoomPivotIndex]?.id;
    if (zoom && entIsPivot) {
      push(); translate(zoom.cx, zoom.cy); scale(zoom.scale); translate(-zoom.cx, -zoom.cy);
      ent.draw();
      pop();
    } else {
      ent.draw();
    }
  }

  updateSectionMarkers();   // Rand-Ein-/Ausstiegs-Marker positionieren + zeichnen (Kugel-Oberrand / Schnitt oben)

  updateUICursor();   // Glow-Cursor-Zustand (statt nativer cursor()-Styles, die cursor:none ueberschreiben wuerden)
  updateSunTint();    // SW-Modus: Sonnenlicht-Layer auf die sichtbare Sonne legen (sonst aus)
  updateAnno();       // offenes In-Szene-Diagramm dem Bob des Steins nachfuehren

  if (PERF_HUD) drawPerfHud();
}

// ===== SW-Modus-Ausnahme: das Sonnenlicht bleibt gold =====
// Der Graustufen-Filter liegt auf den einzelnen Ebenen (siehe index.html); DARUEBER schwebt der
// ungefilterte Layer #sun-tint (mix-blend-mode: color), der den Graustufen darunter Farbton +
// Saettigung des Sonnengolds zurueckgibt — die Helligkeit (also die Zeichnung selbst) bleibt.
// Pro sichtbarer Szene wird bestimmt, wo die Sonne steht:
//   Szene 1  -> kreisende Sonne (sunOrbitAngle), Szene 'sun' -> grosse Scheibe (sunLayout),
//   'water'  -> Himmels-Sonne des Schnitts, Szene 2 -> Lichtband von oben (#sun-tint-band).
function sunTintSpec(id) {
  const W = width, H = height, mm = Math.min(W, H);
  const sc = scenes.find(s => s && s.id === id);
  if (!sc) return null;
  if (sc.space) {
    const sa = sunOrbitAngle();
    return { kind: 'radial', x: W / 2 + Math.cos(sa) * SUN_ORBIT_R * mm, y: H / 2 - Math.sin(sa) * SUN_ORBIT_R * mm, r: mm * 0.28 };
  }
  if (sc.viz === 'sun') { const s = sunLayout(); return { kind: 'radial', x: s.cx, y: s.cy, r: s.r * 2.6 }; }
  if (sc.water) return { kind: 'radial', x: W * 0.70, y: H * 0.22, r: H * 0.55 };   // Himmels-Sonne aus drawWaterSky
  if (sc.underwater) return { kind: 'band', h: H * 0.38 };                          // Sonnenlicht faellt von oben ein
  return null;
}
function updateSunTint() {
  const rad = document.getElementById('sun-tint');
  const band = document.getElementById('sun-tint-band');
  if (!rad || !band) return;
  if (!bwMode) { rad.style.opacity = 0; band.style.opacity = 0; return; }
  // dominante Szene waehrend eines Fades (Farbton-Blend auf Dunklem ist unauffaellig genug,
  // dass EIN Tint-Satz reicht)
  const t = sceneFadeT();
  const idx = (nextScene >= 0 && t > 0.5) ? nextScene : currentScene;
  const a = nextScene >= 0 ? (idx === nextScene ? t : 1 - t) : 1;
  const spec = scenes[idx] ? sunTintSpec(scenes[idx].id) : null;
  if (spec && spec.kind === 'radial') {
    rad.style.left = (spec.x - spec.r) + 'px';
    rad.style.top = (spec.y - spec.r) + 'px';
    rad.style.width = rad.style.height = (spec.r * 2) + 'px';
    rad.style.opacity = a;
  } else rad.style.opacity = 0;
  if (spec && spec.kind === 'band') {
    band.style.height = spec.h + 'px';
    band.style.opacity = a;
  } else band.style.opacity = 0;
  updateBWTints();
}

// SW-Modus: auch HOTSPOTS + MARKER bleiben gold. Gleicher Trick wie beim Sonnenlicht — ein Pool
// kleiner ungefilterter Gold-Kreise (#bw-tints, mix-blend-mode: color) wird pro Frame auf die
// sichtbaren Hotspot-Orbs und Rand-Marker gelegt (grosszuegig dimensioniert; auf dunklem Grund
// ist der Farbton-Blend ausserhalb der Leuchtpunkte unsichtbar). Marker-Kreise reichen nach
// rechts ueber das Label. DOM-Text (Menue, Reader, Captions) ist gar nicht erst gefiltert.
function updateBWTints() {
  const pool = document.getElementById('bw-tints');
  if (!pool) return;
  if (!bwMode) { pool.style.display = 'none'; return; }
  pool.style.display = 'block';
  const specs = [];
  for (const ent of allEntities) {
    if (!ent.def.hotspot) continue;
    if (currentSceneAlphaFor(ent) <= 0.05) continue;
    const d = ent.radius * 2.6;   // ~Ausdehnung des Orb-Glows
    specs.push({ x: ent.pos.x, y: ent.pos.y, w: d, h: d });
  }
  for (const m of sectionMarkers) specs.push({ x: m.x, y: m.y, w: m.r * 4, h: m.r * 4 });
  if (sectionBackMarker.visible) specs.push({ x: sectionBackMarker.x, y: sectionBackMarker.y, w: sectionBackMarker.r * 4, h: sectionBackMarker.r * 4 });
  while (pool.children.length < specs.length) pool.appendChild(document.createElement('div'));
  for (let i = 0; i < pool.children.length; i++) {
    const d = pool.children[i], s = specs[i];
    if (!s) { d.style.display = 'none'; continue; }
    d.style.display = 'block';
    d.style.left = (s.x - s.w / 2) + 'px';
    d.style.top = (s.y - s.h / 2) + 'px';
    d.style.width = s.w + 'px';
    d.style.height = s.h + 'px';
  }
}

// Glow-Cursor (DESCENT): Zustaende auf dem DOM-Punkt spiegeln. 'grab' beim Greifen/Kugel,
// 'hover' ueber Hotspots/Markern. Der native Cursor ist per CSS (cursor:none) versteckt.
function updateUICursor() {
  const el = document.getElementById('cursor');
  if (!el) return;
  const grab = heldEntity || (hoverEntity && (hoverEntity.frames || hoverEntity.isGlobe));
  el.classList.toggle('grab', !!grab);
  el.classList.toggle('hover', !grab && !!(sectionHover || hoverEntity));
}

// leiser Hover-Ping (DESCENT): kurzer Sinus-Blip beim ersten Beruehren eines Hotspots.
// Optional — ohne Audio-Graph oder vor der Eintritts-Geste passiert einfach nichts.
let pingSynth = null, lastPingMs = 0;
function playHoverPing() {
  if (!audio || !started) return;
  const now = millis();
  if (now - lastPingMs < 150) return;   // entprellen
  lastPingMs = now;
  try {
    if (!pingSynth) {
      pingSynth = new Tone.Synth({
        oscillator: { type: 'sine' },
        envelope: { attack: 0.001, decay: 0.10, sustain: 0, release: 0.06 },
        volume: -26
      });
      pingSynth.connect(audio.buses.short);
    }
    pingSynth.triggerAttackRelease(1150 + Math.random() * 90, 0.07);
  } catch (e) { /* Audio ist optional */ }
}

// GPU-/Renderer-String einmalig ermitteln (fuer ?perf): zeigt, ob Hardware-Beschleunigung aktiv
// ist (sonst SwiftShader/CPU -> erklaert starkes Ruckeln). Quelle: vorhandener WebGL-Buffer.
let perfRenderer = null;
function getPerfRenderer() {
  if (perfRenderer !== null) return perfRenderer;
  perfRenderer = '?';
  try {
    const buf = (typeof waterBuf !== 'undefined' && waterBuf) ? waterBuf
              : (typeof globeBuf !== 'undefined' && globeBuf) ? globeBuf : null;
    const gl = buf && buf._renderer ? buf._renderer.GL : null;
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      perfRenderer = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    }
  } catch (e) { /* egal */ }
  return perfRenderer;
}

// Kleine Diagnose-HUD (nur mit ?perf): geglaettete FPS, Backing-Dichte, Megapixel, dpr, GPU.
function drawPerfHud() {
  const inst = deltaTime > 0 ? 1000 / deltaTime : 60;
  perfFpsEMA = perfFpsEMA * 0.9 + inst * 0.1;
  const d = pixelDensity();
  const mpx = (width * d * height * d) / 1e6;
  const gpu = getPerfRenderer();
  push();
  resetMatrix && resetMatrix();
  noStroke(); fill(0, 0, 0, 160); rectMode(CORNER);
  rect(8, 8, 360, 74, 6);
  fill(perfFpsEMA >= 55 ? color(120, 230, 140) : perfFpsEMA >= 40 ? color(240, 210, 110) : color(240, 120, 110));
  textAlign(LEFT, TOP); textSize(16); textFont('Courier New');
  text(perfFpsEMA.toFixed(0) + ' fps', 16, 12);
  fill(220); textSize(11);
  text('Dichte ' + d.toFixed(2) + '  ·  ' + mpx.toFixed(1) + ' MPix', 16, 36);
  text('dpr ' + (window.devicePixelRatio || 1).toFixed(2) + '  ·  ' + width + '×' + height, 16, 50);
  text('GPU: ' + gpu.slice(0, 52), 16, 64);
  pop();
}

// Zeichnet den KOMPLETTEN Hintergrund einer Szene bei gegebenem Alpha (0..1) -> eine Funktion
// fuer alle Szenentypen, damit der Crossfade beliebige Kombinationen sauber ueberblendet:
//   space     -> prozeduraler Weltraum + Sonne/Mond
// Zoom-Transform-Helfer: Canvas-Skalierung um das Zoom-Zentrum
function getZoomTransform() {
  let zoomT;
  if (zoomDirection > 0) { zoomT = easeInOutCubic(Math.min(1, zoomProgress / 0.7)); }
  else { zoomT = easeInOutCubic(1 - Math.max(0, (zoomProgress - 0.3) / 0.7)); }
  const s = 1 + (zoomMaxScale - 1) * zoomT;
  return { scale: s, cx: zoomTargetX * width, cy: zoomTargetY * height };
}
function drawSceneWithZoom(sceneIndex, alpha, zoomXform) {
  if (zoomXform && sceneIndex === zoomPivotIndex) {
    push();
    translate(zoomXform.cx, zoomXform.cy);
    scale(zoomXform.scale);
    translate(-zoomXform.cx, -zoomXform.cy);
    drawSceneBackdrop(sceneIndex, alpha);
    pop();
  } else {
    drawSceneBackdrop(sceneIndex, alpha);
  }
}

//   underwater -> prozedurale Unterwasser-Atmosphaere
//   sc.bg      -> bildschirmfuellendes Hintergrundbild (cover)
//   sonst      -> einfarbig aus backgroundTint
// Hilfsfunktion: Bild bildschirmfuellend (cover) zentriert zeichnen, p5-State sauber gekapselt
function drawCoverImage(img, alpha) {
  const ir = img.width / img.height, cr = width / height;
  let w, h; if (ir > cr) { h = height; w = height * ir; } else { w = width; h = width / ir; }
  push(); imageMode(CENTER); tint(255, 255 * alpha); image(img, width / 2, height / 2, w, h); pop();
}
function drawSceneBackdrop(index, alpha) {
  const sc = scenes[index];
  if (!sc || alpha <= 0.001) return;
  if (sc.space) {
    drawSpace(alpha);
    drawSunMoon(alpha);     // Sonne + Mond gehoeren zur Weltraum-Szene, blenden mit (hinter den Entities)
    return;
  }
  if (sc.underwater) {
    drawWater(alpha);          // Shader-Wasser; faellt intern auf drawUnderwater() zurueck
    drawScene2Fauna(alpha);    // prozedurale Kleinfauna (Krill + Fischschwarm) ueber dem Wasser
    return;
  }
  if (sc.interior) {
    // Scene 3 „das eye": entweder gemaltes Kuppel-Bild (falls vorhanden) ODER prozeduraler Innenraum.
    // sc.bg deckt den Vollbild-Hintergrund ab; der Shader liefert sonst Kuppel + Oculus + Reflexion.
    if (sc.bg) drawCoverImage(sc.bg, alpha);
    else drawSolarSpace(alpha);   // prozedurale Licht-Architektur; faellt intern auf 2D-Fallback zurueck
    return;
  }
  if (sc.atmosphere) {
    drawAtmosphere(alpha);        // Erd-Rand (rotierend) + obere Schichten (Magnetfeld/Ozon/Smog)
    return;
  }
  if (sc.water) {
    drawWaterSection(alpha);      // Berg + halbtransparentes Szene-2-Wasser (Querschnitt), ohne Atmosphaere
    return;
  }
  if (sc.viz) {
    drawViz(sc.viz, alpha);       // prozedurale Erklaer-Ansichten (sun/station/living/wildlife)
    return;
  }
  if (sc.bg) {
    drawCoverImage(sc.bg, alpha);
  } else {
    // einfarbiger Hintergrund aus backgroundTint
    push();
    const tintCol = hexToRgb(sc.backgroundTint || '#ffffff');
    noStroke();
    fill(tintCol[0], tintCol[1], tintCol[2], 255 * alpha);
    rect(0, 0, width, height);
    pop();
  }
}

function hexToRgb(hex) {
  const m = hex.replace('#', '');
  return [parseInt(m.substr(0, 2), 16), parseInt(m.substr(2, 2), 16), parseInt(m.substr(4, 2), 16)];
}

// =========================================================================
//  ZWEI ZOOM-ANSICHTEN (aus Szene 1 erreichbar):
//   drawAtmosphere() = Erd-Rand (rotierend) + obere Schichten (Magnetfeld/Ozon/Smog)
//   drawWaterSection() = Berg (Bild) + halbtransparentes Szene-2-Wasser, Meeresspiegel steigt auf Klick
// =========================================================================

// prozedurales Kuestenprofil (normiert 0..1): links Hochland -> Huegelkamm ueber altem
// Meeresspiegel -> Kueste -> abfallender Schelf/Boden rechts. Wird einmal gebaut (aufloesungsunabh.).
function buildCoast() {
  return [
    { x: 0.00, y: 0.70 }, { x: 0.10, y: 0.60 }, { x: 0.20, y: 0.50 },
    { x: 0.30, y: 0.47 },   // Kamm (ueber SECTION_OLD_SEA_Y = 0.62)
    { x: 0.40, y: 0.52 }, { x: 0.50, y: 0.60 }, { x: 0.58, y: 0.68 },   // Kueste
    { x: 0.70, y: 0.78 }, { x: 0.85, y: 0.86 }, { x: 1.00, y: 0.92 }
  ];
}

// ---- WATER-Ansicht: Berg + halbtransparentes Szene-2-Wasser (Querschnitt). OHNE Atmosphaeren-Schichten. ----
function drawWaterSection(alpha) {
  const W = width, H = height, ctx = drawingContext, t = millis() * 0.001;
  const wl = SECTION_OLD_SEA_Y + (SECTION_NEW_SEA_Y - SECTION_OLD_SEA_Y) * sectionSeaRise;  // aktuelle Wasserlinie

  push();
  ctx.globalAlpha = alpha;

  // 1) Verbrannter Sonnen-Himmel (uebernommen aus dem alten "sea level"-Viz) -> Atmosphaere ueber dem Wasser
  drawWaterSky(W, H, ctx);

  // 2) Tiefwasser-Basis unter der Wasserlinie (dunkel) -> Grundlage fuer das halbtransparente Wasser.
  //    Nur wenn die Wasserlinie im Bild ist (wl < 1) -> am Anfang (Start unter dem Rand) kein Wasser.
  const hasWater = wl < 1.0;
  if (hasWater) {
    const deep = ctx.createLinearGradient(0, wl * H, 0, H);
    deep.addColorStop(0.00, '#12403f'); deep.addColorStop(0.35, '#0c2b40');
    deep.addColorStop(0.72, '#08202e'); deep.addColorStop(1.00, '#030a12');
    ctx.fillStyle = deep; ctx.fillRect(0, wl * H, W, H - wl * H);
  }

  // 3) Berg-Bild (ueber Himmel + Tiefwasser-Basis) ODER prozedurale Kueste als Fallback
  const land = scenes[waterIndex] && scenes[waterIndex].landImg;
  if (land) {
    const dw = SECTION_LAND_SCALE * W, dh = dw * (land.height / land.width);   // uniform, aspekt-erhaltend
    push(); imageMode(CORNER);
    image(land, SECTION_LAND_CX * W - dw / 2, SECTION_LAND_BASE_Y * H - dh, dw, dh);
    pop();
  } else {
    if (!drawWaterSection._coast) drawWaterSection._coast = buildCoast();
    push(); noStroke(); fill(58, 49, 40);
    beginShape(); vertex(0, H);
    for (const p of drawWaterSection._coast) vertex(p.x * W, p.y * H);
    vertex(W, H); endShape(CLOSE); pop();
  }

  // 4) Wasser wie in Szene 2 (halbtransparent -> Berg bleibt sichtbar)
  if (hasWater) drawSectionWater(wl, alpha);

  // 5) biolumineszentes Gruen in der kalten Tiefe (additiv), nur unter der aktuellen Wasserlinie
  if (hasWater) {
    if (!drawWaterSection._biolum) {
      const b = [];
      for (let i = 0; i < 14; i++) b.push({ x: Math.random(), y: 0.82 + Math.random() * 0.16, ph: Math.random() * 6.28, s: 1 + Math.random() * 2 });
      drawWaterSection._biolum = b;
    }
    push(); ctx.globalCompositeOperation = 'lighter'; noStroke();
    for (const b of drawWaterSection._biolum) {
      if (b.y <= wl) continue;
      fill(80, 220, 150, 60 * Math.max(0, 0.4 + 0.6 * Math.sin(t * 0.9 + b.ph)));
      ellipse(b.x * W, b.y * H, b.s * 4);
    }
    pop();
  }

  // 6) Jahres-Zaehler an der Wasserlinie -> zaehlt mit dem Anstieg 2026 -> 3126 hoch (aus dem alten Viz)
  if (hasWater) {
    const yr = Math.floor(2026 + (3126 - 2026) * sectionSeaRise);
    push();
    noStroke(); textAlign(LEFT, TOP); textFont('Courier New'); textSize(13);
    fill(210, 228, 228, 215);
    text('sea level — year ' + yr, W * 0.06, wl * H + 14);
    pop();
  }

  ctx.globalAlpha = 1;
  pop();
}

// Verbrannter Sonnen-Himmel fuer die Wasser-Szene (uebernommen aus dem alten "sea level"-Viz):
// dunkelrot->gold-Verlauf + grosse Sonnen-Glut + rotierende Strahlen + geschichtete Sonnenscheibe + UV-Baender.
// Zuerst deckende Basis (sonst wuerde der translucente Verlauf nicht abdecken), dann die Schichten.
function drawWaterSky(W, H, ctx) {
  ctx.fillStyle = '#050300'; ctx.fillRect(0, 0, W, H);   // deckende dunkle Basis
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0.00, 'rgba(28,14,0,0.96)');
  g.addColorStop(0.32, 'rgba(82,42,2,0.90)');
  g.addColorStop(0.66, 'rgba(165,112,12,0.70)');
  g.addColorStop(1.00, 'rgba(205,162,34,0.50)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  const sunX = W * 0.70, sunY = H * 0.22, F = frameCount;
  const rg = ctx.createRadialGradient(sunX, sunY, 20, sunX, sunY, H * 0.6);   // grosse Sonnen-Glut
  rg.addColorStop(0.0, 'rgba(255,230,80,0.50)');
  rg.addColorStop(0.2, 'rgba(240,180,30,0.26)');
  rg.addColorStop(0.5, 'rgba(200,120,10,0.11)');
  rg.addColorStop(1.0, 'rgba(100,50,0,0)');
  ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);

  for (let i = 0; i < 32; i++) {                          // 32 lange, langsam rotierende Strahlen
    const ang = (TWO_PI / 32) * i + F * 0.003;
    const len = H * 0.5 + noise(i * 0.8, F * 0.006) * H * 0.28;
    const flick = Math.sin(F * 0.05 + i * 1.1) * 0.18 + 0.82;
    stroke(255, 210, 50, 44 * flick); strokeWeight(Math.max(0.3, 1.6 - (i % 3) * 0.4));
    line(sunX, sunY, sunX + Math.cos(ang) * len, sunY + Math.sin(ang) * len);
  }
  for (let i = 0; i < 24; i++) {                          // 24 kuerzere, hellere Strahlen
    const ang = (TWO_PI / 24) * i + PI / 24 + F * 0.004;
    const len = H * 0.28 + noise(i * 1.2, F * 0.009) * H * 0.18;
    const flick = Math.sin(F * 0.07 + i * 0.8) * 0.2 + 0.8;
    stroke(255, 240, 120, 62 * flick); strokeWeight(0.5);
    line(sunX, sunY, sunX + Math.cos(ang) * len, sunY + Math.sin(ang) * len);
  }
  noStroke();                                             // geschichtete Sonnenscheibe
  fill(255, 160, 0, 22); circle(sunX, sunY, 180);
  fill(255, 200, 30, 48); circle(sunX, sunY, 90);
  fill(255, 230, 80, 118); circle(sunX, sunY, 44);
  fill(255, 248, 150, 195); circle(sunX, sunY, 22);
  fill(255, 255, 220, 235); circle(sunX, sunY, 10);
  for (let i = 0; i < 7; i++) {                           // horizontale UV-Schimmerbaender
    const y = H * (0.06 + i * 0.05), fl = Math.sin(F * 0.03 + i * 1.4) * 0.25 + 0.75;
    stroke(255, 220, 60, 14 * fl); strokeWeight(0.5); line(0, y, W, y);
  }
}

// ---- ATMOSPHERE-Ansicht: Zoom auf den Erd-Rand (Projekt-Globus, langsam rotierend) + obere
//      Schichten (Magnetfeld, Ozon, Smog). KEIN Wasser/Berg. Wie ein Blick aus dem Orbit. ----
let ATMO_LIMB = 0.60;     // Bildschirm-y des Erd-Rands (Limb) -> Erde im unteren Drittel
let ATMO_CAP_HALFW = 0.45; // Cap-Zoom: halbe Ortho-Box-Breite in Vielfachen des Kugelradius. KLEINER = staerker
                           // reingezoomt (flacherer Limb, groessere Erde). On-Screen-Radius rr = Breite/(2*ATMO_CAP_HALFW).
let ATMO_GLOW = 0.345;     // Staerke des blauen Atmosphaeren-Saums am Limb (0 = aus). Frueher 0.75 -> war zu weiss.
let ATMO_SMOG = 0.08;      // Staerke des warmen Smog-Hauchs am Limb (0 = aus). Frueher 0.5 -> mit dem Blau = weiss.
let ATMO_SUN = 1.50;       // Sonnen-Helligkeit der Erde in der Atmosphaere (1 = voll=zu weiss, 0.62=zu dunkel -> Mitte).
let ATMO_FILL = 0.55;      // Fuelllicht/Ambient in der Atmosphaere -> hebt den kantigen Rand (Limb). Hoeher = Rand heller/flacher.
let ATMO_MAG = 0.8;        // Deckkraft des Magnetfeld-Diagramms (duenne weiss-graue Dipol-Feldlinien; 0 = aus)
let ATMO_MAG_LINES = 9;    // Anzahl Feldlinien je Seite (mehr = dichteres Feld)
let ATMO_MAG_FLOW = 0.10;  // Tempo des wandernden Licht-Pulses entlang der Linien (0 = statisch, hoeher = schneller)
let ATMO_MAG_WOBBLE = 0.6;         // staendiges seitliches Schwanken des Feldes (0 = starr)
let ATMO_MAG_COLLAPSE = 1.0;       // Tiefe der kurzen Total-Einbrueche (0 = nie, 1 = Feld verschwindet ganz)
let ATMO_MAG_COLLAPSE_EVERY = 6.5; // mittlerer Abstand der Einbrueche in Sekunden

// (Die frueheren dynamischen Atmosphaeren-Hotspots sind konsolidiert: EIN 'hs_atmosphere'-Hotspot
//  oeffnet jetzt das In-Szene-Diagramm; die Bogen-Geometrie lebt in buildAnnoSVG -> 'atmosphere'.)

function drawAtmosphere(alpha) {
  const W = width, H = height, ctx = drawingContext, t = millis() * 0.001;

  push();
  ctx.globalAlpha = alpha;

  // 1) Weltraum-Hintergrund (dunkel) + Sterne im oberen Band
  const sp = ctx.createLinearGradient(0, 0, 0, H);
  sp.addColorStop(0.00, '#020307'); sp.addColorStop(ATMO_LIMB, '#060b16'); sp.addColorStop(1.00, '#0a1322');
  ctx.fillStyle = sp; ctx.fillRect(0, 0, W, H);
  if (!drawAtmosphere._stars) {
    const s = [];
    for (let i = 0; i < 90; i++) s.push({ x: Math.random(), y: Math.random() * ATMO_LIMB, r: 0.4 + Math.random() * 1.2, ph: Math.random() * 6.28 });
    drawAtmosphere._stars = s;
  }
  noStroke();
  for (const st of drawAtmosphere._stars) { fill(220, 225, 240, Math.max(0, 110 + 90 * Math.sin(t * 0.8 + st.ph))); ellipse(st.x * W, st.y * H, st.r); }

  // 2) Erd-Rand mit CAP-ZOOM: die Kugel wird ORTHOGRAFISCH nur im sichtbaren Rand-Ausschnitt gerendert
  //    (die volle Buffer-Aufloesung geht in die sichtbare Erde -> scharf) und 1:1 auf den Bildschirm geblittet.
  const globe = allEntities.find(e => e.isGlobe);
  const cx = W * 0.5;
  const rr = W / (2 * ATMO_CAP_HALFW);   // On-Screen-Kugelradius (px); folgt aus der Ortho-Box-Breite
  const cy = ATMO_LIMB * H + rr;         // Kugelmittelpunkt (weit unter dem Bildschirm) -> Limb bei ATMO_LIMB*H
  // Eigenes Szenen-Bild vorhanden -> Erd-Rand + Schichten (Smog/Ozon/Magnetfeld) weglassen; das Bild
  // zeichnet der Entity-Loop. Die Hotspots sitzen weiter auf ihren (rein geometrischen) Bogen-Positionen.
  if (globe && globe.tex && globeBuf && !sceneImageLoaded(ATMO_ID)) {
    const doRender = (zoomTransition || nextScene >= 0) || (atmoRenderTick % 3 === 0);
    atmoRenderTick++;
    if (doRender) {
      const BUFSZ = globeBuf.width, Rw = BUFSZ * GLOBE_R_FRAC, camZ = (BUFSZ / 2) / Math.tan(Math.PI / 6);
      const halfW = ATMO_CAP_HALFW * Rw, boxW = 2 * halfW, boxH = boxW * (H / W);  // Ortho-Box im Bildschirm-Seitenverhaeltnis
      const yTop = Rw + ATMO_LIMB * boxH;   // Limb (Kugel-Oberkante y=Rw) liegt bei ATMO_LIMB von oben
      const box = { left: -halfW, right: halfW, bottom: yTop - boxH, top: yTop, near: camZ - 2 * Rw, far: camZ + 2 * Rw };
      drawGlobe(
        { tilt: globe.baseTilt, spinAngle: atmoSpin, tex: globe.tex, normTex: globe.normTex, specTex: globe.specTex },
        // Schatten aus + Cap-Zoom; sheen:0, kleinerer waterGain, gedaempfte Sonne; atmoCol:0 -> KEIN grauer
        // Shader-Fresnel-Schleier (den blauen Limb-Saum liefert ATMO_GLOW separat)
        { frontLit: true, cloudOp: G_CLOUD_OP * 0.35, orthoBox: box, sheen: 0, waterGain: 1.2, sunScale: ATMO_SUN,
          atmoCol: [0, 0, 0], ambient: ATMO_FILL, nightCol: [0.18, 0.24, 0.34] }   // Fuelllicht + helle Nachtseite -> Rand heller
      );
    }
    // Buffer 1:1 auf den ganzen Bildschirm (ueber dem Limb transparent -> Weltraum-Hintergrund scheint durch)
    push(); drawingContext.globalAlpha = 1; imageMode(CORNER); tint(255, 255 * alpha); image(globeBuf, 0, 0, W, H); noTint(); pop();
    // Dezenter, schmaler blauer Atmosphaeren-Saum genau an der Kugelkante (nicht mehr das breite Weiss).
    if (ATMO_GLOW > 0) {
      const glow = ctx.createRadialGradient(cx, cy, rr * 0.965, cx, cy, rr * 1.10);
      glow.addColorStop(0.00, 'rgba(150,195,245,0)');
      glow.addColorStop(0.45, 'rgba(170,205,250,' + (ATMO_GLOW * alpha) + ')');   // Peak an der Kante
      glow.addColorStop(1.00, 'rgba(140,185,240,0)');
      push(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H); pop();
    }

    // 3) sehr dezenter warmer Smog-Hauch direkt am Limb + Ozon/Magnetfeld-Boegen weiter aussen.
    if (ATMO_SMOG > 0) {
      const smog = ctx.createRadialGradient(cx, cy, rr * 0.985, cx, cy, rr * 1.045);
      smog.addColorStop(0, 'rgba(230,200,140,0)');
      smog.addColorStop(0.5, 'rgba(230,200,140,' + (ATMO_SMOG * alpha) + ')');
      smog.addColorStop(1, 'rgba(230,200,140,0)');
      push(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = smog; ctx.fillRect(0, 0, W, H); pop();
    }

    // Ozon-Bogen (zerrissen, statisch)
    push(); noFill();
    ctx.setLineDash([14, 9]); stroke(150, 195, 225, 140 * alpha); strokeWeight(2);
    ellipse(cx, cy, rr * 2 * 1.075, rr * 2 * 1.075);
    ctx.setLineDash([]); pop();

    // Magnetfeld: PROZEDURAL (fliessende, geschwaechte Feldlinien + Sonnensturm-Spitzen) statt statischer Boegen.
    drawMagnetField(cx, cy, rr, alpha, t);
  }

  ctx.globalAlpha = 1;
  pop();
}

// Magnetfeld-Diagramm ueber dem Erd-Rand: klassische Dipol-Feldlinien (wie ein Stabmagnet-Schema),
// duenne weiss-graue Linien, die am "Pol" (Erd-Rand-Scheitel) entspringen und nach beiden Seiten auffaechern.
// Feldlinien-Gleichung r = L*sin^2(theta) (theta = Kolatitude von der senkrechten Dipol-Achse).
// Nur Segmente im Weltraum (ausserhalb der echten, riesigen Erdkugel) werden gezeichnet.
function drawMagnetField(cx, cyGlobe, rr, alpha, t) {
  if (ATMO_MAG <= 0) return;
  const ctx = drawingContext, W = width, H = height, A = alpha * ATMO_MAG;

  const mx = cx, my = ATMO_LIMB * H;             // Dipol-Pol/-Zentrum am sichtbaren Erd-Rand-Scheitel
  const rSurf = 0.015 * H;                        // winziger Startradius -> alle Linien konvergieren am Pol
  const N = Math.max(1, ATMO_MAG_LINES | 0);
  const Lmin = 0.16 * H, Lmax = 2.3 * H;          // innerste (enge) bis aeusserste (weite) Feldlinie
  const th1 = Math.PI * 0.62;                      // etwas ueber den Aequator hinaus (Rest clippt der Erd-Rand)
  const rr2 = rr * rr, STEPS = 72;

  // staendiges Schwanken der Gesamt-Intensitaet (geschwaechtes, unruhiges Feld)
  const sway = 0.60 + 0.24 * Math.sin(t * 0.9) + 0.16 * Math.sin(t * 2.3 + 1.0);   // ~0.20 .. 1.0
  // kurze Total-Einbrueche: das Feld bricht periodisch (leicht unregelmaessig) fast ganz zusammen
  let collapse = 1;
  if (ATMO_MAG_COLLAPSE > 0 && ATMO_MAG_COLLAPSE_EVERY > 0) {
    const cph = t / ATMO_MAG_COLLAPSE_EVERY + 0.25 * Math.sin(t * 0.13);   // Phase (unregelmaessig)
    const fr = cph - Math.floor(cph);                                       // 0..1 im Zyklus
    const d = (fr - 0.82) / 0.05;
    const dip = Math.exp(-0.5 * d * d);                                     // scharfer, kurzer Einbruch
    collapse = 1 - ATMO_MAG_COLLAPSE * 0.94 * dip;                          // faellt kurz auf ~0.06
  }
  const env = sway * collapse;                                             // Gesamt-Helligkeitshuellkurve
  const wobAmt = ATMO_MAG_WOBBLE * (1 + 2.4 * (1 - collapse));             // beim Einbruch thrashen die Linien

  push();
  ctx.globalCompositeOperation = 'lighter';        // weisse Linien addieren sich -> heller Pol-Knoten wie in der Vorlage
  ctx.lineCap = 'round';

  for (let i = 0; i < N; i++) {
    const u = N > 1 ? i / (N - 1) : 0;
    const L = Lmin * Math.pow(Lmax / Lmin, u);      // geometrisch gestreute Schalen
    const th0 = Math.asin(Math.min(1, Math.sqrt(rSurf / L)));
    for (let side = -1; side <= 1; side += 2) {     // linke + rechte Meridian-Haelfte
      const linePhase = i * 0.9 + (side > 0 ? 0.6 : 0.0);   // Puls-Versatz je Linie -> kein Gleichtakt
      let prev = null;
      for (let k = 0; k <= STEPS; k++) {
        const p = k / STEPS;                        // 0 am Pol -> 1 aussen
        const th = th0 + (th1 - th0) * p;
        const s = Math.sin(th), c = Math.cos(th), r = L * s * s;
        // seitliches Schwanken, am Pol verankert (waechst mit Abstand p), pro Linie versetzt
        const wob = wobAmt * 0.05 * H * p * (Math.sin(t * 0.7 + p * 2.6 + i * 0.5) + 0.5 * Math.sin(t * 1.3 + linePhase));
        const x = mx + side * r * s + wob;          // rho = r*sin(theta) + Schwanken
        const y = my - r * c;                       // v = r*cos(theta) (nach oben)
        const inSpace = ((x - cx) * (x - cx) + (y - cyGlobe) * (y - cyGlobe)) > rr2;   // ausserhalb der Erdkugel?
        if (!inSpace || x < -80 || x > W + 80 || y < -80 || y > H + 80) { prev = null; continue; }
        if (prev) {
          const fade = Math.max(0, 1 - (th - th0) / (th1 - th0));     // Grundhelligkeit (Pol hell)
          // weicher Licht-Puls, der vom Pol nach aussen wandert (Feld "fliesst")
          const wave = 0.5 + 0.5 * Math.sin((p * 1.4 - t * ATMO_MAG_FLOW) * TWO_PI + linePhase);
          const pulse = wave * wave * wave;                           // schmale, weiche Baender
          const a = A * env * (0.035 + 0.05 * fade + 0.16 * pulse * fade);  // dezent + Puls + Schwanken/Einbruch
          ctx.strokeStyle = 'rgba(234,238,244,' + a.toFixed(3) + ')';  // duenne weiss-graue Linie
          ctx.lineWidth = 0.6 + 0.25 * fade + 0.5 * pulse;
          ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(x, y); ctx.stroke();
        }
        prev = { x, y };
      }
    }
  }

  ctx.globalCompositeOperation = 'source-over';
  pop();
}

// Section-Wasser = der Szene-2-Wasser-Shader (WATER_FRAG) mit der Schnitt-Wasserlinie wl.
// Nur der Unterwasser-Streifen (unter wl) wird hochskaliert ueber Atmosphaere/Berg geblittet;
// der Smog-Himmel des Shaders oberhalb bleibt weg (dort steht die Schnitt-Atmosphaere).
function drawSectionWater(wl, alpha) {
  if (waterReduceMotion || waterShaderFailed || PERF_FLAT) { drawSectionWaterFallback(wl, alpha); return; }
  ensureWaterBuffer();
  if (!waterBuf || !waterShader) { drawSectionWaterFallback(wl, alpha); return; }
  try {
    const g = waterBuf;
    g.clear(); g.noStroke(); g.shader(waterShader);
    waterShader.setUniform('uTime', millis() / 1000);
    waterShader.setUniform('uResolution', [g.width, g.height]);
    waterShader.setUniform('uWaterlineY', wl);          // Schnitt-Wasserlinie (animiert) statt WATERLINE_FRAC
    waterShader.setUniform('uLightDir', WATER_LIGHTDIR);
    waterShader.setUniform('uLightColor', WATER_LIGHTCOL);
    waterShader.setUniform('uSnow', SNOW_AMOUNT);
    waterShader.setUniform('uCaustics', CAUSTICS_AMOUNT);
    g.plane(g.width + 2, g.height + 2);
    g.resetShader();
    if (!waterProbed) {
      waterProbed = true;
      const px = g.get(g.width >> 1, g.height >> 1);
      if (!px || px[3] < 5) throw new Error('leerer Render (Shader-Compile-Fehler)');
    }
  } catch (e) {
    console.warn('Section-Wasser-Shader -> Fallback drawSectionWaterFallback()', e);
    waterShaderFailed = true;
    if (waterBuf) { waterBuf.remove(); waterBuf = null; }
    waterShader = null;
    drawSectionWaterFallback(wl, alpha);
    return;
  }
  const W = width, H = height, bw = waterBuf.width, bh = waterBuf.height;
  const syTop = Math.max(0, Math.floor(wl * bh));
  push();
  drawingContext.globalAlpha = 1;                       // Alpha hier via tint, nicht doppelt zum Outer
  imageMode(CORNER);
  tint(255, 255 * alpha * SECTION_WATER_OPACITY);       // halbtransparent -> Berg + Tiefwasser-Basis scheinen durch
  image(waterBuf, 0, wl * H, W, H - wl * H, 0, syTop, bw, bh - syTop);
  noTint();
  pop();
}

// Fallback ohne Shader (reduced-motion / Shader-Fehler): einfacher Wasserverlauf unter der Wasserlinie.
function drawSectionWaterFallback(wl, alpha) {
  const W = width, H = height, ctx = drawingContext;
  const water = ctx.createLinearGradient(0, wl * H, 0, H);
  water.addColorStop(0.00, 'rgba(40,95,100,0.94)');
  water.addColorStop(0.35, 'rgba(20,62,84,0.96)');
  water.addColorStop(0.72, 'rgba(10,34,52,0.98)');
  water.addColorStop(1.00, 'rgba(3,12,20,1.0)');
  push();
  drawingContext.globalAlpha = alpha * SECTION_WATER_OPACITY;   // halbtransparent -> Berg bleibt sichtbar
  ctx.fillStyle = water; ctx.fillRect(0, wl * H, W, H - wl * H);
  noFill(); stroke(230, 240, 235, 130); strokeWeight(1.5);
  beginShape();
  for (let x = 0; x <= W; x += 24) vertex(x, wl * H + Math.sin(x * 0.03 + millis() * 0.0015) * 1.6);
  endShape();
  pop();
}

// Dezenter, pulsierender Gold-Ring als Section-Hotspot (im lokalen Entity-Frame gezeichnet).
function drawHotspotMarker(ent, sz, alpha, hover) {
  // DESCENT-Orb: pulsierender, additiv gestufter Glow + heller Kern + kreisende Satelliten-
  // Partikel. Besuchte Hotspots (ent.visited, gesetzt beim Oeffnen des Readers) sind gedimmt.
  if (!ent.sats) {   // Satelliten einmalig pro Hotspot wuerfeln (Radius relativ zum Orb)
    ent.sats = [];
    for (let i = 0; i < 10; i++) ent.sats.push({
      a: Math.random() * TWO_PI,           // Startwinkel
      r: 0.9 + Math.random() * 1.2,        // Bahnradius (in Orb-Radien)
      s: (0.2 + Math.random() * 0.7) * (Math.random() < 0.5 ? -1 : 1),   // Winkeltempo
      sz: 0.8 + Math.random() * 1.6        // Punktgroesse (px)
    });
  }
  const visited = !!ent.visited;
  const col = visited ? [120, 110, 88] : [216, 178, 90];       // Gold; besucht = stumpfes Warmgrau
  const p = 0.7 + 0.3 * Math.sin(millis() * 0.0025 + ent.bobPhase);
  const R = sz * 0.30;
  push();
  noStroke();
  // gestufter Glow (mehrere weiche Scheiben addieren sich zum Leuchten)
  for (let i = 6; i > 0; i--) {
    fill(col[0], col[1], col[2], alpha * (visited ? 2.5 : 9) * p * (hover ? 1.4 : 1));
    ellipse(0, 0, R * 0.55 * i);
  }
  // heller Kern
  fill(Math.min(255, col[0] + 30), Math.min(255, col[1] + 40), col[2] + 30, alpha * (visited ? 90 : 235) * p);
  ellipse(0, 0, R * 0.34 * (hover ? 1.25 : 1));
  // Satelliten
  for (const s of ent.sats) {
    s.a += s.s * 0.016;
    fill(col[0], col[1], col[2], alpha * (visited ? 25 : 110) * p);
    ellipse(Math.cos(s.a) * s.r * R, Math.sin(s.a) * s.r * R, s.sz);
  }
  // Hover: heller Hof (wie DESCENT)
  if (hover) { fill(255, 240, 200, alpha * 55); ellipse(0, 0, R * 1.5); }
  pop();
}

// =========================================================================
//  VIZ-UNTERSZENEN (noNav): prozedurale Erklaer-Ansichten wie atmosphere/water.
//  Erreichbar ueber pulsierende Gold-Marker in der Elternszene; eigener Zoom
//  (Pivot = Elternszene) + Hotspot-Callouts. drawViz() dispatcht nach sc.viz.
//  Alle Tuning-Werte sind 'let'-Globals -> direkt editierbar.
// =========================================================================
let VIZ_SUN_CORONA = 1.0;    // Staerke von Korona/Strahlenkranz der Sonne
let VIZ_SUN_GRAN = 1.0;      // Staerke der Granulation (Oberflaechen-Koernung)
let VIZ_CAPTION = 1.0;       // Deckkraft der kleinen Bild-Ueberschrift je Viz (0 = aus)

// Menue der Viz-Marker je Elternszene. anchor bestimmt die Marker-Position:
//   'globe' rel. zur Weltkugel (ox/oy in Radien) · 'sun' auf der Sonnenposition ·
//   'screen' feste Bildkoords (sx/sy in 0..1). label = Marker-Text. id = Ziel-Szene.
// Szene 2 hat KEINE Marker mehr: Station/Wildlife/Living sind dort jetzt normale Hotspot-
// Entities (hs_station/hs_wildlife/hs_living in entities.json), die den Reader oeffnen.
// Die Viz-Unterszenen station_cut/habitat/wildlife bleiben definiert, sind aber unverlinkt.
const VIZ_MENU = [
  { id: 'atmosphere',  parent: 'scene1', label: 'Atmosphere',  anchor: 'globe',  ox: 0.0,  oy: -RIM_MARK_K },
  { id: 'water',       parent: 'scene1', label: 'Water',       anchor: 'globe',  ox: 0.42, oy: 0.40 },
  { id: 'sun',         parent: 'scene1', label: 'The sun',     anchor: 'sun' }
];

function sceneIndexById(id) { return scenes.findIndex(s => s && s.id === id); }

// Bildschirmposition (px) eines Viz-Markers je nach Anker (null, falls Anker fehlt).
function vizMarkerPos(v) {
  const W = width, H = height;
  if (v.anchor === 'globe') {
    const g = allEntities.find(e => e.isGlobe);
    if (!g || !(g.radius > 0)) return null;
    return { x: g.pos.x + (v.ox || 0) * g.radius, y: g.pos.y + (v.oy || 0) * g.radius };
  }
  if (v.anchor === 'sun') {
    const mm = Math.min(W, H), sa = sunOrbitAngle();
    return { x: W / 2 + Math.cos(sa) * SUN_ORBIT_R * mm, y: H / 2 - Math.sin(sa) * SUN_ORBIT_R * mm };
  }
  return { x: (v.sx != null ? v.sx : 0.5) * W, y: (v.sy != null ? v.sy : 0.5) * H };
}
function vizMarkerR(v) {
  if (v.anchor === 'globe') {
    const g = allEntities.find(e => e.isGlobe);
    if (g && g.radius > 0) return Math.max(16, g.radius * 0.14);
  }
  return Math.max(16, Math.min(width, height) * 0.028);
}

// ---- Layouts: gemeinsame Geometrie fuer Zeichnung UND Hotspot-Position (vizHotspotNorm). ----
function sunLayout() {
  const W = width, H = height, mm = Math.min(W, H);
  return { cx: W * 0.40, cy: H * 0.52, r: mm * 0.24 };
}
function stationLayout() {
  const W = width, H = height, mm = Math.min(W, H);
  return { cx: W * 0.40, cy: H * 0.52, hw: mm * 0.16, hh: mm * 0.30 };
}
function livingLayout() {
  const W = width, H = height, mm = Math.min(W, H);
  const bw = mm * 0.44, bh = mm * 0.40, cx = W * 0.42, cy = H * 0.52;
  return { cx, cy, bw, bh, x0: cx - bw / 2, y0: cy - bh / 2 };
}

// Normierte (0..1) Bildschirmposition eines Viz-Hotspots auf seinem gezeichneten Feature.
// Gleiche Layout-Funktionen wie die Zeichnung -> Hotspot sitzt immer am Feature (seitenverhaeltnis-fest).
function vizHotspotNorm(id) {
  const W = width, H = height, P = p => ({ x: p.x / W, y: p.y / H });
  switch (id) {
    // (Sun-Hotspots konsolidiert -> hs_sun mit fester path-Position + anno-Diagramm)
    // Station
    case 'st_hull':     { const s = stationLayout(); return P({ x: s.cx - s.hw,        y: s.cy - s.hh * 0.15 }); }
    case 'st_life':     { const s = stationLayout(); return P({ x: s.cx,               y: s.cy - s.hh * 0.42 }); }
    case 'st_ballast':  { const s = stationLayout(); return P({ x: s.cx - s.hw * 0.42, y: s.cy + s.hh * 0.68 }); }
    case 'st_airlock':  { const s = stationLayout(); return P({ x: s.cx + s.hw,        y: s.cy + s.hh * 0.28 }); }
    // Living: Wohnen (Hohlraum oben-links) · Sway (Ballast/Tiefenraeume unten) · Navigation (Passage rechts-mitte)
    case 'dwelling':        { const s = livingLayout(); return P({ x: s.x0 + s.bw * 0.18, y: s.y0 + s.bh * 0.30 }); }
    case 'the_sway':        { const s = livingLayout(); return P({ x: s.x0 + s.bw * 0.50, y: s.y0 + s.bh * 0.85 }); }
    case 'finding_the_way': { const s = livingLayout(); return P({ x: s.x0 + s.bw * 0.82, y: s.y0 + s.bh * 0.52 }); }
    // Wildlife: keine eigenen Faelle mehr — die Erklaerung laeuft jetzt als Info-Hotspots direkt in
    // Szene 2 (wildlifeInfo, feste path-Position), analog zu den Station-Info-Hotspots.
  }
  return null;
}

// kleine Bild-Ueberschrift oben RECHTS (Mono, dezent) -> rahmt die Erklaerung ein.
// (Oben links sitzt seit dem DESCENT-Umbau das Szenen-Menue -> Kollision vermeiden.)
function drawVizCaption(title, sub) {
  if (VIZ_CAPTION <= 0) return;
  const mm = Math.min(width, height), x = width * 0.945, y = height * 0.085, a = VIZ_CAPTION;
  push(); noStroke(); textAlign(RIGHT, TOP); textFont('Courier New');
  textSize(Math.max(13, mm * 0.021)); fill(232, 226, 210, 210 * a); text(title, x, y);
  if (sub) { textSize(Math.max(11, mm * 0.0135)); fill(200, 194, 178, 150 * a); text(sub, x, y + Math.max(20, mm * 0.031)); }
  pop();
}

// Pfad-Helfer (rohes Canvas): abgerundetes Rechteck / Stations-Kapsel.
function roundRectPath(ctx, x, y, w, h, rad) {
  rad = Math.min(rad, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y); ctx.arcTo(x + w, y, x + w, y + rad, rad);
  ctx.lineTo(x + w, y + h - rad); ctx.arcTo(x + w, y + h, x + w - rad, y + h, rad);
  ctx.lineTo(x + rad, y + h); ctx.arcTo(x, y + h, x, y + h - rad, rad);
  ctx.lineTo(x, y + rad); ctx.arcTo(x, y, x + rad, y, rad);
  ctx.closePath();
}
function stationCapsulePath(ctx, cx, cy, hw, hh) {
  roundRectPath(ctx, cx - hw, cy - hh, hw * 2, hh * 2, Math.min(hw, hh * 0.5) * 0.95);
}
// winzige Figuren-Silhouette (Kopf + Rumpf) im rohen Canvas.
function drawTinyFigure(ctx, x, y, s, col) {
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.arc(x, y - s * 0.62, s * 0.26, 0, TWO_PI); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x - s * 0.22, y - s * 0.34);
  ctx.lineTo(x + s * 0.22, y - s * 0.34); ctx.lineTo(x + s * 0.16, y + s * 0.5);
  ctx.lineTo(x - s * 0.16, y + s * 0.5); ctx.closePath(); ctx.fill();
}

// ---- Eigene Szenen-Bilder (sceneImage:true in entities.json): liegt fuer eine Unterszene ein
// eigenes Bild im variants-Ordner, liefert das true -> die drawViz*/drawAtmosphere-Funktion laesst
// ihr PROZEDURALES Motiv weg (Hintergrund, Caption und Hotspots bleiben). Das Bild selbst zeichnet
// der normale Entity-Loop (Position/Groesse ueber path/scale des Entities tunen). Ordner leer -> alles wie bisher.
function sceneImageLoaded(sceneId) {
  return allEntities.some(e => e.def.sceneImage && e.def.scene === sceneId &&
    ((e.variants && e.variants.length) || e.img));
}

// Dispatcher: sc.viz -> passende Erklaer-Ansicht. hasImg = eigenes Szenen-Bild vorhanden ->
// prozedurales Motiv weglassen (die Szene wird ueber die viz-Art gefunden, nicht ueber die id).
function drawViz(kind, alpha) {
  const sc = scenes.find(s => s && s.viz === kind);
  const hasImg = sc ? sceneImageLoaded(sc.id) : false;
  if (kind === 'sun') drawVizSun(alpha, hasImg);
  else if (kind === 'station') drawVizStation(alpha, hasImg);
  else if (kind === 'living') drawVizLiving(alpha, hasImg);
  else if (kind === 'wildlife') drawVizWildlife(alpha, hasImg);
}

// =========================================================================
//  VIZ-SONNE (Shader): brodelnde FBM-Oberflaeche nach der sun.3dapp.online-Referenz —
//  hohe Noise-Frequenz (fbmFrequency ~8.9), harte Emissive-Schwelle (0.01..0.98),
//  KEINE Korona, kein Bloom; dazu ein Eruptions-System am Rand (Protuberanz-Schleifen,
//  Intervall 0.5–6.7 s, bis 35 aktiv, Deckkraft 0.86, Groesse 3..10 -> Anteil des Radius).
//  Faellt bei Shader-Fehler/reduced-motion auf die bisherige 2D-Sonne zurueck.
//  SW-Modus: der #sun-tint-Layer (mix-blend color) gibt der grauen Scheibe den Goldton
//  zurueck — die Helligkeits-Struktur (Brodeln/Eruptionen) bleibt dabei voll erhalten.
// =========================================================================
let vizSunBuf = null, vizSunShader = null, vizSunFailed = false, vizSunProbed = false;
const VIZSUN_BUF = 640;   // Buffer-Kantenlaenge (px); Scheibe belegt 80% davon
const VIZSUN_FRAG = `
precision highp float;
uniform float uTime;
uniform vec2  uResolution;
` + GLSL_NOISE + `
void main(){
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec2 p  = uv - 0.5;
  float r = length(p);
  float t = uTime;
  const float RD = 0.40;                        // Scheibenradius in UV (fuellt den Buffer)

  // brodelnde Oberflaeche: domain-warped FBM, hohe Frequenz (Referenz: fbmFrequency 8.9)
  vec2 q = p / RD;                              // auf Scheibenradius normiert
  vec2 warp = vec2(fbm(q*3.0 + t*0.05), fbm(q*3.0 + 7.3 - t*0.06));
  float n1 = fbm(q*8.9  + warp*1.6 + t*0.10);   // Haupt-Granulation, brodelt zeitlich
  float n2 = fbm(q*17.0 - warp*1.2 - t*0.14);   // feinere zweite Lage
  float boil = clamp(n1*0.72 + n2*0.28, 0.0, 1.0);

  // Emissive-Schwelle (Referenz: thresholdMin 0.01 / max 0.98) -> helle Adern, dunkle Zellraender
  float emiss = pow(smoothstep(0.01, 0.98, boil), 1.35);

  float mu   = sqrt(max(0.0, 1.0 - (r*r)/(RD*RD)));
  float limb = 0.35 + 0.65*mu;                  // Randverdunkelung
  float disk = smoothstep(RD, RD - 0.006, r);   // knackige Kante (bloom off)

  vec3 deep  = vec3(0.55, 0.16, 0.02);          // dunkle Zellraender
  vec3 gold  = vec3(1.00, 0.62, 0.16);
  vec3 white = vec3(1.00, 0.93, 0.70);
  vec3 col = mix(deep, gold, emiss);
  col = mix(col, white, smoothstep(0.78, 1.0, emiss));
  col *= limb * 1.55;                           // Helligkeit (Referenz: brightness hoch)
  col *= disk;

  // keine Korona — nur hauchduenner heisser Saum direkt an der Kante
  float rim = smoothstep(RD + 0.012, RD, r) * (1.0 - disk);
  col += gold * rim * 0.5;

  col *= smoothstep(0.5, 0.42, r);              // runde Maske vor der Buffer-Kante
  gl_FragColor = vec4(col, 1.0);                // opak auf Schwarz -> additiv geblittet
}`;

function ensureVizSunBuffer() {
  if (waterReduceMotion || vizSunFailed || vizSunBuf) return;
  try {
    const buf = createGraphics(VIZSUN_BUF, VIZSUN_BUF, WEBGL);
    buf.pixelDensity(1);
    vizSunShader = buf.createShader(WATER_VERT, VIZSUN_FRAG);
    vizSunBuf = buf;
    vizSunProbed = false;
  } catch (e) {
    console.warn('Viz-Sonnen-Shader nicht verfuegbar -> 2D-Fallback', e);
    vizSunFailed = true;
    if (vizSunBuf) { vizSunBuf.remove(); vizSunBuf = null; }
    vizSunShader = null;
  }
}

// rendert die Shader-Sonne und blittet sie additiv auf (cx,cy) mit Scheibenradius r.
// true = gezeichnet; false = Fallback auf die alte 2D-Sonne.
function drawVizSunShader(cx, cy, r, t) {
  if (waterReduceMotion || vizSunFailed || PERF_FLAT) return false;
  ensureVizSunBuffer();
  if (!vizSunBuf || !vizSunShader) return false;
  try {
    const g = vizSunBuf;
    g.clear(); g.noStroke(); g.shader(vizSunShader);
    vizSunShader.setUniform('uTime', t);
    vizSunShader.setUniform('uResolution', [g.width, g.height]);
    g.plane(g.width + 2, g.height + 2);
    g.resetShader();
    if (!vizSunProbed) {   // einmalig pruefen, ob der Shader wirklich Pixel liefert
      vizSunProbed = true;
      const px = g.get(g.width >> 1, g.height >> 1);
      if (!px || (px[0] + px[1] + px[2]) < 8) throw new Error('leerer Render (Shader-Compile-Fehler)');
    }
  } catch (e) {
    console.warn('Viz-Sonnen-Shader -> 2D-Fallback', e);
    vizSunFailed = true;
    if (vizSunBuf) { vizSunBuf.remove(); vizSunBuf = null; }
    vizSunShader = null;
    return false;
  }
  const D = r / 0.40;   // Scheibenradius RD=0.40 in UV -> Blit-Kantenlaenge = r/RD (Scheibe = 80% davon)
  push();
  blendMode(ADD);
  imageMode(CENTER);
  image(vizSunBuf, cx, cy, D, D);
  blendMode(BLEND);
  pop();
  return true;
}

// Eruptions-System (Referenz-Parameter): Protuberanz-Schleifen am Rand. Spawn alle 0.5–6.7 s,
// Bestand max. 35 (Start fuellt schneller auf ~9), Groesse 3..10 -> 0.09..0.29 Scheibenradien,
// Deckkraft-Huellkurve bis 0.86. Additiv gezeichnet, leichtes Wehen ueber Sinus + seed.
let vizSunEruptions = [];
let vizSunNextSpawn = 0;
function updateVizSunEruptions(cx, cy, R, t, ctx) {
  if (t > vizSunNextSpawn && vizSunEruptions.length < 35) {
    const n = vizSunEruptions.length < 9 ? 3 : 1;
    for (let i = 0; i < n; i++) vizSunEruptions.push({
      ang: Math.random() * TWO_PI,
      size: (3 + Math.random() * 7) / 35,            // 3..10 -> 0.086..0.29 R
      born: t,
      life: 2.2 + Math.random() * 3.4,
      span: 0.10 + Math.random() * 0.16,             // Fussbreite am Rand (rad)
      seed: Math.random() * 10
    });
    vizSunNextSpawn = t + 0.5 + Math.random() * 6.2; // 502..6721 ms (Referenz)
  }
  vizSunEruptions = vizSunEruptions.filter(e => t - e.born < e.life);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const e of vizSunEruptions) {
    const p = (t - e.born) / e.life;
    const env = Math.sin(Math.PI * Math.min(1, p));            // auf- und abschwellen
    const a = 0.86 * env;                                      // Referenz: opacity 0.86
    const h = e.size * R * (0.5 + 0.5 * env);                  // Bogenhoehe atmet mit
    const a0 = e.ang - e.span / 2, a1 = e.ang + e.span / 2;
    const x0 = cx + Math.cos(a0) * R, y0 = cy + Math.sin(a0) * R;
    const x1 = cx + Math.cos(a1) * R, y1 = cy + Math.sin(a1) * R;
    const am = e.ang + Math.sin(t * 0.9 + e.seed) * 0.03;      // leichtes Wehen der Schleife
    const xm = cx + Math.cos(am) * (R + h * 2.2), ym = cy + Math.sin(am) * (R + h * 2.2);
    ctx.strokeStyle = 'rgba(255,170,70,' + a.toFixed(3) + ')';
    ctx.lineWidth = Math.max(1, R * 0.012 * (0.6 + env));
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(xm, ym, x1, y1); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,225,150,' + (a * 0.55).toFixed(3) + ')';   // heller Kern
    ctx.lineWidth = Math.max(0.6, R * 0.005);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(xm, ym, x1, y1); ctx.stroke();
  }
  ctx.restore();
}

// ---- SUN: grosse Sonnenscheibe. Shader-Pfad (brodelnde FBM-Sonne + Eruptionen, s.o.);
//      2D-Zeichnung (Kern/Granulation/Korona/CME) bleibt als Fallback. ----
// hasImg = eigenes Szenen-Bild vorhanden -> nur Weltraum+Sterne+Caption, Sonne kommt als Bild-Entity.
function drawVizSun(alpha, hasImg = false) {
  const W = width, H = height, ctx = drawingContext, t = millis() * 0.001, F = frameCount;
  const { cx, cy, r } = sunLayout();
  push(); ctx.globalAlpha = alpha;

  // 1) Weltraum + Sterne
  const sp = ctx.createLinearGradient(0, 0, 0, H);
  sp.addColorStop(0, '#0a0500'); sp.addColorStop(1, '#040203');
  ctx.fillStyle = sp; ctx.fillRect(0, 0, W, H);
  if (!drawVizSun._stars) {
    const s = [];
    for (let i = 0; i < 70; i++) s.push({ x: Math.random(), y: Math.random(), r: 0.4 + Math.random() * 1.1, ph: Math.random() * 6.28 });
    drawVizSun._stars = s;
  }
  noStroke();
  for (const st of drawVizSun._stars) { fill(240, 232, 210, Math.max(0, 80 + 70 * Math.sin(t * 0.7 + st.ph))); ellipse(st.x * W, st.y * H, st.r); }

  const flick = sunFlicker(t);

  if (!hasImg && drawVizSunShader(cx, cy, r, t)) {
    // Shader-Sonne (brodelnde FBM-Oberflaeche) + Eruptions-Schleifen am Rand
    updateVizSunEruptions(cx, cy, r, t, ctx);
  } else if (!hasImg) {   // Shader nicht verfuegbar -> bisherige 2D-Sonne (Korona/Scheibe/CME)
  // 2) Korona-Glut (radial, additiv) + lange, langsam rotierende Strahlen
  push(); ctx.globalCompositeOperation = 'lighter';
  const glow = ctx.createRadialGradient(cx, cy, r * 0.7, cx, cy, r * 3.0);
  glow.addColorStop(0.0, 'rgba(255,200,90,' + (0.30 * VIZ_SUN_CORONA).toFixed(3) + ')');
  glow.addColorStop(0.4, 'rgba(240,140,30,' + (0.13 * VIZ_SUN_CORONA).toFixed(3) + ')');
  glow.addColorStop(1.0, 'rgba(180,70,0,0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 48; i++) {
    const ang = (TWO_PI / 48) * i + F * 0.0015;
    const len = r * (1.4 + noise(i * 0.7, F * 0.004) * 1.5);
    const fl = 0.6 + 0.4 * Math.sin(F * 0.05 + i * 1.3);
    stroke(255, 190 + 40 * flick, 70, 30 * fl * VIZ_SUN_CORONA); strokeWeight(Math.max(0.4, 1.4 - (i % 3) * 0.35));
    line(cx + Math.cos(ang) * r * 1.02, cy + Math.sin(ang) * r * 1.02, cx + Math.cos(ang) * (r + len), cy + Math.sin(ang) * (r + len));
  }
  pop();

  // 3) Sonnenscheibe (Kern -> Rand, Limb-Darkening), geclippt fuer Granulation + Flecken
  const disc = ctx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r);
  disc.addColorStop(0.0, '#fff3c8'); disc.addColorStop(0.55, '#ffce5c'); disc.addColorStop(0.85, '#f29320'); disc.addColorStop(1.0, '#c65708');
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, TWO_PI); ctx.clip();
  ctx.fillStyle = disc; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  // Granulation: koernige Konvektionszellen (additiv, driftend)
  ctx.globalCompositeOperation = 'lighter';
  if (!drawVizSun._gran) {
    const g = [];
    for (let i = 0; i < 90; i++) g.push({ a: Math.random() * TWO_PI, rr: Math.pow(Math.random(), 0.6), s: 0.05 + Math.random() * 0.10, ph: Math.random() * 6.28 });
    drawVizSun._gran = g;
  }
  for (const c of drawVizSun._gran) {
    const rad = c.rr * r * 0.95, gx = cx + Math.cos(c.a + t * 0.03) * rad, gy = cy + Math.sin(c.a + t * 0.03) * rad;
    const b = 0.5 + 0.5 * Math.sin(t * 1.2 + c.ph);
    ctx.fillStyle = 'rgba(255,214,130,' + (0.09 * b * VIZ_SUN_GRAN).toFixed(3) + ')';
    ctx.beginPath(); ctx.arc(gx, gy, c.s * r, 0, TWO_PI); ctx.fill();
  }
  // Sonnenflecken (dunkle Loecher)
  ctx.globalCompositeOperation = 'source-over';
  const spots = [{ x: -0.44, y: -0.26, s: 0.15 }, { x: 0.22, y: 0.30, s: 0.11 }, { x: 0.04, y: -0.46, s: 0.07 }];
  for (const s2 of spots) {
    const sx = cx + s2.x * r, sy = cy + s2.y * r, sr = s2.s * r;
    const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
    sg.addColorStop(0, 'rgba(70,26,4,0.85)'); sg.addColorStop(0.6, 'rgba(120,50,8,0.45)'); sg.addColorStop(1, 'rgba(200,110,20,0)');
    ctx.fillStyle = sg; ctx.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
  }
  ctx.restore();

  // 4) CME/Flare-Bogen unten rechts (periodisch aufflammend)
  push(); ctx.globalCompositeOperation = 'lighter';
  const burst = Math.pow(0.5 + 0.5 * Math.sin(t * 0.3), 6);   // meist ~0, kurz hell
  if (burst > 0.02) {
    const a0 = 0.28 * PI, a1 = 0.66 * PI;
    stroke(255, 180, 90, 170 * burst); strokeWeight(2.2); noFill();
    beginShape();
    for (let k = 0; k <= 24; k++) {
      const p = k / 24, ang = a0 + (a1 - a0) * p, arc = r * (1.02 + 0.55 * Math.sin(p * PI) * (1 + burst));
      vertex(cx + Math.cos(ang) * arc, cy + Math.sin(ang) * arc);
    }
    endShape();
  }
  pop();
  }   // Ende 2D-Fallback

  drawVizCaption('THE SUN', 'the engine — and the threat');
  ctx.globalAlpha = 1; pop();
}

// ---- STATION: Wassersaeule + technischer Querschnitt (duenne weiss-graue Blueprint-Linien). ----
// hasImg = eigenes Szenen-Bild vorhanden -> nur Wassersaeule+Caption, Querschnitt kommt als Bild-Entity.
function drawVizStation(alpha, hasImg = false) {
  const W = width, H = height, ctx = drawingContext, t = millis() * 0.001;
  const { cx, cy, hw, hh } = stationLayout();
  push(); ctx.globalAlpha = alpha;

  // 1) Wassersaeule: toedliche Oberflaeche (gold) -> sichere Bandzone (blau) -> kalte Tiefe (dunkel)
  const col = ctx.createLinearGradient(0, 0, 0, H);
  col.addColorStop(0.00, '#3a2a10'); col.addColorStop(0.13, '#2a3730');
  col.addColorStop(0.38, '#0f3a44'); col.addColorStop(0.74, '#082230'); col.addColorStop(1.00, '#030a12');
  ctx.fillStyle = col; ctx.fillRect(0, 0, W, H);
  push(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 5; i++) { const y = H * (0.03 + i * 0.026); stroke(255, 210, 90, 12 * (0.6 + 0.4 * Math.sin(t + i))); strokeWeight(1); line(0, y, W, y); }
  pop();

  if (!hasImg) {   // eigenes Bild vorhanden -> prozeduralen Querschnitt (Tether/Kapsel/Innenleben) weglassen
  // 2) Verankerungs-Tether zum Meeresboden
  stroke(150, 175, 190, 55); strokeWeight(1.5); line(cx, cy + hh, cx, H * 0.985);
  noStroke(); fill(50, 70, 80, 130); ellipse(cx, H * 0.99, hw * 1.1, hh * 0.10);

  // 3) Druckkoerper (Kapsel): halbtransparent gefuellt + duenne Blueprint-Kontur
  ctx.lineJoin = 'round';
  stationCapsulePath(ctx, cx, cy, hw, hh);
  ctx.fillStyle = 'rgba(20,34,44,0.55)'; ctx.fill();
  ctx.strokeStyle = 'rgba(226,232,238,0.85)'; ctx.lineWidth = 1.6; ctx.stroke();

  // 4) Innenleben (geclippt): Decks, Saeule, Ballasttanks, warme Fenster
  ctx.save();
  stationCapsulePath(ctx, cx, cy, hw, hh); ctx.clip();
  ctx.strokeStyle = 'rgba(210,220,228,0.26)'; ctx.lineWidth = 1;
  for (let d = -2; d <= 2; d++) { const y = cy + d * (hh / 3.2); ctx.beginPath(); ctx.moveTo(cx - hw, y); ctx.lineTo(cx + hw, y); ctx.stroke(); }
  ctx.strokeStyle = 'rgba(210,220,228,0.38)'; ctx.beginPath(); ctx.moveTo(cx, cy - hh); ctx.lineTo(cx, cy + hh); ctx.stroke();
  ctx.strokeStyle = 'rgba(210,220,228,0.34)';
  ctx.strokeRect(cx - hw * 0.72, cy + hh * 0.46, hw * 0.6, hh * 0.4);
  ctx.strokeRect(cx + hw * 0.12, cy + hh * 0.46, hw * 0.6, hh * 0.4);
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 12; i++) {
    const wx = cx - hw * 0.66 + (i % 4) * hw * 0.44, wy = cy - hh * 0.62 + Math.floor(i / 4) * hh * 0.34;
    const b = 0.4 + 0.6 * Math.sin(t * 1.3 + i * 1.7);
    ctx.fillStyle = 'rgba(255,206,120,' + (0.55 * b).toFixed(3) + ')'; ctx.fillRect(wx, wy, 3.2, 3.2);
  }
  ctx.restore();

  // 5) Airlock-Port (rechts)
  const ax = cx + hw, ay = cy + hh * 0.28;
  ctx.strokeStyle = 'rgba(226,232,238,0.8)'; ctx.lineWidth = 1.4; ctx.fillStyle = 'rgba(16,28,38,0.75)';
  ctx.beginPath(); ctx.ellipse(ax, ay, hw * 0.17, hh * 0.13, 0, 0, TWO_PI); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(ax, ay, hw * 0.09, hh * 0.07, 0, 0, TWO_PI); ctx.stroke();
  }   // Ende !hasImg (prozeduraler Querschnitt)

  drawVizCaption('THE STATION', 'a pressure hull in the living band');
  ctx.globalAlpha = 1; pop();
}

// ---- LIVING: warmer Habitat-Querschnitt, Wohn-Module + Figuren + Hydroponik + Moon-Pool. ----
// hasImg = eigenes Szenen-Bild vorhanden -> nur Wasser-Hintergrund+Caption, Habitat kommt als Bild-Entity.
function drawVizLiving(alpha, hasImg = false) {
  const W = width, H = height, ctx = drawingContext, t = millis() * 0.001;
  const { cx, cy, bw, bh, x0, y0 } = livingLayout();
  push(); ctx.globalAlpha = alpha;

  // 1) aussen kaltes Wasser
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0c1a20'); bg.addColorStop(1, '#040b10');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

  if (!hasImg) {   // eigenes Bild vorhanden -> prozedurales Habitat (Huelle/Module) weglassen
  // 2) Huelle
  ctx.fillStyle = 'rgba(18,28,34,0.6)'; ctx.strokeStyle = 'rgba(226,232,238,0.7)'; ctx.lineWidth = 1.6;
  roundRectPath(ctx, x0 - 8, y0 - 8, bw + 16, bh + 16, 16); ctx.fill(); ctx.stroke();

  // 3) Raster aus Wohn-Modulen (3x3), warm; Sonderraeume Hydroponik + Moon-Pool
  const cols = 3, rows = 3, gw = bw / cols, gh = bh / rows;
  for (let r2 = 0; r2 < rows; r2++) for (let c = 0; c < cols; c++) {
    const rx = x0 + c * gw + 2, ry = y0 + r2 * gh + 2, rw = gw - 4, rh = gh - 4;
    const isFood = (c === 2 && r2 === 0), isWater = (r2 === rows - 1 && c === 1);
    if (isWater) {
      const wg = ctx.createLinearGradient(rx, ry, rx, ry + rh);
      wg.addColorStop(0, 'rgba(40,110,120,0.85)'); wg.addColorStop(1, 'rgba(10,40,55,0.9)');
      ctx.fillStyle = wg;
    } else if (isFood) {
      const fg = ctx.createLinearGradient(rx, ry, rx, ry + rh);
      fg.addColorStop(0, 'rgba(60,120,50,0.8)'); fg.addColorStop(1, 'rgba(28,60,26,0.85)');
      ctx.fillStyle = fg;
    } else {
      const rg = ctx.createLinearGradient(rx, ry, rx, ry + rh);
      rg.addColorStop(0, 'rgba(74,54,28,0.82)'); rg.addColorStop(1, 'rgba(38,28,16,0.82)');
      ctx.fillStyle = rg;
    }
    ctx.fillRect(rx, ry, rw, rh);
    ctx.strokeStyle = 'rgba(210,200,180,0.22)'; ctx.lineWidth = 1; ctx.strokeRect(rx, ry, rw, rh);
    // Inhalte
    if (isFood) {
      ctx.strokeStyle = 'rgba(150,220,140,0.55)'; ctx.lineWidth = 1;
      for (let k = 0; k < 3; k++) { const yy = ry + rh * (0.3 + k * 0.24); ctx.beginPath(); ctx.moveTo(rx + rw * 0.15, yy); ctx.lineTo(rx + rw * 0.85, yy); ctx.stroke(); }
    } else if (isWater) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const b = 0.5 + 0.5 * Math.sin(t * 1.5);
      ctx.strokeStyle = 'rgba(150,220,235,' + (0.5 * b).toFixed(3) + ')'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(rx + rw * 0.15, ry + rh * 0.35); ctx.lineTo(rx + rw * 0.85, ry + rh * 0.35); ctx.stroke();
      ctx.restore();
      drawTinyFigure(ctx, rx + rw * 0.5, ry + rh * 0.34, gh * 0.34, 'rgba(12,16,18,0.85)');
    } else {
      // Figuren-Silhouette in einigen Wohn-Raeumen
      if ((c + r2) % 2 === 0) drawTinyFigure(ctx, rx + rw * 0.5, ry + rh * 0.72, gh * 0.4, 'rgba(20,14,8,0.8)');
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const wb = 0.35 + 0.35 * Math.sin(t * 0.9 + c * 1.3 + r2 * 2.1);
      ctx.fillStyle = 'rgba(255,206,130,' + (0.14 * wb).toFixed(3) + ')'; ctx.fillRect(rx, ry, rw, rh * 0.4);
      ctx.restore();
    }
  }
  }   // Ende !hasImg (prozedurales Habitat)

  drawVizCaption('LIVING', 'how the station keeps people');
  ctx.globalAlpha = 1; pop();
}

// ---- WILDLIFE: Tiefen-Querschnitt (Baender) mit Fauna: Schwarm + Qualle + Anglerfisch + Biolum. ----
// hasImg = eigenes Szenen-Bild vorhanden -> nur Tiefen-Verlauf+Caption, Fauna kommt als Bild-Entity.
function drawVizWildlife(alpha, hasImg = false) {
  const W = width, H = height, ctx = drawingContext, t = millis() * 0.001, mm = Math.min(W, H);
  push(); ctx.globalAlpha = alpha;

  // 1) Tiefen-Verlauf: gold (Oberflaeche) -> teal (Bandzone) -> dunkel (Tiefe)
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0.00, '#b98a2e'); g.addColorStop(0.11, '#556a3e');
  g.addColorStop(0.26, '#136b6b'); g.addColorStop(0.55, '#0c3a4a'); g.addColorStop(0.78, '#08202e'); g.addColorStop(1.00, '#020a12');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // toedliches Oberflaechen-Schimmern
  push(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 5; i++) { const y = H * (0.02 + i * 0.02); stroke(255, 220, 120, 15); strokeWeight(1); line(0, y, W, y); }
  pop();

  if (!hasImg) {   // eigenes Bild vorhanden -> prozedurale Fauna (Schwarm/Qualle/Angler/Biolum) weglassen
  // 2) Bandzone: Fischschwarm (Silhouetten-Punkte, sanft schwankend) um (0.40, 0.40)
  if (!drawVizWildlife._fish) {
    const f = [];
    for (let i = 0; i < 44; i++) { const gx = Math.random() + Math.random() - 1, gy = Math.random() + Math.random() - 1; f.push({ ox: gx * 0.11, oy: gy * 0.06, ph: Math.random() * TWO_PI, s: 0.6 + Math.random() * 0.7 }); }
    drawVizWildlife._fish = f;
  }
  noStroke();
  const fcx = 0.40 * W + Math.sin(t * 0.3) * W * 0.02, fcy = 0.40 * H;
  for (const f of drawVizWildlife._fish) {
    const x = fcx + f.ox * W + Math.sin(t * 0.8 + f.ph) * mm * 0.01, y = fcy + f.oy * H + Math.cos(t * 0.7 + f.ph) * mm * 0.008;
    fill(12, 22, 26, 200); ellipse(x, y, f.s * mm * 0.011, f.s * mm * 0.005);
  }
  // Qualle (Glocke + Tentakel) um (0.60, 0.42)
  drawJelly(ctx, W * 0.60, H * 0.42, mm * 0.05, t);

  // 3) Tiefe: Anglerfisch mit Leuchtkoeder (0.66, 0.70) + biolumineszente Punkte
  drawAngler(ctx, W * 0.66, H * 0.70, mm * 0.06, t);
  push(); ctx.globalCompositeOperation = 'lighter'; noStroke();
  if (!drawVizWildlife._biolum) {
    const b = [];
    for (let i = 0; i < 22; i++) b.push({ x: Math.random(), y: 0.6 + Math.random() * 0.38, ph: Math.random() * 6.28, s: 1 + Math.random() * 2 });
    drawVizWildlife._biolum = b;
  }
  for (const b of drawVizWildlife._biolum) { fill(90, 225, 150, 70 * Math.max(0, 0.4 + 0.6 * Math.sin(t * 0.9 + b.ph))); ellipse(b.x * W, b.y * H, b.s * 3.4); }
  pop();
  }   // Ende !hasImg (prozedurale Fauna)

  drawVizCaption('WILDLIFE', 'life pressed into a narrow band');
  ctx.globalAlpha = 1; pop();
}

// Qualle: durchscheinende Glocke + wehende Tentakel (rohes Canvas, additiv-weich).
function drawJelly(ctx, x, y, s, t) {
  const pulse = 0.9 + 0.12 * Math.sin(t * 1.6);
  ctx.save();
  const bg = ctx.createRadialGradient(x, y, s * 0.1, x, y, s * pulse);
  bg.addColorStop(0, 'rgba(210,225,245,0.55)'); bg.addColorStop(1, 'rgba(150,180,225,0)');
  ctx.fillStyle = bg;
  ctx.beginPath(); ctx.ellipse(x, y, s * pulse, s * 0.8 * pulse, 0, PI, TWO_PI); ctx.fill();
  ctx.strokeStyle = 'rgba(200,220,240,0.4)'; ctx.lineWidth = 1;
  for (let i = 0; i < 6; i++) {
    const tx = x - s * 0.6 + i * s * 0.24;
    ctx.beginPath(); ctx.moveTo(tx, y);
    for (let k = 1; k <= 5; k++) { const p = k / 5; ctx.lineTo(tx + Math.sin(t * 2 + i + p * 3) * s * 0.12, y + p * s * 1.5); }
    ctx.stroke();
  }
  ctx.restore();
}
// Anglerfisch: dunkle Silhouette + pulsierender Leuchtkoeder (Biolum, additiv).
function drawAngler(ctx, x, y, s, t) {
  ctx.save();
  ctx.fillStyle = 'rgba(6,12,14,0.9)';
  ctx.beginPath(); ctx.ellipse(x, y, s, s * 0.62, 0, 0, TWO_PI); ctx.fill();          // Koerper
  ctx.beginPath(); ctx.moveTo(x + s * 0.9, y); ctx.lineTo(x + s * 1.4, y - s * 0.4); ctx.lineTo(x + s * 1.4, y + s * 0.4); ctx.closePath(); ctx.fill();  // Schwanz
  // Angel + Koeder
  ctx.strokeStyle = 'rgba(30,50,55,0.9)'; ctx.lineWidth = 1.2;
  const lx = x - s * 0.7, ly = y - s * 1.05;
  ctx.beginPath(); ctx.moveTo(x - s * 0.5, y - s * 0.4); ctx.quadraticCurveTo(x - s * 1.0, y - s * 1.1, lx, ly); ctx.stroke();
  ctx.globalCompositeOperation = 'lighter';
  const b = 0.6 + 0.4 * Math.sin(t * 3);
  const lg = ctx.createRadialGradient(lx, ly, 0, lx, ly, s * 0.5);
  lg.addColorStop(0, 'rgba(150,255,190,' + (0.9 * b).toFixed(3) + ')'); lg.addColorStop(1, 'rgba(90,220,150,0)');
  ctx.fillStyle = lg; ctx.beginPath(); ctx.arc(lx, ly, s * 0.5, 0, TWO_PI); ctx.fill();
  ctx.restore();
}

// Einstiegs-/Ausstiegs-Marker am Rand (absolute Koords). Setzt sectionHover fuer den Cursor.
function drawRimMarker(x, y, r, label) {
  const t = millis() * 0.001, pulse = 0.5 + 0.5 * Math.sin(t * 2.0);
  const hover = dist(mouseX, mouseY, x, y) < r;
  if (hover) sectionHover = true;
  push();
  translate(x, y);
  noFill();
  stroke(216, 178, 90, 65 + 80 * pulse); strokeWeight(1.5); ellipse(0, 0, 24 + 16 * pulse);
  stroke(216, 178, 90, 225); strokeWeight(1.5); ellipse(0, 0, 15);
  noStroke(); fill(235, 205, 130, 235); ellipse(0, 0, 6);
  textAlign(LEFT, CENTER); textSize(11); textFont('Courier New');
  fill(205, 178, 122, hover ? 230 : 165);
  text(label.toLowerCase(), 18, 1);   // DESCENT: lowercase Mono-Labels
  pop();
}

// Rand-Marker positionieren + zeichnen: Einstiege in die Viz-Unterszenen der AKTUELLEN Elternszene
// (Szene 1: Atmosphere/Water/Sun · Szene 2: Station/Living/Wildlife) sowie der Zurueck-Marker in
// einer Viz-Unterszene. Nur ohne Zoom/Wechsel/offenes Panel aktiv. Position je Anker (VIZ_MENU).
function updateSectionMarkers() {
  sectionHover = false;
  sectionMarkers = [];
  const curId = scenes[currentScene] && scenes[currentScene].id;
  const active = curId && nextScene < 0 && !zoomTransition && !openEntity;
  if (active) {
    for (const v of VIZ_MENU) {
      if (v.parent !== curId) continue;
      const idx = sceneIndexById(v.id); if (idx < 0) continue;
      const p = vizMarkerPos(v); if (!p) continue;
      const r = vizMarkerR(v);
      sectionMarkers.push({ x: p.x, y: p.y, r, idx, id: v.id });
      drawRimMarker(p.x, p.y, r, v.label);
    }
  }
  // In einer Viz-Unterszene: Zurueck-Marker zur Elternszene (oben mittig).
  const cur = VIZ_MENU.find(v => v.id === curId);
  const inViz = cur && nextScene < 0 && !zoomTransition && !openEntity;
  sectionBackMarker.visible = !!inViz;
  if (inViz) {
    sectionBackMarker.x = width * 0.5;
    sectionBackMarker.y = height * 0.06;
    sectionBackMarker.r = Math.max(16, Math.min(width, height) * 0.02);
    sectionBackMarker.parentIdx = sceneIndexById(cur.parent);
    const backLabel = cur.parent === SPACE_ID ? 'Back to Earth' : 'Back to the station';
    drawRimMarker(sectionBackMarker.x, sectionBackMarker.y, sectionBackMarker.r, backLabel);
  }
}

function exitSection() {
  const idx = sectionBackMarker.parentIdx;
  if (idx != null && idx >= 0) goToScene(idx);
  else if (spaceIndex >= 0) goToScene(spaceIndex);
}

// =========================================================================
//  INTERAKTION
// =========================================================================
function mousePressed() {
  if (!started || openEntity) return;
  // Rand-Marker (Ein-/Ausstieg) VOR den Entities pruefen -> Klick greift nicht die Kugel
  if (!zoomTransition && nextScene < 0) {
    for (const m of sectionMarkers) {
      if (dist(mouseX, mouseY, m.x, m.y) < m.r) { goToScene(m.idx); return; }
    }
    if (sectionBackMarker.visible && dist(mouseX, mouseY, sectionBackMarker.x, sectionBackMarker.y) < sectionBackMarker.r) { exitSection(); return; }
  }
  for (let i = allEntities.length - 1; i >= 0; i--) {
    const ent = allEntities[i];
    if (ent.def.interactive === false) continue;   // nicht-interaktiv: kein Panel, kein Greifen
    if (currentSceneAlphaFor(ent) > 0.4 && ent.contains(mouseX, mouseY)) {
      // 3D-Kugel: greifen (Drehung anhalten, dann per Ziehen steuern)
      if (ent.isGlobe) { heldEntity = ent; ent.spinVel = 0; ent.tiltVel = 0; }
      // Frame-Sequenz: Halten pausiert
      else if (ent.frames && ent.frames.length) heldEntity = ent;
      // anno-Hotspot (Szene 2): In-Szene-Diagramm ueber der echten Station
      else if (ent.def.anno) openAnno(ent);
      // Hotspot + normales Entity: Reader-Overlay (DESCENT-Textpanel)
      else openPanel(ent);
      return;
    }
  }
}

// Ziehen dreht die gegriffene Kugel nach links/rechts; Tempo merkt sie sich als Schwung
function mouseDragged() {
  if (heldEntity && heldEntity.isGlobe) {
    const ent = heldEntity;
    const k = 1.3 / Math.max(ent.radius, 1);
    const dYaw = (mouseX - pmouseX) * k;     // horizontal -> links/rechts
    const dPit = -(mouseY - pmouseY) * k;    // vertikal -> hoch/runter (invertiert = natuerliche Richtung)
    ent.spinAngle += dYaw;
    ent.tilt += dPit;
    const dtc = Math.max(deltaTime / 1000, 0.001);
    ent.spinVel = dYaw / dtc;                // Schwung fuers Loslassen (beide Achsen)
    ent.tiltVel = dPit / dtc;
  }
}

function mouseReleased() { heldEntity = null; }   // Loslassen -> Schwung, dann zurueck auf Normaltempo

// ===== Reader-Overlay (DESCENT-Textpanel): EINE Praesentation fuer alle Inhalte =====
// Klick auf einen Hotspot/ein Entity -> Szene dimmt ab, Titel + Text zentriert (optionales Bild
// darueber, optionaler Link darunter), "click to return" unten. Klick irgendwo oder ESC schliesst.
// Ersetzt das fruehere Seiten-Panel UND die Callout-Etiketten.
function openPanel(ent) {
  openEntity = ent;
  ent.visited = true;   // besuchte Hotspots werden gedimmt gezeichnet (DESCENT)
  if (ent.def.action === 'seaLevelRise') sectionSeaRiseActive = true;   // Meeresspiegel steigt (einmalig)
  const c = ent.def.content || {};
  document.getElementById('reader-title').textContent = c.title || ent.def.label || '';
  document.getElementById('reader-body').textContent = c.body || '';
  // Medienzone: explizites secondaryImage zuerst, dann die Hotspot-Grafiken aus
  // assets/images/hotspots/<id>1.png|webp, <id>2..., (asynchron nachgeladen)
  const media = document.getElementById('reader-media');
  media.innerHTML = '';
  if (c.secondaryImage) addReaderImage(media, c.secondaryImage);
  loadHotspotMedia(ent, media);
  const link = document.getElementById('reader-link');
  if (c.link && c.link.url) { link.href = c.link.url; link.textContent = c.link.label || 'more'; link.style.display = 'inline-block'; }
  else { link.style.display = 'none'; }
  document.getElementById('reader').classList.add('open');
  setDuck(true);
}

function closePanel() {
  openEntity = null;
  annoEntity = null;
  document.getElementById('reader').classList.remove('open');
  document.getElementById('anno').classList.remove('open');
  setDuck(false);
}

// =========================================================================
//  IN-SZENE-DIAGRAMME (Szene 2): 'anno'-Hotspots (hs_station/hs_wildlife/hs_living)
//  dimmen die Szene nur LEICHT — die ECHTE Station bleibt sichtbar und wird direkt
//  beschriftet (Linien/Labels als DOM-SVG in #anno, live an der Stein-Position
//  verankert). DOM statt Canvas: bleibt im SW-Modus ungefiltert -> Diagramm gold.
//  Kurztext (content.body) unten, eigene Bilder (hotspots/<id>N.png) darueber.
// =========================================================================
let annoEntity = null;
let annoBuilt = null;   // Zustand der letzten SVG-Erzeugung {x,y,r,w,h} -> Rebuild bei Resize

function annoStationEnt() { return allEntities.find(e => e.def.id === 'station' && e.def.scene === 'scene2'); }

function openAnno(ent) {
  openEntity = ent;
  annoEntity = ent;
  ent.visited = true;
  if (ent.def.action === 'seaLevelRise') sectionSeaRiseActive = true;   // hs_water: Anstieg starten
  document.getElementById('anno-caption').textContent = (ent.def.content && ent.def.content.body) || '';
  const media = document.getElementById('anno-media');
  media.innerHTML = '';
  loadHotspotMedia(ent, media);   // eigene Bilder (hs_station1.png, ...) erscheinen ueber dem Kurztext
  buildAnnoSVG();
  document.getElementById('anno').classList.add('open');
  setDuck(true);
}

// --- kleine SVG-String-Helfer (Farben: gold/dim/light wie im Rest des Looks) ---
const ANNO_GOLD = '#d8b25a', ANNO_DIM = '#9a937f', ANNO_LIGHT = '#e0dac8';
function aTxt(x, y, text, opts = {}) {
  const size = opts.size || 15, lines = Array.isArray(text) ? text : [text];
  const t = lines.map((ln, i) => `<tspan x="${x}" dy="${i === 0 ? 0 : size + 7}">${ln}</tspan>`).join('');
  return `<text x="${x}" y="${y}" fill="${opts.fill || ANNO_GOLD}" font-size="${size}" text-anchor="${opts.anchor || 'start'}" letter-spacing="2">${t}</text>`;
}
function aLine(x1, y1, x2, y2, opts = {}) {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${opts.stroke || 'rgba(154,147,127,0.6)'}" stroke-width="${opts.w || 1}"${opts.dash ? ` stroke-dasharray="${opts.dash}"` : ''}/>`;
}
function aDot(x, y, r, fill) { return `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>`; }
function aCircle(x, y, r, opts = {}) {
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${opts.stroke || ANNO_GOLD}" stroke-width="${opts.w || 1.2}"${opts.dash ? ` stroke-dasharray="${opts.dash}"` : ''}/>`;
}

// baut das Beschriftungs-SVG fuer das offene anno-Diagramm. Koordinaten werden relativ zum
// Anker-Feature der Szene in Pixel gebacken (Szene 2: Bimsstein · water: Wasserlinie ·
// atmosphere: Erd-Rand-Geometrie · sun: sunLayout); updateAnno() fuehrt die getrackte Gruppe
// (#anno-stone) pro Frame nach (Stein-Bob bzw. steigender Meeresspiegel).
// Labels links/rechts werden an den Bildschirmrand geklemmt (schmale Fenster).
function buildAnnoSVG() {
  const svg = document.getElementById('anno-svg');
  if (!annoEntity || !svg) return;
  const W = width, H = height, kind = annoEntity.def.anno;
  annoBuilt = { x: 0, y: 0, r: 0, wl: 0, w: W, h: H };
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', W);
  svg.setAttribute('height', H);
  const scr = [], stn = [];

  // ===== Szene-2-Familie: am Bimsstein verankert (Einheit = Stein-Radius, Ursprung = Mitte) =====
  if (kind === 'station' || kind === 'wildlife' || kind === 'living') {
  const st = annoStationEnt(); if (!st) return;
  const bx = st.pos.x, by = st.pos.y, r = st.radius;
  annoBuilt.x = bx; annoBuilt.y = by; annoBuilt.r = r;
  const X = u => Math.round(bx + u * r), Y = v => Math.round(by + v * r);
  const RX = u => Math.min(X(u), W - 340);   // rechte Label-Spalte (start-anchored) im Bild halten
  const LX = u => Math.max(X(u), 450);       // linke Label-Spalte (end-anchored) im Bild halten

  if (kind === 'station') {
    // Wasserlinie als Diagramm-Hilfslinie
    scr.push(aLine(24, WATERLINE_FRAC * H, W - 24, WATERLINE_FRAC * H, { dash: '10 8', stroke: 'rgba(154,147,127,0.35)' }));
    scr.push(aTxt(W - 26, WATERLINE_FRAC * H - 10, 'waterline', { anchor: 'end', fill: ANNO_DIM, size: 13 }));
    // Solar Space (Oeffnung oben am Stein)
    stn.push(aCircle(X(-0.08), Y(-0.82), r * 0.16));
    stn.push(aLine(X(0), Y(-1.22), X(-0.06), Y(-1.0)));
    stn.push(aTxt(X(0), Y(-1.34), ['solar space —', 'the only daylight room'], { anchor: 'middle', size: 16 }));
    // gefundene Raeume (Poren)
    stn.push(aCircle(X(-0.42), Y(-0.12), r * 0.10, { stroke: 'rgba(224,218,200,0.75)', w: 1 }));
    stn.push(aCircle(X(-0.22), Y(0.10), r * 0.07, { stroke: 'rgba(224,218,200,0.75)', w: 1 }));
    stn.push(aLine(LX(-1.32), Y(-0.18), X(-0.55), Y(-0.14)));
    stn.push(aTxt(LX(-1.32), Y(-0.24), ['rooms are found', 'in the stone’s cavities'], { anchor: 'end', fill: ANNO_LIGHT }));
    // lebendes Licht
    stn.push(aDot(X(0.34), Y(-0.30), 3, ANNO_GOLD));
    stn.push(aDot(X(0.45), Y(-0.22), 2.4, 'rgba(216,178,90,0.75)'));
    stn.push(aDot(X(0.55), Y(-0.32), 2.8, ANNO_GOLD));
    stn.push(aLine(RX(1.32), Y(-0.34), X(0.62), Y(-0.28)));
    stn.push(aTxt(RX(1.32), Y(-0.40), ['living light —', 'grown in the passages'], { anchor: 'start' }));
    // Ballast / Schwerpunkt tief
    stn.push(aCircle(X(0.12), Y(0.68), 7, { stroke: ANNO_LIGHT, w: 1.2 }));
    stn.push(aLine(X(0.12) - 7, Y(0.68), X(0.12) + 7, Y(0.68), { stroke: ANNO_LIGHT, w: 1.2 }));
    stn.push(aLine(X(0.12), Y(0.68) - 7, X(0.12), Y(0.68) + 7, { stroke: ANNO_LIGHT, w: 1.2 }));
    stn.push(aLine(RX(1.32), Y(0.52), X(0.42), Y(0.62)));
    stn.push(aTxt(RX(1.32), Y(0.46), ['ballast — the weight', 'sits deep'], { anchor: 'start', fill: ANNO_LIGHT }));
    // Atmen der Welt (Wellenlinie unten links)
    stn.push(`<path d="M ${LX(-1.32) - 220} ${Y(0.82)} q 14 -10 28 0 t 28 0 t 28 0" fill="none" stroke="rgba(154,147,127,0.7)" stroke-width="1.1"/>`);
    stn.push(aTxt(LX(-1.32), Y(0.62), ['currents groan through the hull —', '“the breathing of the world”'], { anchor: 'end', fill: ANNO_DIM }));
    // Drift (bild-relativ oben rechts an der Wasserlinie -> kollidiert nie mit dem Kurztext)
    scr.push(aTxt(W - 36, WATERLINE_FRAC * H + 54, 'slow drift — steered by sunlight', { anchor: 'end', size: 14 }));
    scr.push(aLine(W - 260, WATERLINE_FRAC * H + 74, W - 110, WATERLINE_FRAC * H + 74, { stroke: ANNO_GOLD, w: 1.2 }));
    scr.push(`<path d="M ${W - 110} ${WATERLINE_FRAC * H + 74} l -9 -5 v 10 Z" fill="${ANNO_GOLD}"/>`);
  }

  if (kind === 'wildlife') {
    // toedliche Oberflaeche + kalte Tiefe (bild-relativ)
    scr.push(aTxt(W / 2, H * 0.17, ['the surface is lethal —', 'light kills from above'], { anchor: 'middle', size: 16 }));
    scr.push(aLine(W * 0.38, H * 0.215, W * 0.38, H * 0.27, { stroke: ANNO_GOLD }));
    scr.push(`<path d="M ${W * 0.38} ${H * 0.27} l -5 -8 h 10 Z" fill="${ANNO_GOLD}"/>`);
    scr.push(aLine(W * 0.62, H * 0.215, W * 0.62, H * 0.27, { stroke: ANNO_GOLD }));
    scr.push(`<path d="M ${W * 0.62} ${H * 0.27} l -5 -8 h 10 Z" fill="${ANNO_GOLD}"/>`);
    scr.push(aTxt(W - 36, H * 0.77, 'the cold deep — near-empty', { anchor: 'end', fill: ANNO_DIM }));
    // Krill (Basis des Nahrungsnetzes) im freien Wasser links
    scr.push(aTxt(Math.max(W * 0.10, 320), H * 0.46, ['krill —', 'anchor of the food web'], { anchor: 'end', fill: ANNO_LIGHT }));
    stn.push(aLine(Math.max(W * 0.10, 320) + 10, H * 0.46, X(-1.35), Y(-0.05)));
    // Reef-Effekt: Ring um den Stein
    stn.push(`<ellipse cx="${X(0)}" cy="${Y(0)}" rx="${r * 1.30}" ry="${r * 1.22}" fill="none" stroke="rgba(216,178,90,0.55)" stroke-width="1.2" stroke-dasharray="9 8"/>`);
    stn.push(aLine(RX(1.55), Y(-0.62), X(1.12), Y(-0.52)));
    stn.push(aTxt(RX(1.55), Y(-0.68), ['life gathers at the station —', 'a drifting reef'], { anchor: 'start', fill: ANNO_LIGHT }));
    // Sea Devils
    stn.push(aLine(RX(1.45), Y(0.42), X(1.05), Y(0.35)));
    stn.push(aTxt(RX(1.45), Y(0.36), ['sea devils — their glow', 'becomes the people’s light'], { anchor: 'start' }));
  }

  if (kind === 'living') {
    // Raeume + Verzurrung (links)
    stn.push(aCircle(X(-0.40), Y(-0.22), r * 0.10, { stroke: 'rgba(224,218,200,0.75)', w: 1 }));
    stn.push(aLine(LX(-1.30), Y(-0.28), X(-0.52), Y(-0.24)));
    stn.push(aTxt(LX(-1.30), Y(-0.34), 'rooms are found, not built', { anchor: 'end', fill: ANNO_LIGHT }));
    stn.push(aLine(LX(-1.30), Y(0.28), X(-0.55), Y(0.32)));
    stn.push(aTxt(LX(-1.30), Y(0.22), ['everything is tied down —', 'or it belongs to the sea'], { anchor: 'end', fill: ANNO_DIM }));
    // gewachsenes Licht (rechts)
    stn.push(aDot(X(0.36), Y(-0.12), 3, ANNO_GOLD));
    stn.push(aDot(X(0.48), Y(-0.05), 2.4, 'rgba(216,178,90,0.75)'));
    stn.push(aDot(X(0.58), Y(-0.15), 2.8, ANNO_GOLD));
    stn.push(aLine(RX(1.30), Y(-0.16), X(0.65), Y(-0.10)));
    stn.push(aTxt(RX(1.30), Y(-0.22), ['the light is grown', 'on the walls'], { anchor: 'start' }));
    // Sway: Roll-Boegen ueber dem Stein + Schwerpunkt
    stn.push(`<path d="M ${X(-0.95)} ${Y(-1.05)} A ${r} ${r} 0 0 1 ${X(-0.55)} ${Y(-1.28)}" fill="none" stroke="rgba(154,147,127,0.7)" stroke-width="1.1"/>`);
    stn.push(`<path d="M ${X(0.55)} ${Y(-1.28)} A ${r} ${r} 0 0 1 ${X(0.95)} ${Y(-1.05)}" fill="none" stroke="rgba(154,147,127,0.7)" stroke-width="1.1"/>`);
    stn.push(aCircle(X(0.05), Y(0.70), 7, { stroke: ANNO_LIGHT, w: 1.2 }));
    stn.push(aLine(X(0.05) - 7, Y(0.70), X(0.05) + 7, Y(0.70), { stroke: ANNO_LIGHT, w: 1.2 }));
    stn.push(aLine(X(0.05), Y(0.70) - 7, X(0.05), Y(0.70) + 7, { stroke: ANNO_LIGHT, w: 1.2 }));
    stn.push(aLine(RX(1.30), Y(0.56), X(0.35), Y(0.66)));
    stn.push(aTxt(RX(1.30), Y(0.50), ['ballast low — the roll', 'stays slow and shallow'], { anchor: 'start', fill: ANNO_LIGHT }));
    // (die vier Sinne stehen im Kurztext unten — kein eigenes Label, sonst kollidiert es dort)
  }
  }   // Ende Szene-2-Familie

  // ===== ATMOSPHERE: beschriftet die ECHTEN Schicht-Boegen (gleiche Geometrie wie drawAtmosphere:
  //       Kugelmittelpunkt weit unter dem Bild; Punkt auf Bogen rf bei horizontalem Offset ox) =====
  if (kind === 'atmosphere') {
    const rr = W / (2 * ATMO_CAP_HALFW), cx = W * 0.5, cyG = ATMO_LIMB * H + rr;
    const P = (rf, ox) => ({ x: cx + ox * W, y: cyG - Math.sqrt(Math.max(0, (rr * rf) * (rr * rf) - (ox * W) * (ox * W))) });
    // Magnetfeld (fliessende Linien, links oben)
    const pm = P(1.20, -0.22);
    scr.push(aDot(pm.x, pm.y, 3.5, ANNO_LIGHT));
    scr.push(aLine(Math.max(W * 0.06, 24) + 140, H * 0.10 + 40, pm.x, pm.y - 8));
    scr.push(aTxt(Math.max(W * 0.06, 24), H * 0.10, ['magnetic field — weakened,', 'solar storms break through'], { fill: ANNO_LIGHT }));
    // Ozon (gestrichelter Bogen, oben Mitte)
    const po = P(1.075, 0.06);
    scr.push(aDot(po.x, po.y, 3.5, ANNO_GOLD));
    scr.push(aLine(Math.min(W * 0.62, W - 320) + 40, H * 0.22 + 28, po.x + 4, po.y - 8));
    scr.push(aTxt(Math.min(W * 0.62, W - 320), H * 0.22, ['ozone layer —', 'torn open'], { fill: ANNO_GOLD }));
    // Smog (warmer Saum direkt am Erd-Rand, rechts)
    const ps = P(1.02, 0.30);
    scr.push(aDot(ps.x, ps.y, 3.5, ANNO_GOLD));
    scr.push(aLine(W - 240, H * 0.48 + 26, ps.x, ps.y - 8));
    scr.push(aTxt(W - 36, H * 0.48, ['photochemical smog — never lifts,', 'it makes the gold light'], { anchor: 'end', fill: ANNO_GOLD }));
  }

  // ===== WATER: Labels an der (steigenden) Wasserlinie — die getrackte Gruppe wandert mit dem
  //       Meeresspiegel nach oben ins Bild (updateAnno); Berg/Tiefe bild-relativ =====
  if (kind === 'water') {
    const wl = SECTION_OLD_SEA_Y + (SECTION_NEW_SEA_Y - SECTION_OLD_SEA_Y) * sectionSeaRise;
    annoBuilt.wl = wl;
    const wy = wl * H;
    stn.push(aLine(24, wy, W - 24, wy, { dash: '10 8', stroke: 'rgba(216,178,90,0.45)' }));
    stn.push(aTxt(W - 36, wy - 46, ['the sea climbed —', 'the old coast lies far below'], { anchor: 'end', fill: ANNO_LIGHT }));
    stn.push(aTxt(W - 36, wy + 66, ['the living band —', 'warmed above, shielded from the light'], { anchor: 'end', fill: ANNO_GOLD }));
    scr.push(aTxt(Math.max(W * 0.10, 340), H * 0.36, ['the drowned land —', 'where life once held on'], { anchor: 'end', fill: ANNO_LIGHT }));
    scr.push(aLine(Math.max(W * 0.10, 340) - 60, H * 0.36 + 34, W * 0.31, H * 0.66));   // -> Berggipfel
    scr.push(aTxt(W - 36, H * 0.80, 'the cold deep — dark and near-empty', { anchor: 'end', fill: ANNO_DIM }));
  }

  // ===== SUN: beschriftet die grosse Sonnenscheibe (gleiche Geometrie wie drawVizSun: sunLayout) =====
  if (kind === 'sun') {
    const s = sunLayout(), cx = s.cx, cy = s.cy, r = s.r;
    // die toedliche Quelle (Scheibe, oben links)
    scr.push(aLine(Math.max(cx - r * 1.5, 40) + 130, cy - r * 1.42 + 30, cx - r * 0.60, cy - r * 0.74));
    scr.push(aTxt(Math.max(cx - r * 1.5, 40), cy - r * 1.46, ['the lethal source —', 'filtered to a faint gold'], { fill: ANNO_LIGHT }));
    // der Motor (Korona/Hitze, rechts oben)
    scr.push(aLine(Math.min(cx + r * 1.35, W - 340), cy - r * 0.66, cx + r * 0.98, cy - r * 0.50));
    scr.push(aTxt(Math.min(cx + r * 1.35, W - 340), cy - r * 0.76, ['the engine — her heat turns', 'the whole water column'], { fill: ANNO_GOLD }));
    // Sonnenstuerme (CME-Bogen, rechts unter dem Motor-Label — NICHT tiefer, sonst Kurztext-Kollision)
    scr.push(aLine(Math.min(cx + r * 1.35, W - 340), cy + r * 0.70, cx + r * 0.72, cy + r * 0.95));
    scr.push(aTxt(Math.min(cx + r * 1.35, W - 340), cy + r * 0.60, ['solar storms — each burst', 'reaches the surface unshielded'], { fill: ANNO_LIGHT }));
  }

  svg.innerHTML = `<g>${scr.join('')}</g><g id="anno-stone">${stn.join('')}</g>`;
}

// pro Frame: getrackte Gruppe nachfuehren — Szene 2: Bob des Steins · water: steigender
// Meeresspiegel · atmosphere/sun: statisch (nur Resize-Rebuild).
function updateAnno() {
  if (!annoEntity || !annoBuilt) return;
  if (Math.abs(width - annoBuilt.w) > 1 || Math.abs(height - annoBuilt.h) > 1) { buildAnnoSVG(); return; }
  const kind = annoEntity.def.anno;
  const g = document.getElementById('anno-stone');
  if (!g) return;
  if (kind === 'station' || kind === 'wildlife' || kind === 'living') {
    const st = annoStationEnt(); if (!st) return;
    if (Math.abs(st.radius - annoBuilt.r) > 1) { buildAnnoSVG(); return; }
    g.setAttribute('transform', `translate(${(st.pos.x - annoBuilt.x).toFixed(1)},${(st.pos.y - annoBuilt.y).toFixed(1)})`);
  } else if (kind === 'water') {
    const wl = SECTION_OLD_SEA_Y + (SECTION_NEW_SEA_Y - SECTION_OLD_SEA_Y) * sectionSeaRise;
    g.setAttribute('transform', `translate(0,${((wl - annoBuilt.wl) * height).toFixed(1)})`);
  }
}

// ===== Hotspot-Grafiken fuer den Reader =====
// Konvention wie bei den Entity-Varianten, nur FLACH in einem Ordner: pro Hotspot
// assets/images/hotspots/<hotspot-id>1.png (oder .webp), weitere <id>2, <id>3 ... —
// die erste Luecke beendet die Reihe. Wird bei JEDEM Oeffnen frisch geprobt, d.h. eine neu
// abgelegte Datei erscheint ohne Reload. DOM-<img> (kein p5-loadImage noetig).
function addReaderImage(container, src) {
  const im = document.createElement('img');
  im.src = src; im.alt = '';
  container.appendChild(im);
}
async function loadHotspotMedia(ent, container) {
  const base = 'assets/images/hotspots/' + ent.def.id;
  for (let i = 1; i <= 9; i++) {
    let src = null;
    if (await probeImage(base + i + '.webp')) src = base + i + '.webp';        // WebP bevorzugt
    else if (await probeImage(base + i + '.png')) src = base + i + '.png';     // PNG-Fallback
    else if (await probeImage(base + i + '.svg')) src = base + i + '.svg';     // SVG (Diagramme)
    else break;                                                                 // Luecke -> Ende
    if (openEntity !== ent) return;   // Reader wurde inzwischen geschlossen/neu befuellt
    addReaderImage(container, src);
  }
}
function probeImage(url) {
  return new Promise(res => {
    const im = new Image();
    im.onload = () => res(true);
    im.onerror = () => res(false);
    im.src = url;
  });
}

// =========================================================================
//  SZENEN-NAVIGATION
// =========================================================================
function goToScene(index) {
  if (index === currentScene || nextScene >= 0) return;
  if (index < 0 || index >= scenes.length) return;
  if (openEntity) closePanel();        // offenes Reader-Overlay nicht in die naechste Szene mitnehmen
  // Station-Zoom 2<->3 (fixes Ziel = Stationskuppel)
  const isSeaInterior = (currentScene === zoomSeaIndex && index === zoomInteriorIndex) ||
                        (currentScene === zoomInteriorIndex && index === zoomSeaIndex);
  // Viz-Zoom: Elternszene <-> Viz-Unterszene (Pivot = Elternszene, Ziel = angeklickter Marker-Punkt).
  // Deckt Szene 1 -> atmosphere/water/sun UND Szene 2 -> station/living/wildlife ab (VIZ_MENU).
  const curId = scenes[currentScene] && scenes[currentScene].id;
  const tgtId = scenes[index] && scenes[index].id;
  const vizIn  = VIZ_MENU.find(v => v.id === tgtId && v.parent === curId);   // rein in die Unterszene
  const vizOut = VIZ_MENU.find(v => v.id === curId && v.parent === tgtId);   // zurueck zur Elternszene
  if (isSeaInterior) {
    zoomTransition = true; zoomProgress = 0;
    zoomDirection = (index === zoomInteriorIndex) ? 1 : -1;
    zoomPivotIndex = zoomSeaIndex;
    zoomTargetX = ZOOM_TARGET_X; zoomTargetY = ZOOM_TARGET_Y; zoomMaxScale = ZOOM_MAX_SCALE;
  } else if (vizIn || vizOut) {
    const v = vizIn || vizOut;
    zoomTransition = true; zoomProgress = 0;
    zoomDirection = vizIn ? 1 : -1;                    // rein = +1, raus (zur Elternszene) = -1
    zoomPivotIndex = sceneIndexById(v.parent);
    zoomMaxScale = SECTION_ZOOM_SCALE;
    if (vizIn) {
      const p = vizMarkerPos(v);                       // Ziel = Position des angeklickten Markers
      if (p) { zoomTargetX = p.x / width; zoomTargetY = p.y / height; }
      if (v.id === WATER_ID) { sectionSeaRise = 0; sectionSeaRiseActive = false; }   // Wasser startet trocken
      if (v.id === ATMO_ID) {                          // Atmosphaere: Drehphase vom Globus uebernehmen ->
        const g = allEntities.find(e => e.isGlobe);    // kein Laengen-Sprung + gleiche Richtung -> echter Zoom
        if (g) atmoSpin = g.spinAngle;
      }
    }
    // Zoom-out: zoomTargetX/Y bleiben, wo der Punkt war
  }
  nextScene = index;
  sceneFade = 0;
  updateDots(index);
  updateSceneName(index);
  if (started) playSceneAudio(index, 3);
}

// sichtbare (nav-bare) Szenen-Indizes; noNav-Szenen (z.B. der Schnitt) sind ausgenommen
function navSceneIndices() {
  const out = [];
  scenes.forEach((s, i) => { if (!s.noNav) out.push(i); });
  return out;
}
// naechste/vorherige SICHTBARE Szene (Pfeile/Tasten). -1, wenn die aktuelle Szene nicht nav-bar ist.
function navStep(dir) {
  const vis = navSceneIndices();
  const pos = vis.indexOf(currentScene);
  if (pos < 0) return -1;   // z.B. im Schnitt: Pfeile ignorieren (Ausstieg nur ueber Randmarker)
  return vis[(pos + dir + vis.length) % vis.length];
}

// Szenen-Menue oben links (DESCENT): "i · the earth" usw. statt Punkte-Navigation.
// noNav-Szenen (Viz-Unterszenen) tauchen nicht auf; Pfeiltasten navigieren weiter.
function buildNav() {
  const menu = document.getElementById('scene-menu');
  menu.innerHTML = '';
  const roman = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii'];
  let n = 0;
  scenes.forEach((sc, i) => {
    if (sc.noNav) return;   // Viz-Unterszenen o.ae.: kein Menue-Eintrag
    const b = document.createElement('button');
    b.className = 'scene-btn' + (i === currentScene ? ' active' : '');
    b.textContent = (roman[n++] || '·') + ' · ' + (sc.name || '');
    b.dataset.scene = i;
    b.addEventListener('click', () => goToScene(i));
    menu.appendChild(b);
  });
  document.getElementById('reader').addEventListener('click', closePanel);   // Klick irgendwo schliesst
  document.getElementById('anno').addEventListener('click', closePanel);     // ebenso das In-Szene-Diagramm
  updateSceneName();
}

function updateDots(index) {
  document.querySelectorAll('#scene-menu .scene-btn').forEach(d => d.classList.toggle('active', +d.dataset.scene === index));
}
function updateSceneName(index = currentScene) {
  const sc = scenes[index];
  if (sc) document.getElementById('scene-name').textContent = sc.name || '';
}

function keyPressed() {
  if (keyCode === ESCAPE && openEntity) closePanel();
  else if (key === 'p' || key === 'P') PERF_HUD = !PERF_HUD;   // FPS-HUD ein/aus
  else if (key === 's' || key === 'S') toggleBW();             // Schwarz-Weiss ein/aus
  else if (keyCode === LEFT_ARROW) goToScene(navStep(-1));
  else if (keyCode === RIGHT_ARROW) goToScene(navStep(1));
}

// Schwarz-Weiss-Modus: Klasse auf <body> spiegeln -> CSS-Graustufenfilter (index.html).
function applyBW() {
  if (document.body) document.body.classList.toggle('bw', bwMode);
}
function toggleBW() { bwMode = !bwMode; applyBW(); }

function windowResized() {
  pixelDensity(chooseDensity());   // Budget bei Groessenwechsel neu bewerten (vor resizeCanvas)
  resizeCanvas(vw(), vh());
  if (spaceResizeTimer) clearTimeout(spaceResizeTimer);
  spaceResizeTimer = setTimeout(() => {
    buildSpace();              // gecachten Weltraum-Backdrop neu bauen (entprellt)
    if (underwaterBuf) { underwaterBuf.remove(); underwaterBuf = null; }   // Unterwasser-Buffer verwerfen -> drawUnderwater baut ihn in neuer Groesse neu
    if (waterBuf) { waterBuf.remove(); waterBuf = null; waterShader = null; }  // Wasser-Shader-Buffer in neuer Groesse neu bauen
    if (solarBuf) { solarBuf.remove(); solarBuf = null; solarShader = null; }  // Solar-Shader-Buffer (Scene 3) neu bauen
    if (solarStaticBuf) { solarStaticBuf.remove(); solarStaticBuf = null; }    // gecachten 2D-Fallback verwerfen
  }, 180);
}
