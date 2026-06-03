/* thumbs.ts — real thumbnail generation that never blocks the UI.
   Pipeline per model: fetch bytes (async, off the critical path) → parse in a
   Web Worker (off the main thread) → build geometry + render a small PNG on the
   main thread (cheap) → store per-id + persist via Rust. Skipped entirely when a
   model already has a folder image (preview), an existing thumbnail, or no
   worker-parseable STL/OBJ part. */

import * as THREE from "three";
import { makeMaterial } from "./geometries";
import { normalize } from "./loaders";
import { assetUrl, api, isTauri } from "../lib/tauri";
import { useApp } from "../lib/store";
import type { Model } from "../data/types";

// ── offscreen renderer (main thread; rendering a prepared geometry is cheap) ──
const SIZE = 440;
let renderer: THREE.WebGLRenderer | undefined;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
function initRenderer() {
  if (renderer) return;
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(SIZE, SIZE);
  renderer.setPixelRatio(1);
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  camera.position.set(2.4, 1.9, 3.0);
  camera.lookAt(0, 0, 0);
  scene.add(new THREE.HemisphereLight(0xfff3e6, 0x6b5a44, 1.05));
  const key = new THREE.DirectionalLight(0xffffff, 1.5); key.position.set(3, 5, 4); scene.add(key);
  const fill = new THREE.DirectionalLight(0xffe6c8, 0.5); fill.position.set(-4, 1, -2); scene.add(fill);
}
function renderToPng(obj: THREE.Object3D): string {
  initRenderer();
  obj.rotation.y = -0.5;
  scene.add(obj);
  renderer!.render(scene, camera);
  const url = renderer!.domElement.toDataURL("image/png");
  scene.remove(obj);
  return url;
}

// ── Web Worker (parsing off the main thread) ──
interface WorkerReply {
  id: number; ok: boolean;
  position?: Float32Array; normal?: Float32Array; index?: Uint32Array;
  dims?: { x: number; y: number; z: number };
}
let worker: Worker | null = null;
const replies = new Map<number, (r: WorkerReply) => void>();
let reqId = 0;
function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./meshWorker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<WorkerReply>) => {
      const cb = replies.get(e.data.id);
      if (cb) { replies.delete(e.data.id); cb(e.data); }
    };
  }
  return worker;
}
function parseInWorker(ext: string, buffer?: ArrayBuffer, text?: string): Promise<WorkerReply> {
  return new Promise((resolve) => {
    const id = ++reqId;
    replies.set(id, resolve);
    getWorker().postMessage({ id, ext, buffer, text }, buffer ? [buffer] : []);
  });
}

// ── which part to render: only worker-parseable formats, smallest first ──
function workablePart(m: Model) {
  const rank = (t: string) => (t === "stl" ? 0 : t === "obj" ? 1 : 9);
  return [...m.parts]
    .filter((p) => { const f = p.files[0]; return f?.path && (f.type === "stl" || f.type === "obj"); })
    .sort((a, b) => rank(a.files[0].type) - rank(b.files[0].type) || (a.files[0].size - b.files[0].size))[0];
}

function setThumb(id: string, url: string) {
  useApp.getState().setThumb(id, url);
}

const MAX_INFLIGHT = 2; // gentle on network shares — meshes can be MBs each
const queued = new Set<string>();
const attempted = new Set<string>();
const pending: Model[] = [];
let active = 0;

async function renderOne(m: Model): Promise<void> {
  const part = workablePart(m);
  const file = part?.files[0];
  if (!file?.path) return;
  try {
    const url = await assetUrl(file.path);
    const res = await fetch(url);
    if (!res.ok) return;
    let reply: WorkerReply;
    if (file.type === "obj") {
      reply = await parseInWorker("obj", undefined, await res.text());
    } else {
      reply = await parseInWorker("stl", await res.arrayBuffer());
    }
    if (!reply.ok || !reply.position) return;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(reply.position, 3));
    if (reply.normal) geo.setAttribute("normal", new THREE.BufferAttribute(reply.normal, 3));
    else geo.computeVertexNormals();
    if (reply.index) geo.setIndex(new THREE.BufferAttribute(reply.index, 1));

    const mesh = new THREE.Mesh(geo, makeMaterial(part!.color, false));
    const png = renderToPng(normalize(mesh));
    const dim = reply.dims
      ? { w: Math.round(reply.dims.x), d: Math.round(reply.dims.z), h: Math.round(reply.dims.y) }
      : undefined;
    setThumb(m.id, png);
    if (isTauri) await api.saveThumb(m.id, png, dim).catch(() => {});
    geo.dispose();
  } catch {
    /* leave the neutral placeholder */
  }
}

function pump() {
  while (active < MAX_INFLIGHT && pending.length) {
    const m = pending.shift()!;
    queued.delete(m.id);
    active++;
    renderOne(m).finally(() => { active--; pump(); });
  }
}

/** Generate a real thumbnail for a model if warranted (idempotent + cheap to
   call from every card). No-op when: not under Tauri, the model already has a
   folder image (preview) or a stored thumbnail, it's been attempted, or it has
   no worker-parseable STL/OBJ part. */
export function requestThumb(m: Model): void {
  if (!isTauri) return;
  if (m.preview) return;                    // folder image → downscaled by the scanner
  if (m.thumb || useApp.getState().thumbs[m.id]) return;
  if (attempted.has(m.id) || queued.has(m.id)) return;
  if (!workablePart(m)) return;
  attempted.add(m.id);
  queued.add(m.id);
  pending.push(m);
  pump();
}

/** Background pass: render thumbnails for every model that still needs one
   (image-less, with a worker-parseable part), throttled by the queue above so a
   network share is never hammered. Idempotent — already-done/attempted models are
   skipped — so it's safe to call on every dataset refresh. */
export function sweepThumbs(models: Model[]): void {
  if (!isTauri) return;
  for (const m of models) requestThumb(m);
}
