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
  map.magFilter = THREE.LinearFilter;
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

/** Four deliberately stepped shades shared by every world MeshToonMaterial. */
export function createCelGradientMap() {
  const data = new Uint8Array([
    44, 44, 44, 255,
    98, 98, 98, 255,
    172, 172, 172, 255,
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
