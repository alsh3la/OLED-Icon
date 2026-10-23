import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Compass,
  Download,
  FileText,
  ImagePlus,
  Mail,
  MapPin,
  MessageCircle,
  Music,
  Phone,
  Pipette,
  RotateCcw,
  type LucideIcon,
} from "lucide-react";
import { toColorInput } from "@/lib/icon/color";
import {
  canvasToPng,
  clickToFramedPixel,
  DEFAULT_EDIT,
  downscale,
  hasTransparency,
  paintSample,
  readPixel,
  renderMaster,
  renderPlain,
  sampleCorners,
  type EditState,
  type Framing,
  type RemoveMode,
  type SampleKind,
} from "@/lib/icon/render";
import {
  contentsJSON,
  jobsFor,
  PACK_BY_ID,
  PACKS,
  readme,
  type PlatformId,
} from "@/lib/icon/specs";
import { buildIco, buildZip } from "@/lib/icon/zip";

type Source = {
  image: CanvasImageSource;
  width: number;
  height: number;
  name: string;
  revoke?: string;
};

type Stage =
  | { kind: "idle" }
  | { kind: "working"; done: number; total: number }
  | { kind: "ready"; files: number; bytes: number }
  | { kind: "error"; message: string };

type View = "home" | "plate";

const KEY_SWATCHES = ["#00ff00", "#0000ff", "#ff00ff", "#ffffff", "#000000"];
const FILL_SWATCHES = ["#000000", "#ffffff", "#101012", "#f4f4f5", "#2ee6ff"];

const HOME_APPS: { name: string; icon: LucideIcon }[] = [
  { name: "Mail", icon: Mail },
  { name: "Maps", icon: MapPin },
  { name: "Music", icon: Music },
];

const DOCK: { name: string; icon: LucideIcon }[] = [
  { name: "Phone", icon: Phone },
  { name: "Safari", icon: Compass },
  { name: "Messages", icon: MessageCircle },
];

