export type PlatformId = "ios" | "universal" | "mac" | "watch" | "android" | "web";

export type PackImage = {
  /** Path inside the pack directory, using forward slashes. */
  filename: string;
  px: number;
  /** Present for Xcode asset-catalog slots. Values are strings. */
  slot?: Record<string, string>;
};

export type Pack = {
  id: PlatformId;
  label: string;
  blurb: string;
  dir: string;
  apple: boolean;
  images: PackImage[];
};

function slot(
  filename: string,
  px: number,
  fields: Record<string, string>,
): PackImage {
  return { filename, px, slot: { filename, ...fields } };
}

const IOS: PackImage[] = [
  slot("notification-20@2x.png", 40, { idiom: "iphone", scale: "2x", size: "20x20" }),
  slot("notification-20@3x.png", 60, { idiom: "iphone", scale: "3x", size: "20x20" }),
  slot("settings-29@1x.png", 29, { idiom: "iphone", scale: "1x", size: "29x29" }),
  slot("settings-29@2x.png", 58, { idiom: "iphone", scale: "2x", size: "29x29" }),
  slot("settings-29@3x.png", 87, { idiom: "iphone", scale: "3x", size: "29x29" }),
  slot("spotlight-40@2x.png", 80, { idiom: "iphone", scale: "2x", size: "40x40" }),
  slot("spotlight-40@3x.png", 120, { idiom: "iphone", scale: "3x", size: "40x40" }),
  slot("iphone-60@2x.png", 120, { idiom: "iphone", scale: "2x", size: "60x60" }),
  slot("iphone-60@3x.png", 180, { idiom: "iphone", scale: "3x", size: "60x60" }),
  slot("ipad-notification-20@1x.png", 20, { idiom: "ipad", scale: "1x", size: "20x20" }),
  slot("ipad-notification-20@2x.png", 40, { idiom: "ipad", scale: "2x", size: "20x20" }),
  slot("ipad-settings-29@1x.png", 29, { idiom: "ipad", scale: "1x", size: "29x29" }),
  slot("ipad-settings-29@2x.png", 58, { idiom: "ipad", scale: "2x", size: "29x29" }),
  slot("ipad-spotlight-40@1x.png", 40, { idiom: "ipad", scale: "1x", size: "40x40" }),
  slot("ipad-spotlight-40@2x.png", 80, { idiom: "ipad", scale: "2x", size: "40x40" }),
  slot("ipad-76@1x.png", 76, { idiom: "ipad", scale: "1x", size: "76x76" }),
  slot("ipad-76@2x.png", 152, { idiom: "ipad", scale: "2x", size: "76x76" }),
  slot("ipad-pro-83.5@2x.png", 167, { idiom: "ipad", scale: "2x", size: "83.5x83.5" }),
  slot("appstore-1024@1x.png", 1024, { idiom: "ios-marketing", scale: "1x", size: "1024x1024" }),
];

const MAC_SIZES: [string, string, number][] = [
  ["16x16", "1x", 16],
  ["16x16", "2x", 32],
  ["32x32", "1x", 32],
  ["32x32", "2x", 64],
  ["128x128", "1x", 128],
  ["128x128", "2x", 256],
  ["256x256", "1x", 256],
  ["256x256", "2x", 512],
  ["512x512", "1x", 512],
  ["512x512", "2x", 1024],
];

function watch(
  filename: string,
  px: number,
  size: string,
  scale: string,
  extra: Record<string, string>,
): PackImage {
  return slot(filename, px, { idiom: "watch", scale, size, ...extra });
}

