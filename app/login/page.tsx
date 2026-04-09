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
    <div className="flex-1 flex flex-col bg-zinc-50">
      <div className="mx-auto w-full max-w-md px-5 pt-14">
        <h1 className="text-3xl font-extrabold tracking-tight">Fridge Stock</h1>
        <p className="mt-2 text-zinc-600">
          Schnell einloggen, dann scannen und Mengen speichern.
        </p>
      </div>

      <div className="mx-auto w-full max-w-md px-5 pt-8">
        <div className="rounded-2xl border border-zinc-200 bg-white p-5">
          <label className="text-sm font-semibold text-zinc-700">Name</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="z.B. Sebastian"
            autoComplete="username"
            className="mt-2"
          />

          <label className="mt-4 block text-sm font-semibold text-zinc-700">
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
            <div className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <Button
            className="mt-5 w-full"
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

