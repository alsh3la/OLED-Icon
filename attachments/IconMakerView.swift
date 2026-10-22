//
//  IconMakerView.swift
//  OLED
//
//  Self-contained tab: pick any PNG/JPG → resize to all 19 required
//  iOS/iPadOS icon sizes → bundle into OLED-Icons.zip → share sheet.
//  Zero external dependencies. iOS 16+.
//
//  ✨ NEW FEATURES
//  - Remove background by detecting a hex colour (chroma‑key style, with tolerance)
//  - Resize source image to a square (centre crop)
//  - Fill a new solid background colour
//

import SwiftUI
import PhotosUI
import UniformTypeIdentifiers

// ─────────────────────────────────────────────────────────────────────────────
// MARK: - Required sizes
// ─────────────────────────────────────────────────────────────────────────────

private struct IconSpec {
    let filename: String
    let px: Int                 // side length in pixels
    // Xcode asset-catalog metadata
    let idiom: String           // "iphone" | "ipad" | "ios-marketing"
    let size: String            // e.g. "60x60"
    let scale: String           // "1x" | "2x" | "3x"

    static let all: [IconSpec] = [
        .init(filename: "notification-20@2x.png",      px: 40,   idiom: "iphone",        size: "20x20",     scale: "2x"),
        .init(filename: "notification-20@3x.png",      px: 60,   idiom: "iphone",        size: "20x20",     scale: "3x"),
        .init(filename: "settings-29@1x.png",          px: 29,   idiom: "iphone",        size: "29x29",     scale: "1x"),
        .init(filename: "settings-29@2x.png",          px: 58,   idiom: "iphone",        size: "29x29",     scale: "2x"),
        .init(filename: "settings-29@3x.png",          px: 87,   idiom: "iphone",        size: "29x29",     scale: "3x"),
        .init(filename: "spotlight-40@2x.png",         px: 80,   idiom: "iphone",        size: "40x40",     scale: "2x"),
        .init(filename: "spotlight-40@3x.png",         px: 120,  idiom: "iphone",        size: "40x40",     scale: "3x"),
        .init(filename: "iphone-60@2x.png",            px: 120,  idiom: "iphone",        size: "60x60",     scale: "2x"),
        .init(filename: "iphone-60@3x.png",            px: 180,  idiom: "iphone",        size: "60x60",     scale: "3x"),
        .init(filename: "ipad-notification-20@1x.png", px: 20,   idiom: "ipad",          size: "20x20",     scale: "1x"),
        .init(filename: "ipad-notification-20@2x.png", px: 40,   idiom: "ipad",          size: "20x20",     scale: "2x"),
        .init(filename: "ipad-settings-29@1x.png",     px: 29,   idiom: "ipad",          size: "29x29",     scale: "1x"),
        .init(filename: "ipad-settings-29@2x.png",     px: 58,   idiom: "ipad",          size: "29x29",     scale: "2x"),
        .init(filename: "ipad-spotlight-40@1x.png",    px: 40,   idiom: "ipad",          size: "40x40",     scale: "1x"),
        .init(filename: "ipad-spotlight-40@2x.png",    px: 80,   idiom: "ipad",          size: "40x40",     scale: "2x"),
        .init(filename: "ipad-76@1x.png",              px: 76,   idiom: "ipad",          size: "76x76",     scale: "1x"),
        .init(filename: "ipad-76@2x.png",              px: 152,  idiom: "ipad",          size: "76x76",     scale: "2x"),
        .init(filename: "ipad-pro-83.5@2x.png",        px: 167,  idiom: "ipad",          size: "83.5x83.5", scale: "2x"),
        .init(filename: "appstore-1024@1x.png",        px: 1024, idiom: "ios-marketing", size: "1024x1024", scale: "1x"),
    ]

