/* geometries.ts — procedural mesh builders (Phase 1 stand-ins).
   In Phase 3, buildObject() gains a path branch that loads a real mesh file;
   the procedural builders remain as the fallback / thumbnail placeholders. */

import * as THREE from "three";
import type { GeometryKey } from "../data/types";

function vaseGeo(): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const y = t * 2.0 - 1.0;
    const r = 0.55 + 0.45 * Math.sin(t * Math.PI * 0.92 + 0.3) - 0.12 * t;
    pts.push(new THREE.Vector2(Math.max(0.08, r), y));
  }
  return new THREE.LatheGeometry(pts, 14);
}

function gearGeo(): THREE.BufferGeometry {
  const teeth = 12, rOuter = 1, rInner = 0.78, rHole = 0.32;
  const shape = new THREE.Shape();
  for (let i = 0; i <= teeth; i++) {
    const a0 = (i / teeth) * Math.PI * 2;
    const a1 = ((i + 0.5) / teeth) * Math.PI * 2;
    const a2 = ((i + 1) / teeth) * Math.PI * 2;
    const p = (a: number, r: number): [number, number] => [Math.cos(a) * r, Math.sin(a) * r];
    if (i === 0) shape.moveTo(...p(a0, rInner));
    shape.lineTo(...p(a0 + 0.06, rOuter));
    shape.lineTo(...p(a1 - 0.06, rOuter));
    shape.lineTo(...p(a1, rInner));
    shape.lineTo(...p(a2, rInner));
  }
  const hole = new THREE.Path();
  hole.absarc(0, 0, rHole, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.42, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 1 });
  g.center();
  return g;
}

const d20Geo = () => new THREE.IcosahedronGeometry(1, 0);
const cubeGeo = () => new THREE.BoxGeometry(1.3, 1.3, 1.3, 1, 1, 1);
const torusKnotGeo = () => new THREE.TorusKnotGeometry(0.62, 0.24, 120, 12, 2, 3);

function bracketGeo(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-0.9, -0.9); s.lineTo(0.9, -0.9); s.lineTo(0.9, -0.5);
  s.lineTo(-0.4, -0.5); s.lineTo(-0.4, 0.9); s.lineTo(-0.9, 0.9); s.lineTo(-0.9, -0.9);
  const h1 = new THREE.Path(); h1.absarc(0.45, -0.7, 0.13, 0, Math.PI * 2, true); s.holes.push(h1);
  const h2 = new THREE.Path(); h2.absarc(-0.65, 0.5, 0.13, 0, Math.PI * 2, true); s.holes.push(h2);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.5, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 1 });
  g.center();
  return g;
}

function figurineGroup(mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const m = (geo: THREE.BufferGeometry, x: number, y: number, z: number, s = 1) => {
    const mesh = new THREE.Mesh(geo, mat); mesh.position.set(x, y, z);
    if (s !== 1) mesh.scale.setScalar(s); g.add(mesh); return mesh;
  };
  const body = m(new THREE.IcosahedronGeometry(0.62, 0), 0, 0, 0); body.scale.set(1.15, 0.92, 1.5);
  m(new THREE.IcosahedronGeometry(0.42, 0), 0, 0.42, 0.78);
  const ear = (x: number) => { const e = m(new THREE.ConeGeometry(0.16, 0.34, 4), x, 0.78, 0.82); e.rotation.z = x * 0.2; };
  ear(-0.18); ear(0.18);
  m(new THREE.ConeGeometry(0.12, 0.4, 4), 0, 0.05, -0.95).rotation.x = -0.7;
  const leg = (x: number, z: number) => m(new THREE.CylinderGeometry(0.1, 0.08, 0.5, 5), x, -0.55, z);
  leg(-0.3, 0.4); leg(0.3, 0.4); leg(-0.3, -0.35); leg(0.3, -0.35);
  return g;
}

function flexiGroup(mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const N = 11;
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const r = 0.42 * (1 - t * 0.72) + 0.06;
    const seg = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), mat);
    seg.position.set((t - 0.42) * 2.6, Math.sin(t * Math.PI * 1.8) * 0.45, 0);
    seg.scale.z = 0.6;
    g.add(seg);
  }
  const fin = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.5, 4), mat);
  fin.position.set(-1.25, 0, 0); fin.rotation.z = Math.PI / 2; fin.scale.z = 0.2;
  g.add(fin);
  return g;
}

function boxGroup(mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const wall = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z); g.add(mesh);
  };
  wall(1.8, 0.16, 1.2, 0, -0.5, 0);
  wall(1.8, 0.7, 0.12, 0, -0.15, 0.56);
  wall(1.8, 0.7, 0.12, 0, -0.15, -0.56);
  wall(0.12, 0.7, 1.2, 0.88, -0.15, 0);
  wall(0.12, 0.7, 1.2, -0.88, -0.15, 0);
  wall(0.78, 0.7, 0.12, -0.2, -0.15, 0);
  return g;
}

const isFlat = (key: GeometryKey) => key !== "torusknot";

export function makeMaterial(color: string, flat: boolean): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.64, metalness: 0.02, flatShading: flat });
}

/** Build a normalized object (centered, fit to ~radius 1.15) for a geometry key. */
export function buildObject(key: GeometryKey, color: string, material?: THREE.Material): THREE.Group {
  // flat already encodes `key !== "torusknot"` (the only smooth-shaded key).
  const flat = isFlat(key);
  const mat = material || makeMaterial(color, flat);
  let obj: THREE.Object3D;
  switch (key) {
    case "vase": obj = new THREE.Mesh(vaseGeo(), mat); break;
    case "gear": obj = new THREE.Mesh(gearGeo(), mat); break;
    case "d20": obj = new THREE.Mesh(d20Geo(), mat); break;
    case "cube": obj = new THREE.Mesh(cubeGeo(), mat); break;
    case "torusknot": obj = new THREE.Mesh(torusKnotGeo(), mat); break;
    case "bracket": obj = new THREE.Mesh(bracketGeo(), mat); break;
    case "figurine": obj = figurineGroup(mat); break;
    case "flexi": obj = flexiGroup(mat); break;
    case "box": obj = boxGroup(mat); break;
    default: obj = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), mat);
  }
  if ((obj as THREE.Mesh).isMesh) (obj as THREE.Mesh).geometry.computeVertexNormals();
  const wrap = new THREE.Group();
  wrap.add(obj);
  const box = new THREE.Box3().setFromObject(wrap);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxd = Math.max(size.x, size.y, size.z) || 1;
  obj.position.sub(center);
  wrap.scale.setScalar(2.0 / maxd);
  wrap.userData.dims = size;
  return wrap;
}
