"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input, Button } from "@/app/_components/ui";
import { loginWithNamePassword } from "@/lib/db";
import { useAuth } from "@/app/providers";
import { errorMessage } from "@/lib/error";

export default function LoginPage() {
  const router = useRouter();
  const { setUser } = useAuth();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onLogin() {
    setError(null);
    setBusy(true);
    try {
      const u = await loginWithNamePassword(name.trim(), password);
      if (!u) {
        setError("Name oder Passwort falsch.");
        return;
      }
      setUser(u);
      router.replace("/");
    } catch (e: unknown) {
      setError(errorMessage(e, "Login fehlgeschlagen."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex-1 flex flex-col">
      <div className="w-full px-4 pt-10">
        <h1 className="text-3xl font-extrabold tracking-tight">Fridge Stock</h1>
        <p className="mt-2 text-[15px] text-[#2c2c2c]/80">
          Schnell einloggen, dann scannen und Mengen speichern.
        </p>
      </div>

      <div className="w-full px-4 pt-6">
        <div className="rounded-3xl border border-black/10 bg-white p-5 shadow-sm">
          <label className="text-[15px] font-semibold text-[#2c2c2c]">Name</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="z.B. Sebastian"
            autoComplete="username"
            className="mt-2"
          />

          <label className="mt-4 block text-[15px] font-semibold text-[#2c2c2c]">
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
            disabled={busy || !name.trim() || !password}
          >
            {busy ? "Login..." : "Login"}
          </Button>
        </div>
      </div>
    </div>
  );
}