    // ── Xcode Contents.json builder ───────────────────────────────────────────
    /// Returns the UTF-8 bytes of a valid Contents.json for AppIcon.appiconset.
    static func contentsJSON() -> Data {
        var lines: [String] = [
            "{",
            "  \"images\" : ["
        ]
        for (i, spec) in all.enumerated() {
            let comma = i < all.count - 1 ? "," : ""
            lines += [
                "    {",
                "      \"filename\" : \"\(spec.filename)\",",
                "      \"idiom\" : \"\(spec.idiom)\",",
                "      \"scale\" : \"\(spec.scale)\",",
                "      \"size\" : \"\(spec.size)\"",
                "    }\(comma)"
            ]
        }
        lines += [
            "  ],",
            "  \"info\" : {",
            "    \"author\" : \"xcode\",",
            "    \"version\" : 1",
            "  }",
            "}"
        ]
        return Data(lines.joined(separator: "\n").utf8)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MARK: - CRC-32  (pure Swift — ZIP spec requirement)
// ─────────────────────────────────────────────────────────────────────────────

private enum CRC32 {
    static let table: [UInt32] = (0..<256).map { i -> UInt32 in
        (0..<8).reduce(UInt32(i)) { c, _ in (c & 1) != 0 ? 0xEDB8_8320 ^ (c >> 1) : c >> 1 }
    }
    static func of(_ data: Data) -> UInt32 {
        data.reduce(0xFFFF_FFFF as UInt32) {
            table[Int(($0 ^ UInt32($1)) & 0xFF)] ^ ($0 >> 8)
        } ^ 0xFFFF_FFFF
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MARK: - Mini ZIP builder  (Store / no compression, pure Swift)
// ─────────────────────────────────────────────────────────────────────────────

private extension Data {
    mutating func le<T: FixedWidthInteger>(_ v: T) {
        var x = v.littleEndian; Swift.withUnsafeBytes(of: &x) { append(contentsOf: $0) }
    }
}

private enum MiniZip {
    struct Entry { let name: Data; let payload: Data; let crc: UInt32; let offset: UInt32 }

    static func build(_ files: [(name: String, data: Data)]) -> Data {
        var out = Data(); var entries: [Entry] = []

        for f in files {
            let n = Data(f.name.utf8); let crc = CRC32.of(f.data)
            let off = UInt32(out.count); let sz = UInt32(f.data.count)
            out.le(UInt32(0x0403_4B50)); out.le(UInt16(20)); out.le(UInt16(0))
            out.le(UInt16(0)); out.le(UInt16(0)); out.le(UInt16(0x5421))
            out.le(crc); out.le(sz); out.le(sz)
            out.le(UInt16(n.count)); out.le(UInt16(0))
            out.append(n); out.append(f.data)
            entries.append(Entry(name: n, payload: f.data, crc: crc, offset: off))
        }

        let cdStart = UInt32(out.count)
        for e in entries {
            let sz = UInt32(e.payload.count)
            out.le(UInt32(0x0201_4B50)); out.le(UInt16(20)); out.le(UInt16(20))
            out.le(UInt16(0)); out.le(UInt16(0)); out.le(UInt16(0)); out.le(UInt16(0x5421))
            out.le(e.crc); out.le(sz); out.le(sz)
            out.le(UInt16(e.name.count)); out.le(UInt16(0)); out.le(UInt16(0))
            out.le(UInt16(0)); out.le(UInt16(0)); out.le(UInt32(0))
            out.le(e.offset); out.append(e.name)
        }

        let cdSz = UInt32(out.count) - cdStart; let n = UInt16(entries.count)
        out.le(UInt32(0x0605_4B50)); out.le(UInt16(0)); out.le(UInt16(0))
        out.le(n); out.le(n); out.le(cdSz); out.le(cdStart); out.le(UInt16(0))
        return out
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MARK: - View model
// ─────────────────────────────────────────────────────────────────────────────

@MainActor
final class IconMakerVM: ObservableObject {

    enum Stage { case idle, generating, done, failed(String) }

    @Published var stage: Stage         = .idle
    @Published var sourceImage: UIImage?
    @Published var editedImage: UIImage?
    @Published var done  = 0
    @Published var zipURL: URL?
    @Published var includeContentsJSON  = false

    // ── Edit options ──────────────────────────────────────────────────────
    @Published var removeBackgroundEnabled = false
    @Published var removeColorHex = "#00FF00"                // default green
    @Published var removeTolerance: Double = 0.1             // 0.0–1.0

    @Published var resizeToSquareEnabled = false

    @Published var fillBackgroundEnabled = false
    @Published var fillColorHex = "#000000"

    @Published var zoomEnabled = false
    @Published var zoomScale: Double = 1.0   // 1.0 - 3.0

    let total = IconSpec.all.count

    // ── Step 1a — user picks from Photos (—————————————————————————————)
    func load(from selection: PhotosPickerItem?) {
        guard let selection else { return }
        Task {
            if let data = try? await selection.loadTransferable(type: Data.self),
               let img  = UIImage(data: data) {
                sourceImage = img
                editedImage = nil           // reset edits
                stage = .idle
                zipURL = nil
                done = 0
            }
        }
    }

    // ── Step 1b — file routed from "Open with OLED" / AppRouter —————————————
    func loadFromURL(_ url: URL) {
        guard let data = try? Data(contentsOf: url),
              let img  = UIImage(data: data) else { return }
        sourceImage = img
        editedImage = nil
        stage  = .idle
        zipURL = nil
        done   = 0
    }

    // ── Apply edits on‑demand (call from UI before generating) ────────────
    func applyEdits() {
        guard let src = sourceImage else { editedImage = nil; return }

        var img = src

        // 1. Remove background
        if removeBackgroundEnabled,
           let clean = Self.removeBackground(from: img,
                                             hexColor: removeColorHex,
                                             tolerance: CGFloat(removeTolerance)) {
            img = clean
        }

        // 2. Resize to square (centre crop)
        if resizeToSquareEnabled,
           let square = Self.cropToSquare(img) {
            img = square
        }

        // 3. Fill background
        if fillBackgroundEnabled,
           let filled = Self.fillBackground(of: img, hexColor: fillColorHex) {
            img = filled
        }

        // 4. Zoom (centre crop based on scale)
        if zoomEnabled,
           let zoomed = Self.zoom(image: img, scale: CGFloat(zoomScale)) {
            img = zoomed
        }

        editedImage = img
    }

    // ── Step 2 — resize every size & zip ─────────────────────────────────────
    func generate() {
        // Use edited image if available, otherwise original source
        guard let src = (editedImage ?? sourceImage),
              case .idle = stage else { return }
        stage = .generating; done = 0; zipURL = nil

        Task {
            do {
                var files: [(name: String, data: Data)] = []

                for spec in IconSpec.all {
                    let resized = try resize(src, to: spec.px)
                    guard let png = resized.pngData() else {
                        throw Err.pngFailed(spec.filename)
                    }
                    files.append((name: spec.filename, data: png))
                    done += 1
                }

                // Optionally bundle Contents.json for Xcode AppIcon.appiconset
                if includeContentsJSON {
                    files.append((name: "Contents.json", data: IconSpec.contentsJSON()))
                }

                let zip  = MiniZip.build(files)
                let dest = FileManager.default.temporaryDirectory
                               .appendingPathComponent("OLED-Icons.zip")
                try zip.write(to: dest, options: .atomic)
                zipURL = dest
                stage  = .done

            } catch {
                stage = .failed(error.localizedDescription)
            }
        }
    }

    // ── Resize helper ─────────────────────────────────────────────────────────
    private func resize(_ image: UIImage, to px: Int) throws -> UIImage {
        let size = CGSize(width: px, height: px)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1.0          // 1 pt == 1 px; avoids 2×/3× screen-scale inflation
        let renderer = UIGraphicsImageRenderer(size: size, format: format)
        return renderer.image { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }
    }

    // ── Edit helpers (static to avoid retain cycles) ─────────────────────────

    /// Make a square image by centre‑cropping the smaller side.
    private static func cropToSquare(_ image: UIImage) -> UIImage? {
        let originalSize = image.size
        let minSide = min(originalSize.width, originalSize.height)
        let square = CGRect(
            x: (originalSize.width - minSide) / 2,
            y: (originalSize.height - minSide) / 2,
            width: minSide,
            height: minSide
        )
        guard let cgImage = image.cgImage?.cropping(to: square) else { return nil }
        return UIImage(cgImage: cgImage, scale: image.scale, orientation: image.imageOrientation)
    }

    /// Remove all pixels that match a given hex colour (within tolerance).
    /// Tolerance is normalised (0.0 = exact, 1.0 = all colours).
    private static func removeBackground(from image: UIImage, hexColor: String, tolerance: CGFloat) -> UIImage? {
        guard let cgImage = image.cgImage else { return nil }

        let width = cgImage.width
        let height = cgImage.height
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        let bytesPerPixel = 4
        let bytesPerRow = bytesPerPixel * width
        let bitsPerComponent = 8
        var pixelData = [UInt8](repeating: 0, count: width * height * bytesPerPixel)

        guard let context = CGContext(
            data: &pixelData,
            width: width,
            height: height,
            bitsPerComponent: bitsPerComponent,
            bytesPerRow: bytesPerRow,
            space: colorSpace,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else { return nil }

        context.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))

        // Parse hex colour
        let (r, g, b) = Self.hexToRGB(hexColor) ?? (0, 0, 0)
        let maxDelta = UInt8(tolerance * 255.0)

        for i in stride(from: 0, to: pixelData.count, by: bytesPerPixel) {
            let ri = pixelData[i]      // R
            let gi = pixelData[i+1]    // G
            let bi = pixelData[i+2]    // B
            // alpha is at i+3 but we don't read it for matching

            if abs(Int(ri) - Int(r)) <= Int(maxDelta),
               abs(Int(gi) - Int(g)) <= Int(maxDelta),
               abs(Int(bi) - Int(b)) <= Int(maxDelta) {
                // Set fully transparent
                pixelData[i]   = 0
                pixelData[i+1] = 0
                pixelData[i+2] = 0
                pixelData[i+3] = 0
            }
        }

        guard let newCGImage = context.makeImage() else { return nil }
        return UIImage(cgImage: newCGImage, scale: image.scale, orientation: image.imageOrientation)
    }

    /// Fill a solid background colour behind an image (image may have transparency).
    private static func fillBackground(of image: UIImage, hexColor: String) -> UIImage? {
        let size = image.size
        let format = UIGraphicsImageRendererFormat()
        format.scale = image.scale
        let renderer = UIGraphicsImageRenderer(size: size, format: format)

        return renderer.image { ctx in
            let bgColor = Self.uiColorFromHex(hexColor) ?? .white
            bgColor.setFill()
            ctx.fill(CGRect(origin: .zero, size: size))

            image.draw(at: .zero)
        }
    }

    /// Zoom into the centre of the image by cropping to 1/scale of the original.
    private static func zoom(image: UIImage, scale: CGFloat) -> UIImage? {
        let size = image.size
        let cropSize = CGSize(width: size.width / scale, height: size.height / scale)
        let origin = CGPoint(x: (size.width - cropSize.width) / 2,
                             y: (size.height - cropSize.height) / 2)
        let cropRect = CGRect(origin: origin, size: cropSize)
        guard let cgImage = image.cgImage?.cropping(to: cropRect) else { return nil }
        return UIImage(cgImage: cgImage, scale: image.scale, orientation: image.imageOrientation)
    }

    // ── Colour utilities ───────────────────────────────────────────────────
    private static func hexToRGB(_ hex: String) -> (r: UInt8, g: UInt8, b: UInt8)? {
        var s = hex.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6,
              let num = UInt64(s, radix: 16) else { return nil }
        return (
            r: UInt8((num >> 16) & 0xFF),
            g: UInt8((num >> 8) & 0xFF),
            b: UInt8(num & 0xFF)
        )
    }

    private static func uiColorFromHex(_ hex: String) -> UIColor? {
        guard let (r, g, b) = hexToRGB(hex) else { return nil }
        return UIColor(red: CGFloat(r)/255, green: CGFloat(g)/255, blue: CGFloat(b)/255, alpha: 1)
    }

    enum Err: LocalizedError {
        case pngFailed(String)
        var errorDescription: String? {
            if case .pngFailed(let n) = self { return "PNG failed: \(n)" }
            return nil
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MARK: - IconMakerView
// ─────────────────────────────────────────────────────────────────────────────

struct IconMakerView: View {
    @StateObject private var vm = IconMakerVM()
    @EnvironmentObject private var router: AppRouter
    @State private var pickerItem: PhotosPickerItem?
    @State private var showShareSheet = false

    var body: some View {
        NavigationView {
            ZStack {
                OLEDTheme.background.ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 24) {

                        // ── Image picker ──────────────────────────────────
                        PhotosPicker(
                            selection: $pickerItem,
                            matching: .images,
                            photoLibrary: .shared()
                        ) {
                            pickerLabel
                        }
                        .onChange(of: pickerItem) { vm.load(from: $0) }
                        .onReceive(router.$pendingImageURL) { url in
                            guard let url else { return }
                            vm.loadFromURL(url)
                            router.pendingImageURL = nil
                        }

                        // ── Preview (shows edited image if available) ─────
                        if let img = vm.editedImage ?? vm.sourceImage {
                            Image(uiImage: img)
                                .resizable().scaledToFit()
                                .frame(width: 140, height: 140)
                                .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 28, style: .continuous)
                                        .strokeBorder(OLEDTheme.accent.opacity(0.5), lineWidth: 1.5)
                                )
                                .shadow(color: .cyan.opacity(0.35), radius: 20)
                        }

                        // ── Edit controls (NEW) ──────────────────────────
                        if vm.sourceImage != nil {
                            editsSection
                        }

                        // ── Status card ───────────────────────────────────
                        statusCard

                        // ── Contents.json toggle ──────────────────────────
                        if vm.sourceImage != nil {
                            contentsJSONToggle
                        }

                        // ── Action button ─────────────────────────────────
                        actionButton
                            .padding(.horizontal)
                            .disabled(vm.sourceImage == nil)
                    }
                    .padding(.vertical, 32)
                }
            }
            .navigationTitle("Icon Maker")
            .navigationBarTitleDisplayMode(.large)
            .sheet(isPresented: $showShareSheet) {
                if let url = vm.zipURL {
                    ShareSheet(url: url)
                }
            }
            .onChange(of: vm.zipURL) { url in
                if url != nil { showShareSheet = true }
            }
        }
    }

    // ── Picker label ──────────────────────────────────────────────────────────
    private var pickerLabel: some View {
        VStack(spacing: 10) {
            Image(systemName: vm.sourceImage == nil
                  ? "photo.badge.plus"
                  : "arrow.triangle.2.circlepath")
                .font(.system(size: 32))
                .foregroundColor(OLEDTheme.accent)

            Text(vm.sourceImage == nil ? "Pick your icon PNG" : "Pick a different image")
                .font(.subheadline).fontWeight(.medium)
                .foregroundColor(OLEDTheme.accent)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 20)
        .background(OLEDTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(
                    OLEDTheme.accent.opacity(0.35),
                    style: StrokeStyle(lineWidth: 1.5, dash: [6, 4])
                )
        )
        .padding(.horizontal)
    }

    // ── NEW: Edit controls section ───────────────────────────────────────────
    private var editsSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Edit Image")
                .font(.headline)
                .foregroundColor(OLEDTheme.textPrimary)

            // Remove Background
            Group {
                Toggle("Remove Background", isOn: $vm.removeBackgroundEnabled)
                    .tint(OLEDTheme.accent)
                if vm.removeBackgroundEnabled {
                    HStack {
                        Text("Color")
                            .font(.caption)
                            .foregroundColor(OLEDTheme.textSecondary)
                        TextField("#RRGGBB", text: $vm.removeColorHex)
                            .font(.caption2.monospaced())
                            .textFieldStyle(.roundedBorder)
                            .frame(width: 80)
                        Spacer()
                        VStack(alignment: .trailing, spacing: 2) {
                            Text("Tolerance: \(String(format: "%.0f%%", vm.removeTolerance * 100))")
                                .font(.caption2)
                                .foregroundColor(OLEDTheme.textSecondary)
                            Slider(value: $vm.removeTolerance, in: 0...1, step: 0.01)
                                .tint(OLEDTheme.accent)
                                .frame(width: 140)
                        }
                    }
                }
            }

            // Resize to Square
            Toggle("Resize to Square (centre crop)", isOn: $vm.resizeToSquareEnabled)
                .tint(OLEDTheme.accent)

            // Fill Background
            Group {
                Toggle("Fill Background", isOn: $vm.fillBackgroundEnabled)
                    .tint(OLEDTheme.accent)
                if vm.fillBackgroundEnabled {
                    HStack {
                        Text("Color")
                            .font(.caption)
                            .foregroundColor(OLEDTheme.textSecondary)
                        TextField("#RRGGBB", text: $vm.fillColorHex)
                            .font(.caption2.monospaced())
                            .textFieldStyle(.roundedBorder)
                            .frame(width: 80)
                        Spacer()
                    }
                }
            }

            // Zoom
            Group {
                Toggle("Zoom", isOn: $vm.zoomEnabled)
                    .tint(OLEDTheme.accent)
                if vm.zoomEnabled {
                    HStack {
                        Text("Scale: \(String(format: "%.1fx", vm.zoomScale))")
                            .font(.caption)
                            .foregroundColor(OLEDTheme.textSecondary)
                        Slider(value: $vm.zoomScale, in: 1.0...3.0, step: 0.1)
                            .tint(OLEDTheme.accent)
                    }
                }
            }

            // Preview / Apply button
            Button {
                vm.applyEdits()
            } label: {
                Label("Preview Edits", systemImage: "eye")
                    .font(.caption).fontWeight(.medium)
            }
            .buttonStyle(.bordered)
            .tint(OLEDTheme.accent)
            .disabled(!(vm.removeBackgroundEnabled || vm.resizeToSquareEnabled || vm.fillBackgroundEnabled || vm.zoomEnabled))
        }
        .padding()
        .background(OLEDTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .padding(.horizontal)
    }

    // ── Status card ───────────────────────────────────────────────────────────
    @ViewBuilder
    private var statusCard: some View {
        VStack(spacing: 12) {
            switch vm.stage {

            case .idle:
                if vm.sourceImage != nil {
                    Text("Ready to generate \(vm.total) sizes")
                        .font(.callout)
                        .foregroundColor(OLEDTheme.textSecondary)
                    sizeGrid
                } else {
                    Text("Pick a PNG or JPG above to get started.\nIt will be resized to all \(vm.total) required\niOS & iPadOS icon sizes.")
                        .font(.callout)
                        .multilineTextAlignment(.center)
                        .foregroundColor(OLEDTheme.textSecondary)
                }

            case .generating:
                ProgressView(value: Double(vm.done), total: Double(vm.total))
                    .tint(OLEDTheme.accent)
                    .padding(.horizontal)
                Text("Generating \(vm.done) / \(vm.total)…")
                    .font(.caption)
                    .foregroundColor(OLEDTheme.textSecondary)

            case .done:
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 40))
                    .foregroundColor(OLEDTheme.success)
                Text("OLED-Icons.zip ready")
                    .font(.headline)
                    .foregroundColor(OLEDTheme.textPrimary)
                Text("\(vm.total) PNGs\(vm.includeContentsJSON ? " + Contents.json" : "") · save to Files, AirDrop, Mail…")
                    .font(.caption)
                    .foregroundColor(OLEDTheme.textSecondary)

            case .failed(let msg):
                Image(systemName: "xmark.octagon.fill")
                    .font(.system(size: 40))
                    .foregroundColor(OLEDTheme.error)
                Text("Something went wrong")
                    .font(.headline).foregroundColor(OLEDTheme.error)
                Text(msg).font(.caption2)
                    .multilineTextAlignment(.center)
                    .foregroundColor(OLEDTheme.textSecondary)
            }
        }
        .frame(maxWidth: .infinity)
        .padding()
        .background(OLEDTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .padding(.horizontal)
    }

    // Small grid showing all output pixel sizes
    private var sizeGrid: some View {
        let cols = [GridItem(.adaptive(minimum: 70), spacing: 8)]
        return LazyVGrid(columns: cols, spacing: 8) {
            ForEach(IconSpec.all, id: \.filename) { spec in
                Text("\(spec.px)px")
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundColor(
                        vm.done > (IconSpec.all.firstIndex(where: { $0.filename == spec.filename }) ?? 99)
                        ? OLEDTheme.success
                        : OLEDTheme.textSecondary
                    )
                    .padding(.horizontal, 6).padding(.vertical, 4)
                    .background(OLEDTheme.surfaceSecondary)
                    .clipShape(RoundedRectangle(cornerRadius: 6))
            }
        }
    }

    // ── Contents.json toggle ──────────────────────────────────────────────────
    private var contentsJSONToggle: some View {
        Toggle(isOn: $vm.includeContentsJSON) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Include Contents.json")
                    .font(.subheadline).fontWeight(.medium)
                    .foregroundColor(OLEDTheme.textPrimary)
                Text("Adds the Xcode asset-catalog manifest so you can drop the ZIP straight into AppIcon.appiconset")
                    .font(.caption)
                    .foregroundColor(OLEDTheme.textSecondary)
            }
        }
        .tint(OLEDTheme.accent)
        .padding()
        .background(OLEDTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .padding(.horizontal)
    }

    // ── Action button ─────────────────────────────────────────────────────────
    @ViewBuilder
    private var actionButton: some View {
        switch vm.stage {

        case .idle, .failed:
            Button { vm.generate() } label: {
                Label("Generate & ZIP", systemImage: "zipper.clip")
                    .fontWeight(.semibold)
                    .frame(maxWidth: .infinity).padding()
                    .background(vm.sourceImage == nil
                                ? OLEDTheme.accent.opacity(0.3)
                                : OLEDTheme.accent)
                    .foregroundColor(.black)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }

        case .generating:
            HStack {
                ProgressView().tint(.black).scaleEffect(0.8)
                Text("Working…").fontWeight(.semibold)
            }
            .frame(maxWidth: .infinity).padding()
            .background(OLEDTheme.accent.opacity(0.4))
            .foregroundColor(.black)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))

        case .done:
            Button { showShareSheet = true } label: {
                Label("Save ZIP to Files / AirDrop…", systemImage: "square.and.arrow.up")
                    .fontWeight(.semibold)
                    .frame(maxWidth: .infinity).padding()
                    .background(OLEDTheme.success)
                    .foregroundColor(.black)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MARK: - Share sheet bridge
// ─────────────────────────────────────────────────────────────────────────────

struct ShareSheet: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [url], applicationActivities: nil)
    }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}