export const PACKS: Pack[] = [
  {
    id: "ios",
    label: "iPhone & iPad",
    blurb: "All 19 classic slots, including the App Store 1024.",
    dir: "ios/AppIcon.appiconset",
    apple: true,
    images: IOS,
  },
  {
    id: "universal",
    label: "iOS single",
    blurb: "One 1024. Current Xcode derives the rest.",
    dir: "ios-single/AppIcon.appiconset",
    apple: true,
    images: [
      slot("appstore-1024.png", 1024, {
        idiom: "universal",
        platform: "ios",
        scale: "1x",
        size: "1024x1024",
      }),
    ],
  },
  {
    id: "mac",
    label: "Mac",
    blurb: "16 through 1024 for a Mac AppIcon set.",
    dir: "macos/AppIcon.appiconset",
    apple: true,
    images: MAC_SIZES.map(([size, scale, px]) =>
      slot(`mac-${size.split("x")[0]}@${scale}.png`, px, { idiom: "mac", scale, size }),
    ),
  },
  {
    id: "watch",
    label: "Watch",
    blurb: "Notification, launcher, quick look, and marketing.",
    dir: "watch/AppIcon.appiconset",
    apple: true,
    images: [
      watch("notification-24@2x.png", 48, "24x24", "2x", {
        role: "notificationCenter",
        subtype: "38mm",
      }),
      watch("notification-27.5@2x.png", 55, "27.5x27.5", "2x", {
        role: "notificationCenter",
        subtype: "42mm",
      }),
      watch("settings-29@2x.png", 58, "29x29", "2x", { role: "companionSettings" }),
      watch("settings-29@3x.png", 87, "29x29", "3x", { role: "companionSettings" }),
      watch("launcher-40@2x.png", 80, "40x40", "2x", { role: "appLauncher", subtype: "38mm" }),
      watch("launcher-44@2x.png", 88, "44x44", "2x", { role: "appLauncher", subtype: "40mm" }),
      watch("launcher-46@2x.png", 92, "46x46", "2x", { role: "appLauncher", subtype: "41mm" }),
      watch("launcher-50@2x.png", 100, "50x50", "2x", { role: "appLauncher", subtype: "44mm" }),
      watch("launcher-51@2x.png", 102, "51x51", "2x", { role: "appLauncher", subtype: "45mm" }),
      watch("launcher-54@2x.png", 108, "54x54", "2x", { role: "appLauncher", subtype: "49mm" }),
      watch("quicklook-86@2x.png", 172, "86x86", "2x", { role: "quickLook", subtype: "38mm" }),
      watch("quicklook-98@2x.png", 196, "98x98", "2x", { role: "quickLook", subtype: "42mm" }),
      watch("quicklook-108@2x.png", 216, "108x108", "2x", { role: "quickLook", subtype: "44mm" }),
      watch("quicklook-117@2x.png", 234, "117x117", "2x", { role: "quickLook", subtype: "45mm" }),
      watch("quicklook-129@2x.png", 258, "129x129", "2x", { role: "quickLook", subtype: "49mm" }),
      slot("watch-marketing-1024.png", 1024, {
        idiom: "watch-marketing",
        scale: "1x",
        size: "1024x1024",
      }),
    ],
  },
  {
    id: "android",
    label: "Android",
    blurb: "mdpi through xxxhdpi, plus the 512 Play listing.",
    dir: "android",
    apple: false,
    images: [
      { filename: "mipmap-mdpi/ic_launcher.png", px: 48 },
      { filename: "mipmap-hdpi/ic_launcher.png", px: 72 },
      { filename: "mipmap-xhdpi/ic_launcher.png", px: 96 },
      { filename: "mipmap-xxhdpi/ic_launcher.png", px: 144 },
      { filename: "mipmap-xxxhdpi/ic_launcher.png", px: 192 },
      { filename: "playstore-512.png", px: 512 },
    ],
  },
  {
    id: "web",
    label: "Web",
    blurb: "Favicon, apple touch icon, and PWA 192 / 512.",
    dir: "web",
    apple: false,
    images: [
      { filename: "favicon-16.png", px: 16 },
      { filename: "favicon-32.png", px: 32 },
      { filename: "favicon-48.png", px: 48 },
      { filename: "apple-touch-icon.png", px: 180 },
      { filename: "icon-192.png", px: 192 },
      { filename: "icon-512.png", px: 512 },
    ],
  },
];

export const PACK_BY_ID: Record<PlatformId, Pack> = Object.fromEntries(
  PACKS.map((pack) => [pack.id, pack]),
) as Record<PlatformId, Pack>;

const SLOT_KEY_ORDER = [
  "filename",
  "idiom",
  "platform",
  "role",
  "subtype",
  "scale",
  "size",
];

export function contentsJSON(images: PackImage[]): string {
  const blocks = images.map((image, index) => {
    const fields = image.slot ?? {};
    const lines = SLOT_KEY_ORDER.filter((key) => fields[key] !== undefined).map(
      (key) => `      "${key}" : "${fields[key]}"`,
    );
    const comma = index < images.length - 1 ? "," : "";
    return `    {\n${lines.join(",\n")}\n    }${comma}`;
  });
  return [
    "{",
    '  "images" : [',
    blocks.join("\n"),
    "  ],",
    '  "info" : {',
    '    "author" : "xcode",',
    '    "version" : 1',
    "  }",
    "}",
    "",
  ].join("\n");
}

export function readme(selected: PlatformId[]): string {
  const lines = [
    "OLED Icon Maker",
    "",
    "Squares are full-bleed. iOS, iPadOS, and watchOS apply the system mask —",
    "do not pre-round the artwork. The App Store marketing icon must be opaque.",
    "",
  ];
  if (selected.includes("ios")) {
    lines.push(
      "ios/AppIcon.appiconset",
      "  Classic iPhone and iPad set. Drop the folder into Assets.xcassets,",
      "  replacing the existing AppIcon.appiconset.",
      "",
    );
  }
  if (selected.includes("universal")) {
    lines.push(
      "ios-single/AppIcon.appiconset",
      "  Single 1024 for a modern iOS icon (Xcode single-size mode).",
      "",
    );
  }
  if (selected.includes("mac")) {
    lines.push("macos/AppIcon.appiconset", "  Mac icon set, 16pt through 512pt @2x.", "");
  }
  if (selected.includes("watch")) {
    lines.push("watch/AppIcon.appiconset", "  Apple Watch icon set.", "");
  }
  if (selected.includes("android")) {
    lines.push(
      "android/",
      "  Legacy launcher densities plus playstore-512.png.",
      "",
    );
  }
  if (selected.includes("web")) {
    lines.push(
      "web/",
      "  favicon.ico, PNG favicons, apple-touch-icon.png, icon-192.png, icon-512.png.",
      "",
    );
  }
  return lines.join("\n");
}

export type ExportJob = {
  path: string;
  px: number;
};

export function jobsFor(selected: PlatformId[]): ExportJob[] {
  const jobs: ExportJob[] = [];
  for (const id of selected) {
    const pack = PACK_BY_ID[id];
    for (const image of pack.images) {
      jobs.push({ path: `${pack.dir}/${image.filename}`, px: image.px });
    }
  }
  return jobs;
}
