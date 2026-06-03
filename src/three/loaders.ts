/* loaders.ts — load real mesh files (STL / OBJ / 3MF / STEP) into a normalized
   THREE.Group. Bytes come from a URL (dev/browser) or a Tauri asset URL
   (convertFileSrc) so large binaries stream through the webview, not JSON IPC. */

import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { ThreeMFLoader } from "three/examples/jsm/loaders/3MFLoader.js";
import { makeMaterial } from "./geometries";

export interface MeshSrc {
  /** http(s) URL (dev) or Tauri asset URL. */
  url: string;
  ext: string; // stl | obj | 3mf | step
}

/** Center an object at the origin and fit it to ~radius 1.15 (matches buildObject). */
export function normalize(obj: THREE.Object3D): THREE.Group {
  const wrap = new THREE.Group();
  wrap.add(obj);
  const box = new THREE.Box3().setFromObject(wrap);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxd = Math.max(size.x, size.y, size.z) || 1;
  obj.position.sub(center);
  wrap.scale.setScalar(2.0 / maxd);
  wrap.userData.dims = size; // raw mm-ish bounds for the measure/dims UI
  return wrap;
}

function applyMaterial(obj: THREE.Object3D, color: string) {
  const mat = makeMaterial(color, false);
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.material = mat;
      if (mesh.geometry && !mesh.geometry.getAttribute("normal")) mesh.geometry.computeVertexNormals();
    }
  });
}

async function fetchBuffer(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
  return res.arrayBuffer();
}

async function loadStep(buf: ArrayBuffer, color: string): Promise<THREE.Group> {
  // occt-import-js is heavy WASM — only loaded when a STEP file is opened.
  const mod = await import("occt-import-js");
  const occt = await (mod.default as unknown as () => Promise<any>)();
  const result = occt.ReadStepFile(new Uint8Array(buf), null);
  if (!result?.success || !result.meshes?.length) throw new Error("STEP parse failed");
  const group = new THREE.Group();
  for (const m of result.meshes) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(m.attributes.position.array, 3));
    if (m.attributes.normal) geo.setAttribute("normal", new THREE.Float32BufferAttribute(m.attributes.normal.array, 3));
    if (m.index) geo.setIndex(new THREE.Uint32BufferAttribute(m.index.array, 1));
    group.add(new THREE.Mesh(geo, makeMaterial(color, false)));
  }
  return group;
}

/** Load a mesh file → normalized Group. Throws on parse failure (caller falls back). */
export async function loadMesh(src: MeshSrc, color: string): Promise<THREE.Group> {
  const ext = src.ext.toLowerCase();
  let obj: THREE.Object3D;
  if (ext === "stl") {
    const buf = await fetchBuffer(src.url);
    const geo = new STLLoader().parse(buf);
    geo.computeVertexNormals();
    obj = new THREE.Mesh(geo, makeMaterial(color, false));
  } else if (ext === "obj") {
    const text = await (await fetch(src.url)).text();
    obj = new OBJLoader().parse(text);
    applyMaterial(obj, color);
  } else if (ext === "3mf") {
    const buf = await fetchBuffer(src.url);
    obj = new ThreeMFLoader().parse(buf);
    applyMaterial(obj, color);
  } else if (ext === "step" || ext === "stp") {
    const buf = await fetchBuffer(src.url);
    obj = await loadStep(buf, color);
  } else {
    throw new Error(`unsupported mesh type: ${ext}`);
  }
  return normalize(obj);
}
