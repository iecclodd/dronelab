import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { HIDDEN_LAYER, updateVisibility, visibility } from "../apps/web/src/visibility";

describe("visibility culling", () => {
  it("hides objects behind occluders (after hysteresis) and keeps visible ones on the main layer", () => {
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000);
    camera.position.set(0, 2, 0);
    camera.lookAt(0, 2, -100);
    camera.updateMatrixWorld();
    const hiddenObject = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
    const openObject = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
    const behindObject = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
    const behind = visibility.register({ object: behindObject, center: new THREE.Vector3(0, 2, 90), radius: 1.5 });
    const occluded = visibility.register({ object: hiddenObject, center: new THREE.Vector3(0, 2, -70), radius: 1.5 });
    const open = visibility.register({ object: openObject, center: new THREE.Vector3(25, 2, -70), radius: 1.5 });
    updateVisibility(camera, 0);
    expect(occluded.visible).toBe(true); // nothing in the way yet
    // A tower slides in between the camera and the far box.
    visibility.setOccluders([new THREE.Box3(new THREE.Vector3(-10, 0, -40), new THREE.Vector3(10, 60, -30))]);
    updateVisibility(camera, 0.1);
    expect(occluded.visible).toBe(true); // still within the show hysteresis
    updateVisibility(camera, 1);
    expect(occluded.visible).toBe(false);
    expect(hiddenObject.layers.mask).toBe(1 << HIDDEN_LAYER);
    expect(open.visible).toBe(true);
    expect(openObject.layers.test(camera.layers)).toBe(true);
    expect(behind.visible).toBe(false); // outside the frustum
    [behind, occluded, open].forEach((c) => visibility.unregister(c));
    expect(hiddenObject.layers.test(camera.layers)).toBe(true);
    visibility.clearOccluders();
  });
});
