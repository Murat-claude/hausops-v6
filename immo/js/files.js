// Belege & Dokumente: Dateien (Fotos, Scans, PDFs) lokal in IndexedDB.
// Metadaten liegen im App-Zustand (state.documents), die Dateien selbst hier.

const DB = "hausops-immo-files";
const STORE = "files";
let dbp = null;

function db() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}

async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(r?.result);
    t.onerror = () => reject(t.error);
  });
}

export const putFile = (id, blob) => tx("readwrite", (s) => s.put(blob, id));
export const getFile = (id) => tx("readonly", (s) => s.get(id));
export const deleteFile = (id) => tx("readwrite", (s) => s.delete(id));
export const clearAll = () => tx("readwrite", (s) => s.clear());

export async function allFiles() {
  const d = await db();
  return new Promise((resolve, reject) => {
    const out = {};
    const req = d.transaction(STORE).objectStore(STORE).openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (c) { out[c.key] = c.value; c.continue(); } else resolve(out);
    };
    req.onerror = () => reject(req.error);
  });
}

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(img.src); resolve(img); };
    img.onerror = () => reject(new Error("Bild konnte nicht gelesen werden (HEIC? Bitte als JPG fotografieren)."));
    img.src = URL.createObjectURL(blob);
  });
}

const toBlob = (canvas, q = 0.85) => new Promise((r) => canvas.toBlob(r, "image/jpeg", q));

// Verkleinert Fotos (max. 2000 px) und macht optional einen "Scan":
// Graustufen + Kontrast spreizen → gut lesbares Dokument, kleine Datei.
export async function prepareImage(file, scan = false) {
  const img = await loadImage(file);
  const max = 2000;
  const f = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * f), h = Math.round(img.naturalHeight * f);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);
  if (scan) {
    const data = ctx.getImageData(0, 0, w, h);
    const px = data.data;
    const hist = new Uint32Array(256);
    for (let i = 0; i < px.length; i += 4) {
      const g = Math.round(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
      px[i] = g; hist[g]++;
    }
    // 2 %- und 98 %-Perzentil als Schwarz-/Weißpunkt
    const n = w * h; let acc = 0, lo = 0, hi = 255;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > n * 0.02) { lo = v; break; } }
    acc = 0;
    for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > n * 0.12) { hi = v; break; } }
    const span = Math.max(1, hi - lo);
    for (let i = 0; i < px.length; i += 4) {
      const v = Math.max(0, Math.min(255, ((px[i] - lo) * 255) / span));
      px[i] = px[i + 1] = px[i + 2] = v;
    }
    ctx.putImageData(data, 0, 0);
  }
  const blob = await toBlob(c, scan ? 0.8 : 0.85);
  const t = document.createElement("canvas");
  const tf = 240 / Math.max(w, h);
  t.width = Math.round(w * tf); t.height = Math.round(h * tf);
  t.getContext("2d").drawImage(c, 0, 0, t.width, t.height);
  return { blob, thumb: t.toDataURL("image/jpeg", 0.7), width: w, height: h };
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export async function base64ToBlob(b64, type) {
  const res = await fetch(`data:${type};base64,${b64}`);
  return res.blob();
}
