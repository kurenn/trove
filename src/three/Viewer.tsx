/* Viewer.tsx — shared thumbnail + live interactive <Viewer3D>.
   Thumb shows a cached PNG when available, else a procedural preview.
   Viewer3D loads a real mesh when given a file path, else procedural geometry.
   Slice mode removed (Trove does not slice). */

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { buildObject } from "./geometries";
import { loadMesh } from "./loaders";
import { assetUrl } from "../lib/tauri";
import { Icon } from "../components/Icons";
import { useApp } from "../lib/store";
import type { GeometryKey } from "../data/types";

export type ViewerMode = "rotate" | "measure";

// ── Shared procedural thumbnail factory (cached dataURL) ──
const ThumbFactory = (() => {
  let renderer: THREE.WebGLRenderer | undefined;
  let scene: THREE.Scene;
  let camera: THREE.PerspectiveCamera;
  const cache: Record<string, string> = {};
  const SIZE = 440;

  function init() {
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

  function render(key: GeometryKey, color: string): string {
    init();
    const ck = key + "|" + color;
    if (cache[ck]) return cache[ck];
    const obj = buildObject(key, color);
    obj.rotation.y = -0.5;
    scene.add(obj);
    renderer!.render(scene, camera);
    const url = renderer!.domElement.toDataURL("image/png");
    scene.remove(obj);
    cache[ck] = url;
    return url;
  }

  return { render };
})();

export { ThumbFactory };

interface ThumbProps {
  geometry: GeometryKey;
  color: string;
  /** A LOCAL cached thumbnail path (downscaled folder image or rendered mesh).
      Never a remote/network original — those are downscaled into the cache by the
      scanner so browsing stays local and instant. */
  thumb?: string;
  /** Subscribe to this model's generated thumbnail in the store (per-card update). */
  modelId?: string;
  /** True for scanned models (on-disk files). When true with no preview/thumbnail,
      show a neutral placeholder rather than a misleading procedural shape. Mock
      data sets this false and keeps its meaningful procedural preview. */
  real?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function Thumb({ geometry, color, thumb, modelId, real, className, style }: ThumbProps) {
  const live = useApp((s) => (modelId ? s.thumbs[modelId] : undefined));
  // Cache-only: thumb/live are LOCAL (downscaled folder image or rendered mesh).
  // The remote full-res original is never shown here — that's what made browsing a
  // network share unusable (every visible card streaming MBs off the NAS).
  const ready = thumb ?? live;
  const procedural = !ready && !real;          // mock data → meaningful procedural shape
  const [proc, setProc] = useState<string | null>(null);
  useEffect(() => {
    if (ready || !procedural) { setProc(null); return; }
    let cancelled = false;
    const raf = requestAnimationFrame(() => {
      try { const u = ThumbFactory.render(geometry, color); if (!cancelled) setProc(u); }
      catch { /* webgl unavailable — placeholder stays */ }
    });
    return () => { cancelled = true; cancelAnimationFrame(raf); };
  }, [geometry, color, ready, procedural]);
  const url = ready ?? proc;
  return (
    <div className={"spool-thumb " + (className || "")} style={style}>
      {url
        ? <img src={url} alt="" draggable={false} loading="lazy" />
        : <span className="spool-thumb-ph-icon" style={{ color }}><Icon name="cube" size={30} /></span>}
    </div>
  );
}

interface Viewer3DProps {
  geometry: GeometryKey;
  color: string;
  mode: ViewerMode;
  autoRotate?: boolean;
  /** Real mesh file (absolute path under Tauri, or URL in dev). */
  filePath?: string;
  fileExt?: string;
  /** Reports the model's real bounding-box size (mm) once a mesh loads. */
  onDims?: (dims: { w: number; d: number; h: number } | null) => void;
}

interface ViewerState {
  rotY: number; rotX: number; dist: number;
  dragging: boolean; px: number; py: number;
  mode: ViewerMode; auto: boolean;
}

export function Viewer3D({ geometry, color, mode, autoRotate = true, filePath, fileExt, onDims }: Viewer3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<ViewerState>({
    rotY: -0.5, rotX: 0.12, dist: 4.4, dragging: false, px: 0, py: 0, mode, auto: autoRotate,
  });
  const [status, setStatus] = useState<"ok" | "loading" | "error">("ok");

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let renderer: THREE.WebGLRenderer;
    let raf = 0;
    let disposed = false;
    let W = mount.clientWidth, H = mount.clientHeight;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setStatus("error");
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(W, H);
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.cssText = "width:100%;height:100%;display:block;touch-action:none;cursor:grab";

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, W / H, 0.1, 100);
    camera.position.set(2.6, 1.8, 3.4);
    camera.lookAt(0, 0, 0);
    scene.add(new THREE.HemisphereLight(0xfff3e6, 0x6b5a44, 1.05));
    const keyL = new THREE.DirectionalLight(0xffffff, 1.5); keyL.position.set(3, 5, 4); scene.add(keyL);
    const fillL = new THREE.DirectionalLight(0xffe6c8, 0.55); fillL.position.set(-4, 1, -2); scene.add(fillL);

    let obj: THREE.Object3D | null = null;
    let boxHelper: THREE.Box3Helper | null = null;

    const install = (o: THREE.Object3D) => {
      if (disposed) return;
      o.traverse((c) => { const mm = c as THREE.Mesh; if (mm.isMesh) mm.material = (mm.material as THREE.Material).clone(); });
      scene.add(o);
      obj = o;
      const bb = new THREE.Box3().setFromObject(o);
      boxHelper = new THREE.Box3Helper(bb, new THREE.Color(0x111111));
      (boxHelper.material as THREE.LineBasicMaterial).transparent = true;
      (boxHelper.material as THREE.LineBasicMaterial).opacity = 0.5;
      boxHelper.visible = false;
      scene.add(boxHelper);
      const dims = o.userData.dims as THREE.Vector3 | undefined;
      if (dims && onDims) {
        // userData.dims is the raw mesh size; report rounded mm.
        onDims({ w: Math.round(dims.x), d: Math.round(dims.z), h: Math.round(dims.y) });
      }
    };

    // Load real mesh when a file path is supplied; else procedural geometry.
    if (filePath && fileExt) {
      setStatus("loading");
      (async () => {
        try {
          const url = await assetUrl(filePath);
          const o = await loadMesh({ url, ext: fileExt }, color);
          install(o);
          if (!disposed) setStatus("ok");
        } catch {
          if (disposed) return;
          // Honest failure — do NOT show a fake procedural shape for a real file.
          setStatus("error");
          if (onDims) onDims(null);
        }
      })();
    } else {
      // No file path → mock/demo data: the procedural geometry is meaningful here.
      install(buildObject(geometry, color));
      if (onDims) onDims(null);
    }

    const st = stateRef.current;
    st.rotY = -0.5; st.rotX = 0.12; st.dist = 4.4; st.dragging = false;

    const el = renderer.domElement;
    const onDown = (e: PointerEvent) => { st.dragging = true; st.px = e.clientX; st.py = e.clientY; el.style.cursor = "grabbing"; };
    const onMove = (e: PointerEvent) => {
      if (!st.dragging) return;
      st.rotY += (e.clientX - st.px) * 0.01;
      st.rotX += (e.clientY - st.py) * 0.01;
      st.rotX = Math.max(-1.3, Math.min(1.3, st.rotX));
      st.px = e.clientX; st.py = e.clientY;
    };
    const onUp = () => { st.dragging = false; el.style.cursor = "grab"; };
    const onWheel = (e: WheelEvent) => { e.preventDefault(); st.dist = Math.max(2.6, Math.min(8, st.dist + e.deltaY * 0.003)); };
    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    el.addEventListener("wheel", onWheel, { passive: false });

    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (obj) {
        if (st.auto && !st.dragging) st.rotY += 0.004;
        obj.rotation.y = st.rotY; obj.rotation.x = st.rotX;
        if (boxHelper) { boxHelper.rotation.copy(obj.rotation); boxHelper.visible = st.mode === "measure"; }
      }
      camera.position.set(0, st.dist * 0.42, st.dist * 0.86);
      camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);
    };
    tick();

    const ro = new ResizeObserver(() => {
      W = mount.clientWidth; H = mount.clientHeight;
      if (W && H) { renderer.setSize(W, H); camera.aspect = W / H; camera.updateProjectionMatrix(); }
    });
    ro.observe(mount);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      el.removeEventListener("wheel", onWheel);
      renderer.dispose();
      if (el.parentNode) el.parentNode.removeChild(el);
    };
  }, [geometry, color, filePath, fileExt]);

  useEffect(() => {
    const st = stateRef.current;
    st.mode = mode; st.auto = autoRotate;
  }, [mode, autoRotate]);

  return (
    <div ref={mountRef} className="spool-viewer-canvas">
      {status === "loading" && <div className="viewer-loading"><Icon name="refresh" size={18} style={{ animation: "spin 1s linear infinite" }} /> loading mesh…</div>}
      {status === "error" && <div className="viewer-error"><Icon name="cube" size={26} style={{ opacity: 0.4 }} /><span>Couldn't render a preview for this file.</span></div>}
    </div>
  );
}
