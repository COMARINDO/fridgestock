import { ImageResponse } from "next/og";

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

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0b0f0e",
          color: "white",
          fontWeight: 800,
          fontSize: Math.round(size * 0.42),
          letterSpacing: Math.round(size * -0.02),
          borderRadius: Math.round(size * 0.18),
        }}
      >
        B
      </div>
    ),
    { width: size, height: size }
  );
}

