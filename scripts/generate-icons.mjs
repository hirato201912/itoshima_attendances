import sharp from "sharp";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const src = path.join(root, "public", "orange_right.jpg");
const publicDir = path.join(root, "public");

async function makeIcon({ size, padPercent, outName, background = "#ffffff" }) {
  const innerSize = Math.round(size * (1 - padPercent * 2));
  const fitted = await sharp(src)
    .resize(innerSize, innerSize, { fit: "contain", background })
    .toBuffer();
  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background,
    },
  })
    .composite([{ input: fitted, gravity: "center" }])
    .png()
    .toFile(path.join(publicDir, outName));
  console.log("wrote", outName, size + "x" + size);
}

await makeIcon({ size: 192, padPercent: 0.05, outName: "icon-192.png" });
await makeIcon({ size: 512, padPercent: 0.05, outName: "icon-512.png" });
await makeIcon({ size: 180, padPercent: 0.05, outName: "apple-touch-icon.png" });
await makeIcon({ size: 512, padPercent: 0.12, outName: "icon-maskable-512.png" });
