import { ImageResponse } from "next/og";
import fs from "node:fs/promises";
import path from "node:path";

export function generateImageMetadata() {
  return [
    {
      id: "192",
      contentType: "image/png",
      size: { width: 192, height: 192 },
    },
    {
      id: "512",
      contentType: "image/png",
      size: { width: 512, height: 512 },
    },
  ];
}

export default async function Icon({ id }: { id: Promise<string | number> }) {
  const iconId = await id;
  const s = typeof iconId === "number" ? iconId : Number(iconId);
  const size = Number.isFinite(s) ? s : 512;

  const png = await fs.readFile(path.join(process.cwd(), "public", "logo.png"));
  const dataUrl = `data:image/png;base64,${png.toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "transparent",
        }}
      >
        <img
          src={dataUrl}
          width={size}
          height={size}
          alt=""
          style={{ width: size, height: size, objectFit: "contain" }}
        />
      </div>
    ),
    { width: size, height: size }
  );
}

