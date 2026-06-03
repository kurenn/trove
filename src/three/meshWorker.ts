/* meshWorker.ts — parses STL/OBJ meshes OFF the main thread so thumbnail
   generation never blocks the UI. Receives raw bytes, returns geometry arrays
   (transferable) + bounding-box dims. The main thread builds a BufferGeometry and
   renders the PNG (cheap). 3MF/STEP are NOT handled here (3MF needs DOMParser,
   unavailable in workers) — callers skip those. */

import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import type { BufferGeometry, Mesh } from "three";

interface Req {
  id: number;
  ext: string;
  buffer?: ArrayBuffer;
  text?: string;
}

const ctx = self as unknown as Worker;

ctx.onmessage = (e: MessageEvent<Req>) => {
  const { id, ext, buffer, text } = e.data;
  try {
    let geo: BufferGeometry | null = null;
    if (ext === "stl" && buffer) {
      geo = new STLLoader().parse(buffer);
    } else if (ext === "obj" && text != null) {
      const group = new OBJLoader().parse(text);
      group.traverse((c) => {
        const m = c as Mesh;
        if (!geo && (m as { isMesh?: boolean }).isMesh) geo = m.geometry as BufferGeometry;
      });
    }
    if (!geo) { ctx.postMessage({ id, ok: false }); return; }

    const g = geo as BufferGeometry;
    if (!g.getAttribute("normal")) g.computeVertexNormals();
    g.computeBoundingBox();
    const arr = (a: unknown) => (a as { array: ArrayLike<number> }).array;
    const position = new Float32Array(arr(g.getAttribute("position")));
    const nAttr = g.getAttribute("normal");
    const normal = nAttr ? new Float32Array(arr(nAttr)) : undefined;
    const iAttr = g.getIndex();
    const index = iAttr ? new Uint32Array(iAttr.array as ArrayLike<number>) : undefined;
    const bb = g.boundingBox!;
    const dims = { x: bb.max.x - bb.min.x, y: bb.max.y - bb.min.y, z: bb.max.z - bb.min.z };

    const transfer: Transferable[] = [position.buffer];
    if (normal) transfer.push(normal.buffer);
    if (index) transfer.push(index.buffer);
    ctx.postMessage({ id, ok: true, position, normal, index, dims }, transfer);
  } catch {
    ctx.postMessage({ id, ok: false });
  }
};
