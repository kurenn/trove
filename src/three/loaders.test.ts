import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { hasGeometry } from "./loaders";

describe("hasGeometry", () => {
  it("is false for an empty scene — what a sliced print job parses to", () => {
    expect(hasGeometry(new THREE.Group())).toBe(false);
    const g = new THREE.Group();
    g.add(new THREE.Group(), new THREE.Mesh(new THREE.BufferGeometry()));
    expect(hasGeometry(g)).toBe(false); // a mesh with no vertices is still nothing to show
  });
  it("is true once any mesh in the tree has vertices", () => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    const g = new THREE.Group();
    const inner = new THREE.Group();
    inner.add(new THREE.Mesh(geo));
    g.add(inner);
    expect(hasGeometry(g)).toBe(true);
  });
});
