import * as THREE from "three";

type Pixel = (x: number, y: number, size: number) => [number, number, number];

function texture(size: number, pixel: Pixel, repeat: [number, number]) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    const [r, g, b] = pixel(x, y, size);
    const i = (y * size + x) * 4;
    data.set([r, g, b, 255], i);
  }
  const map = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(...repeat);
  map.magFilter = size <= 16 ? THREE.NearestFilter : THREE.LinearFilter;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.anisotropy = 4;
  map.needsUpdate = true;
  return map;
}

const hash = (x: number, y: number) => ((x * 37 + y * 57 + x * y * 11) % 29) / 29;

export function createDryGrassMap() {
  return texture(64, (x, y, s) => {
    const hatch = (x + y * 2) % 23 < 1;
    const track = Math.abs((y / s) * 12 - Math.round((y / s) * 12)) < 0.018;
    return track ? [104, 143, 130] : hatch ? [107, 146, 131] : [120, 158, 138];
  }, [24, 24]);
}

export function createAsphaltMap() {
  return texture(64, (x, y, s) => {
    const seam = x % 31 === 0 || y % 31 === 0;
    const tire = Math.abs(y - s / 2) < 3 || Math.abs(y - s / 2) > s / 2 - 4;
    const hatch = (x * 2 + y) % 17 < 2;
    return seam ? [87, 96, 109] : tire ? [105, 115, 125] : hatch ? [118, 127, 139] : [130, 139, 147];
  }, [9, 2]);
}

export function createWornCheckerMap() {
  return texture(96, (x, y) => {
    const cell = Math.floor(x / 24) + Math.floor(y / 24);
    const pale = cell % 2 === 0;
    const n = hash(x, y) * 15;
    const grout = x % 24 < 2 || y % 24 < 2;
    if (grout) return [38, 35, 43];
    const scuff = (x * 3 + y * 7) % 43 < 2;
    return pale ? [202 - n - (scuff ? 24 : 0), 190 - n, 164 - n] : [31 + n, 38 + n, 55 + n];
  }, [5.5, 4.5]);
}

export function createBrushedMetalMap() {
  return texture(64, (x, y) => {
    const n = hash(x, y) * 24;
    const line = y % 9 === 0 ? -18 : 0;
    return [73 + n + line, 93 + n + line, 96 + n + line];
  }, [3, 3]);
}

/**
 * Three hard bands (shade / mid / lit), the BotW-style count that keeps
 * forms readable at speed. The shade floor stays high because the ambient
 * and hemisphere fill carry the cool shadow hue.
 */
export function createCelGradientMap() {
  const data = new Uint8Array([
    70, 70, 70, 255,
    160, 160, 160, 255,
    160, 160, 160, 255,
    255, 255, 255, 255,
  ]);
  const map = new THREE.DataTexture(data, 4, 1, THREE.RGBAFormat);
  // Toon irradiance samples the red channel as non-color light intensity.
  map.colorSpace = THREE.NoColorSpace;
  map.magFilter = THREE.NearestFilter;
  map.minFilter = THREE.NearestFilter;
  map.needsUpdate = true;
  return map;
}

/** Corrugated container steel: stepped ribs read as panels at FPV speed. */
export function createCorrugatedMap() {
  return texture(64, (x, y) => {
    const rib = x % 8;
    const shade = rib < 2 ? 206 : rib < 5 ? 255 : 228;
    const rust = (x * 13 + y * 7) % 97 < 2 ? -40 : 0;
    const v = shade + rust;
    return [v, v, v];
  }, [5, 1]);
}

/** Diagonal hazard chevrons for crane and gate bases. */
export function createHazardMap() {
  return texture(64, (x, y) => ((x + y) % 32 < 16 ? [240, 190, 72] : [44, 38, 52]), [1, 1]);
}

/** Horizontal sandstone strata: uneven bands with a sun-bleached lip. */
export function createStrataMap() {
  const bands = [0, 9, 14, 27, 33, 44, 52, 64];
  const tones: [number, number, number][] = [[255, 236, 218], [232, 206, 190], [250, 224, 204], [222, 196, 182], [246, 230, 210], [230, 200, 186], [255, 240, 224]];
  return texture(64, (_x, y) => {
    const band = bands.findIndex((edge, i) => y >= edge && y < bands[i + 1]);
    const lip = y - bands[band] < 1;
    return lip ? [255, 252, 240] : tones[band];
  }, [1, 1]);
}

/** Solar panel cells: navy squares, pale grid. */
export function createSolarMap() {
  return texture(64, (x, y) => (x % 16 < 1 || y % 16 < 1 ? [196, 214, 226] : [38 + (y % 16) * 2, 62 + (y % 16) * 2, 118 + (y % 16) * 3]), [4, 2]);
}

/** Lit window strip: warm glass panes separated by mullions. */
export function createWindowMap() {
  return texture(64, (x, y) => {
    const mullion = x % 16 < 2 || y < 3 || y > 60;
    const glint = (x % 16) + (y >> 3) === 9;
    return mullion ? [52, 58, 74] : glint ? [255, 250, 226] : [255, 214 - (y >> 1), 150 - (y >> 1)];
  }, [4, 1]);
}

/** Airfield obstruction checker crown for the water tower box (top of each face). */
export function createTowerMap() {
  return texture(16, (x, y) => {
    const crown = y >= 10 && y < 14;
    const checker = (Math.floor(x / 4) + Math.floor((y - 10) / 2)) % 2 === 0;
    return crown && checker ? [230, 90, 71] : [255, 255, 255];
  }, [1, 1]);
}