const DEFAULT_PLATFORMS: Record<PlatformId, boolean> = {
  ios: true,
  universal: false,
  mac: false,
  watch: false,
  android: false,
  web: false,
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function IconMaker() {
  const [source, setSource] = useState<Source | null>(null);
  const [edit, setEdit] = useState<EditState>(DEFAULT_EDIT);
  const [platforms, setPlatforms] = useState(DEFAULT_PLATFORMS);
  const [manifest, setManifest] = useState(true);
  const [appName, setAppName] = useState("OLED");
  const [view, setView] = useState<View>("home");
  const [guide, setGuide] = useState(true);
  const [picking, setPicking] = useState(false);
  const [compare, setCompare] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [corner, setCorner] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [transparent, setTransparent] = useState(false);
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const framedRef = useRef<HTMLCanvasElement | null>(null);
  const zipRef = useRef<Blob | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const sourceRef = useRef<Source | null>(null);
  const buildId = useRef(0);
  sourceRef.current = source;

  const selected = useMemo(
    () => PACKS.filter((pack) => platforms[pack.id]).map((pack) => pack.id),
    [platforms],
  );
  const jobs = useMemo(() => jobsFor(selected), [selected]);
  const appleSelected = selected.some((id) => PACK_BY_ID[id].apple);

  const forgetZip = useCallback(() => {
    buildId.current += 1;
    zipRef.current = null;
    setStage({ kind: "idle" });
  }, []);

  const patch = useCallback(
    (partial: Partial<EditState>) => {
      setEdit((current) => ({ ...current, ...partial }));
      forgetZip();
    },
    [forgetZip],
  );

  const replaceSource = useCallback(
    (next: Source, nextEdit?: Partial<EditState>) => {
      setSource((current) => {
        if (current?.revoke) URL.revokeObjectURL(current.revoke);
        return next;
      });
      if (nextEdit) setEdit((current) => ({ ...current, ...nextEdit }));
      setCorner(null);
      setPicking(false);
      forgetZip();
    },
    [forgetZip],
  );

  const loadFile = useCallback(
    (file: File) => {
      if (!file.type.startsWith("image/")) {
        setStage({ kind: "error", message: "Use a PNG, JPG, or WebP." });
        return;
      }
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        if (img.naturalWidth < 1 || img.naturalHeight < 1) {
          URL.revokeObjectURL(url);
          setStage({ kind: "error", message: "That image has no pixels." });
          return;
        }
        replaceSource({
          image: img,
          width: img.naturalWidth,
          height: img.naturalHeight,
          name: file.name,
          revoke: url,
        });
        setCorner(sampleCorners(img, img.naturalWidth, img.naturalHeight));
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        setStage({ kind: "error", message: "Could not read that image." });
      };
      img.src = url;
    },
    [replaceSource],
  );

  const loadSample = useCallback(
    (kind: SampleKind) => {
      const canvas = paintSample(kind);
      const preset: Partial<EditState> =
        kind === "studio"
          ? {
              ...DEFAULT_EDIT,
              removeMode: "chroma",
              keyColor: "#00ff00",
              tolerance: 0.18,
              feather: 0.05,
              fill: true,
              fillColor: "#050505",
            }
          : DEFAULT_EDIT;
      replaceSource(
        {
          image: canvas,
          width: canvas.width,
          height: canvas.height,
          name: kind === "studio" ? "Studio green screen" : kind === "orbit" ? "Orbit" : "Bars",
        },
        preset,
      );
    },
    [replaceSource],
  );

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const file = [...(event.clipboardData?.files ?? [])].find((item) =>
        item.type.startsWith("image/"),
      );
      if (!file) return;
      event.preventDefault();
      loadFile(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [loadFile]);

  useEffect(() => {
    if (!picking) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPicking(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picking]);

  useEffect(() => {
    const current = source;
    if (!current) {
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      return;
    }
    let alive = true;
    const timer = window.setTimeout(() => {
      try {
        if (compare) {
          const plain = renderPlain(current.image, current.width, current.height);
          plain.toBlob((blob) => {
            if (!alive || !blob) return;
            const url = URL.createObjectURL(blob);
            setPreviewUrl((prev) => {
              if (prev) URL.revokeObjectURL(prev);
              return url;
            });
          });
          return;
        }
        const both = renderMaster(current.image, current.width, current.height, edit);
        framedRef.current = both.framed;
        const seeThrough = hasTransparency(both.final);
        setTransparent((prev) => (prev === seeThrough ? prev : seeThrough));
        both.final.toBlob((blob) => {
          if (!alive || !blob) return;
          const url = URL.createObjectURL(blob);
          setPreviewUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return url;
          });
        });
      } catch (error) {
        if (!alive) return;
        setStage({
          kind: "error",
          message: error instanceof Error ? error.message : "Could not draw that image.",
        });
      }
    }, compare ? 0 : 40);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [source, edit, compare]);

  const onPreviewClick = (event: React.MouseEvent<HTMLImageElement>) => {
    if (!picking || !framedRef.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const point = clickToFramedPixel(
      framedRef.current,
      (event.clientX - rect.left) / rect.width,
      (event.clientY - rect.top) / rect.height,
      edit.padding,
    );
    if (!point) return;
    const hex = readPixel(framedRef.current, point.x, point.y);
    if (!hex) return;
    patch({
      keyColor: hex,
      removeMode: edit.removeMode === "off" ? "chroma" : edit.removeMode,
    });
    setPicking(false);
  };

  const build = async () => {
    const current = sourceRef.current;
    if (!current || stage.kind === "working") return;
    if (jobs.length === 0) {
      setStage({ kind: "error", message: "Pick at least one platform." });
      return;
    }
    const existing = zipRef.current;
    if (stage.kind === "ready" && existing) {
      saveBlob(existing, "OLED-Icons.zip");
      return;
    }
    const id = ++buildId.current;
    setStage({ kind: "working", done: 0, total: jobs.length });
    try {
      const { final } = renderMaster(current.image, current.width, current.height, edit);
      const cache = new Map<number, Uint8Array>();
      const pngFor = async (px: number) => {
        const hit = cache.get(px);
        if (hit) return hit;
        const bytes = await canvasToPng(downscale(final, px));
        cache.set(px, bytes);
        return bytes;
      };
      const files: { name: string; data: Uint8Array }[] = [];
      for (let i = 0; i < jobs.length; i += 1) {
        if (buildId.current !== id) return;
        const job = jobs[i];
        files.push({ name: job.path, data: await pngFor(job.px) });
        if (buildId.current !== id) return;
        setStage({ kind: "working", done: i + 1, total: jobs.length });
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      if (buildId.current !== id) return;
      if (platforms.web) {
        files.push({
          name: "web/favicon.ico",
          data: buildIco([
            { px: 16, png: await pngFor(16) },
            { px: 32, png: await pngFor(32) },
            { px: 48, png: await pngFor(48) },
          ]),
        });
      }
      if (manifest) {
        for (const platformId of selected) {
          const pack = PACK_BY_ID[platformId];
          if (!pack.apple) continue;
          files.push({
            name: `${pack.dir}/Contents.json`,
            data: new TextEncoder().encode(contentsJSON(pack.images)),
          });
        }
      }
      files.push({
        name: "README.txt",
        data: new TextEncoder().encode(readme(selected)),
      });
      const zip = buildZip(files);
      const bytes = new ArrayBuffer(zip.byteLength);
      new Uint8Array(bytes).set(zip);
      const blob = new Blob([bytes], { type: "application/zip" });
      if (buildId.current !== id) return;
      zipRef.current = blob;
      setStage({ kind: "ready", files: files.length, bytes: blob.size });
    } catch (error) {
      if (buildId.current !== id) return;
      zipRef.current = null;
      setStage({
        kind: "error",
        message: error instanceof Error ? error.message : "Export failed.",
      });
    }
  };

  const shortSide = source ? Math.min(source.width, source.height) : 0;
  const showStoreWarning =
    transparent && appleSelected && (platforms.ios || platforms.universal || platforms.watch);

  return (
    <div
      className="flex min-h-svh flex-col overflow-x-hidden lg:h-svh"
      onDragEnter={(event) => {
        event.preventDefault();
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => {
        dragDepth.current -= 1;
        if (dragDepth.current <= 0) {
          dragDepth.current = 0;
          setDragging(false);
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        const file = event.dataTransfer.files?.[0];
        if (file) loadFile(file);
      }}
    >
      <header className="flex items-end justify-between gap-4 border-b border-line px-4 py-4 sm:px-6">
        <div>
          <p className="text-sm font-medium text-accent">OLED</p>
          <h1 className="text-2xl font-semibold tracking-tight">Icon Maker</h1>
        </div>
        <p className="hidden max-w-xs text-right text-sm text-muted sm:block">
          One square. Every size Apple, Google, and the web still ask for.
        </p>
      </header>

      <div className="lg:grid lg:min-h-0 lg:flex-1 lg:grid-cols-2 lg:overflow-hidden">
        <section className="min-w-0 px-4 py-6 pb-36 sm:px-6 lg:scroll-modern lg:scroll-fade lg:pb-10">
          {!source ? (
            <EmptyStage
              dragging={dragging}
              onBrowse={() => fileRef.current?.click()}
              onSample={loadSample}
            />
          ) : (
            <div className="mx-auto flex w-full max-w-xl flex-col gap-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Segment
                  value={picking ? "plate" : view}
                  options={[
                    { id: "home" as const, label: "Home" },
                    { id: "plate" as const, label: "Pixels" },
                  ]}
                  onChange={(next) => {
                    if (!picking) setView(next);
                  }}
                />
                <button
                  type="button"
                  className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-fg"
                  onPointerDown={() => setCompare(true)}
                  onPointerUp={() => setCompare(false)}
                  onPointerLeave={() => setCompare(false)}
                  onPointerCancel={() => setCompare(false)}
                >
                  Hold to compare
                </button>
              </div>

              {(picking ? "plate" : view) === "home" ? (
                <DevicePreview
                  name={appName}
                  onName={setAppName}
                  src={previewUrl}
                  picking={picking}
                  onPick={onPreviewClick}
                />
              ) : (
                <Plate
                  src={previewUrl}
                  guide={guide}
                  picking={picking}
                  onPick={onPreviewClick}
                />
              )}

              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="font-mono text-sm text-muted tabular-nums">
                  {source.width}×{source.height}
                  {shortSide < 1024 ? " · under 1024" : ""}
                  {compare ? " · original" : ""}
                </p>
                <label className="flex items-center gap-2 text-sm text-muted">
                  <input
                    type="checkbox"
                    checked={guide}
                    onChange={(event) => setGuide(event.target.checked)}
                    className="size-4 accent-accent"
                  />
                  Safe inset
                </label>
              </div>

              <ol className="flex items-end justify-between gap-4 px-2">
                {[
                  ["16", "w-4"],
                  ["32", "w-8"],
                  ["60", "w-14"],
                  ["180", "w-20"],
                ].map(([label, size]) => (
                  <li key={label} className="flex flex-col items-center gap-2">
                    {previewUrl ? (
                      <img src={previewUrl} alt="" className={`squircle ${size} h-auto`} />
                    ) : (
                      <span className={`squircle bg-surface-2 ${size} aspect-square`} />
                    )}
                    <span className="font-mono text-xs text-faint tabular-nums">{label}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </section>

        <aside className="min-w-0 border-t border-line lg:flex lg:h-full lg:flex-col lg:overflow-hidden lg:border-t-0 lg:border-l">
          <div className="flex flex-col gap-6 px-4 py-6 pb-36 sm:px-6 lg:flex-1 lg:scroll-modern lg:scroll-fade lg:pb-6">
            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-medium">Artwork</h2>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="inline-flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-sm"
                >
                  <ImagePlus className="size-4 text-accent" aria-hidden="true" />
                  {source ? "Replace" : "Choose image"}
                </button>
                <button
                  type="button"
                  onClick={() => loadSample("orbit")}
                  className="rounded-md border border-line px-3 py-2 text-sm text-muted"
                >
                  Orbit
                </button>
                <button
                  type="button"
                  onClick={() => loadSample("bars")}
                  className="rounded-md border border-line px-3 py-2 text-sm text-muted"
                >
                  Bars
                </button>
                <button
                  type="button"
                  onClick={() => loadSample("studio")}
                  className="rounded-md border border-line px-3 py-2 text-sm text-muted"
                >
                  Green screen
                </button>
              </div>
              {source ? (
                <p className="truncate text-sm text-muted" title={source.name}>
                  {source.name}
                </p>
              ) : (
                <p className="text-sm text-muted">Drop, paste, or start from a sample.</p>
              )}
              {corner && edit.removeMode === "off" ? (
                <button
                  type="button"
                  onClick={() => patch({ removeMode: "edges", keyColor: corner, tolerance: 0.14 })}
                  className="rounded-md border border-line bg-surface px-3 py-2 text-left text-sm"
                >
                  Corners match{" "}
                  <span className="font-mono text-accent">{corner}</span>
                  . Remove that edge color.
                </button>
              ) : null}
            </section>

            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-medium">Frame</h2>
              <Segment
                value={edit.framing}
                options={[
                  { id: "cover" as Framing, label: "Fill square" },
                  { id: "contain" as Framing, label: "Fit inside" },
                ]}
                onChange={(framing) => patch({ framing })}
              />
              <Slider
                label="Zoom"
                value={edit.zoom}
                min={1}
                max={3}
                step={0.01}
                text={`${edit.zoom.toFixed(2)}×`}
                onChange={(zoom) => patch({ zoom })}
              />
              <Slider
                label="Horizontal"
                value={edit.panX}
                min={-1}
                max={1}
                step={0.01}
                text={edit.panX === 0 ? "Center" : edit.panX < 0 ? "Left" : "Right"}
                onChange={(panX) => patch({ panX })}
              />
              <Slider
                label="Vertical"
                value={edit.panY}
                min={-1}
                max={1}
                step={0.01}
                text={edit.panY === 0 ? "Center" : edit.panY < 0 ? "Up" : "Down"}
                onChange={(panY) => patch({ panY })}
              />
              <Slider
                label="Padding"
                value={edit.padding}
                min={0}
                max={0.22}
                step={0.01}
                text={`${Math.round(edit.padding * 100)}%`}
                onChange={(padding) => patch({ padding })}
              />
            </section>

            <section className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-medium">Cutout</h2>
                <button
                  type="button"
                  aria-pressed={picking}
                  onClick={() => {
                    setPicking((on) => !on);
                    setView("plate");
                  }}
                  className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${
                    picking ? "border-accent text-accent" : "border-line text-muted"
                  }`}
                >
                  <Pipette className="size-4" aria-hidden="true" />
                  {picking ? "Click a pixel" : "Pick color"}
                </button>
              </div>
              <Segment
                value={edit.removeMode}
                options={[
                  { id: "off" as RemoveMode, label: "Off" },
                  { id: "chroma" as RemoveMode, label: "Color" },
                  { id: "edges" as RemoveMode, label: "Edges" },
                ]}
                onChange={(removeMode) => patch({ removeMode })}
              />
              <p className="text-sm text-muted">
                {edit.removeMode === "edges"
                  ? "Clears the key color only where it touches the border, so the same color inside the mark survives."
                  : edit.removeMode === "chroma"
                    ? "Clears every pixel near the key color. Softness feathers the edge and pulls the spill."
                    : "Leave the photo as it is, or key out a flat backdrop."}
              </p>
              {edit.removeMode !== "off" ? (
                <>
                  <ColorField
                    label="Key color"
                    value={edit.keyColor}
                    onChange={(keyColor) => patch({ keyColor })}
                  />
                  <Swatches colors={KEY_SWATCHES} value={edit.keyColor} onChange={(keyColor) => patch({ keyColor })} />
                  <Slider
                    label="Tolerance"
                    value={edit.tolerance}
                    min={0}
                    max={0.6}
                    step={0.01}
                    text={`${Math.round(edit.tolerance * 100)}%`}
                    onChange={(tolerance) => patch({ tolerance })}
                  />
                  <Slider
                    label="Softness"
                    value={edit.feather}
                    min={0}
                    max={0.35}
                    step={0.01}
                    text={`${Math.round(edit.feather * 100)}%`}
                    onChange={(feather) => patch({ feather })}
                  />
                </>
              ) : null}
            </section>

            <section className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-medium">Ground</h2>
                <button
                  type="button"
                  role="switch"
                  aria-checked={edit.fill}
                  onClick={() => patch({ fill: !edit.fill })}
                  className={`rounded-full px-3 py-2 text-sm ${
                    edit.fill ? "bg-accent text-accent-ink" : "bg-surface-2 text-muted"
                  }`}
                >
                  {edit.fill ? "On" : "Off"}
                </button>
              </div>
              <p className="text-sm text-muted">
                Paints behind transparency. App Store icons have to be opaque.
              </p>
              {edit.fill ? (
                <>
                  <ColorField
                    label="Fill"
                    value={edit.fillColor}
                    onChange={(fillColor) => patch({ fillColor })}
                  />
                  <Swatches
                    colors={FILL_SWATCHES}
                    value={edit.fillColor}
                    onChange={(fillColor) => patch({ fillColor })}
                  />
                </>
              ) : null}
            </section>

            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-medium">Export</h2>
              <div className="grid grid-cols-2 gap-2">
                {PACKS.map((pack) => {
                  const on = platforms[pack.id];
                  return (
                    <button
                      key={pack.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => {
                        setPlatforms((current) => ({ ...current, [pack.id]: !current[pack.id] }));
                        forgetZip();
                      }}
                      className={`rounded-md border px-3 py-3 text-left ${
                        on ? "border-accent bg-surface" : "border-line bg-bg"
                      }`}
                    >
                      <span className="block text-sm font-medium">{pack.label}</span>
                      <span className="mt-1 block text-sm text-muted">
                        {pack.images.length} PNG{pack.images.length === 1 ? "" : "s"}
                      </span>
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={manifest}
                disabled={!appleSelected}
                onClick={() => {
                  setManifest((on) => !on);
                  forgetZip();
                }}
                className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-3 text-left disabled:opacity-40"
              >
                <span>
                  <span className="block text-sm font-medium">Contents.json</span>
                  <span className="mt-1 block text-sm text-muted">
                    Xcode manifest inside each AppIcon.appiconset.
                  </span>
                </span>
                <span
                  className={`shrink-0 rounded-full px-3 py-1 text-sm ${
                    manifest && appleSelected ? "bg-accent text-accent-ink" : "bg-surface-2 text-muted"
                  }`}
                >
                  {manifest && appleSelected ? "On" : "Off"}
                </span>
              </button>
              <details className="rounded-md border border-line px-3 py-3">
                <summary className="cursor-pointer text-sm text-muted">
                  {jobs.length === 0
                    ? "No files yet"
                    : `${jobs.length} PNG${jobs.length === 1 ? "" : "s"}${
                        platforms.web ? " + favicon.ico" : ""
                      }${manifest && appleSelected ? " + Contents.json" : ""}`}
                </summary>
                <ul className="scroll-modern mt-3 max-h-40 font-mono text-xs leading-5 text-faint">
                  {jobs.map((job) => (
                    <li key={job.path}>
                      {job.path} · {job.px}px
                    </li>
                  ))}
                  {platforms.web ? <li>web/favicon.ico</li> : null}
                </ul>
              </details>
              {showStoreWarning ? (
                <p className="text-sm text-danger">
                  This icon still has transparent pixels. Fill a ground color before the App Store upload.
                </p>
              ) : null}
              {shortSide > 0 && shortSide < 1024 ? (
                <p className="text-sm text-muted">
                  Source is {shortSide}px on the short side. The 1024 slot will be scaled up.
                </p>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setEdit(DEFAULT_EDIT);
                  setPicking(false);
                  forgetZip();
                }}
                className="inline-flex items-center gap-2 self-start text-sm text-muted"
              >
                <RotateCcw className="size-4" aria-hidden="true" />
                Reset edits
              </button>
            </section>
          </div>

          <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-bg px-4 py-3 sm:px-6 lg:static">
            <button
              type="button"
              disabled={!source || stage.kind === "working"}
              onClick={() => void build()}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-accent px-4 py-3 text-base font-semibold text-accent-ink disabled:bg-surface-2 disabled:text-faint"
            >
              {stage.kind === "ready" ? (
                <Download className="size-5" aria-hidden="true" />
              ) : stage.kind === "working" ? null : (
                <Check className="size-5" aria-hidden="true" />
              )}
              {stage.kind === "working"
                ? `Building ${stage.done} / ${stage.total}`
                : stage.kind === "ready"
                  ? "Download OLED-Icons.zip"
                  : "Build icon ZIP"}
            </button>
            <p
            className={`mt-2 min-h-5 text-center text-sm ${stage.kind === "error" ? "text-danger" : "text-muted"}`}
            aria-live="polite"
          >
              {stage.kind === "ready"
                ? `${stage.files} files · ${formatBytes(stage.bytes)}`
                : stage.kind === "error"
                  ? stage.message
                  : stage.kind === "working"
                    ? "Resizing and packing."
                    : "Unzip and drop AppIcon.appiconset into Assets.xcassets."}
            </p>
            {stage.kind === "working" ? (
              <div className="mt-2 h-0.5 overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full bg-accent"
                  style={{ width: `${stage.total === 0 ? 0 : (stage.done / stage.total) * 100}%` }}
                />
              </div>
            ) : null}
          </div>
        </aside>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) loadFile(file);
          event.target.value = "";
        }}
      />

      {dragging ? (
        <div className="pointer-events-none fixed inset-0 z-30 grid place-items-center bg-bg/80">
          <p className="rounded-lg border border-accent px-6 py-4 text-lg font-medium text-accent">
            Drop to use this image
          </p>
        </div>
      ) : null}
    </div>
  );
}

function EmptyStage({
  dragging,
  onBrowse,
  onSample,
}: {
  dragging: boolean;
  onBrowse: () => void;
  onSample: (kind: SampleKind) => void;
}) {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col justify-center gap-6 py-8">
      <div
        className={`rounded-xl border border-dashed px-6 py-12 text-center ${
          dragging ? "border-accent" : "border-line"
        }`}
      >
        <ImagePlus className="mx-auto size-8 text-accent" aria-hidden="true" />
        <h2 className="mt-4 text-xl font-semibold">Drop a PNG or JPG</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm text-pretty text-muted">
          It is framed into a square, keyed if you need it, then resized to the real icon slots.
          Paste works too.
        </p>
        <button
          type="button"
          onClick={onBrowse}
          className="mt-6 rounded-md bg-accent px-4 py-3 text-sm font-semibold text-accent-ink"
        >
          Choose image
        </button>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {(
          [
            ["orbit", "Orbit", "Dark mark"],
            ["bars", "Bars", "Hard shapes"],
            ["studio", "Green screen", "Key demo"],
          ] as const
        ).map(([kind, label, blurb]) => (
          <button
            key={kind}
            type="button"
            onClick={() => onSample(kind)}
            className="rounded-md border border-line bg-surface px-3 py-3 text-left"
          >
            <span className="block text-sm font-medium">{label}</span>
            <span className="mt-1 block text-sm text-muted">{blurb}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function DevicePreview({
  name,
  onName,
  src,
  picking,
  onPick,
}: {
  name: string;
  onName: (value: string) => void;
  src: string | null;
  picking: boolean;
  onPick: (event: React.MouseEvent<HTMLImageElement>) => void;
}) {
  return (
    <div className="mx-auto w-full max-w-sm rounded-xl border border-line bg-bg p-3">
      <div className="rounded-lg border border-line bg-bg px-4 pb-4 pt-3">
        <div className="mb-5 flex items-center justify-between text-sm">
          <span className="font-medium tabular-nums">9:41</span>
          <span className="flex items-center gap-1" aria-hidden="true">
            <span className="h-1.5 w-1.5 rounded-full bg-fg" />
            <span className="h-1.5 w-1.5 rounded-full bg-fg" />
            <span className="h-2 w-4 rounded-sm border border-fg" />
          </span>
        </div>
        <div className="grid grid-cols-4 gap-3">
          <IconSlot name={name} onName={onName} src={src} picking={picking} onPick={onPick} />
          {HOME_APPS.map((app) => (
            <GhostIcon key={app.name} name={app.name} icon={app.icon} />
          ))}
        </div>
        <div className="mt-8 grid grid-cols-4 gap-3 rounded-lg bg-surface px-2 py-3">
          {DOCK.map((app) => (
            <GhostIcon key={app.name} name={app.name} icon={app.icon} />
          ))}
          <GhostIcon name="Notes" icon={FileText} />
        </div>
      </div>
    </div>
  );
}

function IconSlot({
  name,
  onName,
  src,
  picking,
  onPick,
}: {
  name: string;
  onName: (value: string) => void;
  src: string | null;
  picking: boolean;
  onPick: (event: React.MouseEvent<HTMLImageElement>) => void;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      {src ? (
        <img
          src={src}
          alt="Icon preview"
          onClick={onPick}
          className={`squircle aspect-square w-full object-cover ${picking ? "cursor-crosshair ring-2 ring-accent" : ""}`}
        />
      ) : (
        <div className="squircle aspect-square w-full bg-surface-2" />
      )}
      <input
        value={name}
        maxLength={12}
        aria-label="Home screen name"
        onChange={(event) => onName(event.target.value)}
        className="w-full bg-transparent text-center text-xs text-fg outline-none"
      />
    </div>
  );
}

function GhostIcon({ name, icon: Icon }: { name: string; icon: LucideIcon }) {
  return (
    <div className="flex flex-col items-center gap-1" aria-hidden="true">
      <div className="squircle grid aspect-square w-full place-items-center bg-surface-2 text-muted">
        <Icon className="size-5" />
      </div>
      <span className="w-full truncate text-center text-xs text-faint">{name}</span>
    </div>
  );
}

function Plate({
  src,
  guide,
  picking,
  onPick,
}: {
  src: string | null;
  guide: boolean;
  picking: boolean;
  onPick: (event: React.MouseEvent<HTMLImageElement>) => void;
}) {
  return (
    <div className="checker relative mx-auto aspect-square w-full max-w-sm overflow-hidden rounded-lg border border-line">
      {src ? (
        <img
          src={src}
          alt="Icon pixels"
          onClick={onPick}
          className={`h-full w-full object-cover ${picking ? "cursor-crosshair" : ""}`}
        />
      ) : null}
      {guide ? <div className="safe-guide" /> : null}
    </div>
  );
}

function Segment<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex rounded-md bg-surface-2 p-1">
      {options.map((option) => {
        const on = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(option.id)}
            className={`flex-1 rounded-sm px-2 py-2 text-sm ${on ? "bg-bg text-fg" : "text-muted"}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  text,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  text: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="flex items-center justify-between text-sm">
        <span>{label}</span>
        <span className="font-mono text-muted tabular-nums">{text}</span>
      </span>
      <input
        className="range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={text}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        aria-label={label}
        value={toColorInput(value)}
        onChange={(event) => onChange(event.target.value)}
      />
      <input
        value={value}
        spellCheck={false}
        aria-label={`${label} hex`}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-md border border-line bg-surface px-3 py-2 font-mono text-sm"
      />
    </div>
  );
}

function Swatches({
  colors,
  value,
  onChange,
}: {
  colors: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  const current = toColorInput(value);
  return (
    <div className="flex flex-wrap gap-2">
      {colors.map((color) => {
        const on = toColorInput(color) === current;
        return (
          <button
            key={color}
            type="button"
            aria-label={color}
            aria-pressed={on}
            onClick={() => onChange(color)}
            className={`size-9 rounded-sm border ${on ? "border-accent" : "border-line"}`}
            style={{ backgroundColor: color }}
          />
        );
      })}
    </div>
  );
}
