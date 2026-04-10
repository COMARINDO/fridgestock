"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Input, Button } from "@/app/_components/ui";
import { listLocations } from "@/lib/db";
import { useAuth } from "@/app/providers";
import { errorMessage } from "@/lib/error";
import type { Location } from "@/lib/types";

export default function LoginPage() {
  const router = useRouter();
  const { setLocation } = useAuth();
  const [locations, setLocations] = useState<Location[]>([]);
  const [selected, setSelected] = useState<Location | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const all = await listLocations();
        setLocations(all.filter((l) => !l.parent_id));
      } catch (e: unknown) {
        setError(errorMessage(e, "Konnte Platzerl nicht laden."));
      }
    })();
  }, []);

  const sorted = useMemo(
    () => [...locations].sort((a, b) => a.name.localeCompare(b.name)),
    [locations]
  );

  async function onLogin() {
    setError(null);
    setBusy(true);
    try {
      if (!selected) {
        setError("Bitte Platzerl auswählen.");
        return;
      }
      if (password !== "1234") {
        setError("Passwort falsch.");
        return;
      }
      setLocation({ location_id: selected.id });
      router.replace("/");
    } catch (e: unknown) {
      setError(errorMessage(e, "Login fehlgeschlagen."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex-1 flex flex-col">
      <div className="w-full px-4 pt-8">
        <div className="flex items-center gap-3">
          <Image src="/logo.png" alt="Bstand" width={40} height={40} />
          <h1 className="text-3xl font-black tracking-tight text-black">Bstand</h1>
        </div>
        <p className="mt-2 text-[15px] text-black">
          Platzerl wählen, Passwort eingeben, los.
        </p>
      </div>

      <div className="w-full px-4 pt-6">
        <div className="rounded-3xl border-2 border-black bg-white p-5 shadow-sm">
          <div className="text-[15px] font-extrabold text-black">Platzerl</div>
          <div className="mt-3 grid gap-2">
            {sorted.map((l) => {
              const active = selected?.id === l.id;
              return (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => setSelected(l)}
                  className={[
                    "w-full rounded-2xl border-2 px-4 py-4 text-left text-[18px] font-black",
                    "active:scale-[0.99]",
                    active
                      ? "border-black bg-black text-white"
                      : "border-black bg-white text-black",
                  ].join(" ")}
                >
                  {l.name}
                </button>
              );
            })}
            {sorted.length === 0 ? (
              <div className="text-[15px] text-[#1a1a1a]">
                Keine Platzerl gefunden.
              </div>
            ) : null}
          </div>

          <label className="mt-5 block text-[15px] font-extrabold text-black">
            Passwort
          </label>
          <Input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            type="password"
            autoComplete="current-password"
            className="mt-2"
            onKeyDown={(e) => {
              if (e.key === "Enter") onLogin();
            }}
          />

          {error ? (
            <div className="mt-3 rounded-2xl bg-red-50 px-4 py-3 text-[15px] text-red-800">
              {error}
            </div>
          ) : null}

          <Button
            className="mt-5"
            onClick={onLogin}
            disabled={busy || !selected || !password}
          >
            {busy ? "Login…" : "Login"}
          </Button>
        </div>
      </div>
    </div>
  );
}

