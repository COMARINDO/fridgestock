"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Button, ButtonSecondary } from "@/app/_components/ui";

type Step = "product" | "quantity" | "name" | "phone" | "pickup_time" | "location";

type ChatLocation = { id: string; name: string };

type Message =
  | { id: string; role: "bot"; text: string }
  | { id: string; role: "user"; text: string };

type OrderState = {
  product: string;
  quantity: number | null;
  name: string;
  phone: string;
  pickup_time: string;
  location_id: string;
  locationName: string;
};

const EMPTY_STATE: OrderState = {
  product: "",
  quantity: null,
  name: "",
  phone: "",
  pickup_time: "",
  location_id: "",
  locationName: "",
};

const STATIC_FALLBACK: Record<Step, string> = {
  product: "Hallo! Was möchtest du gerne bestellen?",
  quantity: "Wie viele Stück hättest du gerne?",
  name: "Auf welchen Namen soll die Bestellung laufen?",
  phone: "Unter welcher Telefonnummer können wir dich erreichen?",
  pickup_time:
    "Wann möchtest du abholen? (z. B. „morgen 14:00“ oder „Freitag Vormittag“)",
  location: "Letzte Frage: In welcher Filiale möchtest du abholen?",
};

const ORDER: Step[] = ["product", "quantity", "name", "phone", "pickup_time", "location"];

function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function nextStep(current: Step): Step | "done" {
  const idx = ORDER.indexOf(current);
  if (idx < 0 || idx >= ORDER.length - 1) return "done";
  return ORDER[idx + 1];
}

export default function CustomerOrderPage() {
  const [state, setState] = useState<OrderState>(EMPTY_STATE);
  const [step, setStep] = useState<Step | "summary" | "done">("product");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [locations, setLocations] = useState<ChatLocation[]>([]);
  const [loadingPrompt, setLoadingPrompt] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultId, setResultId] = useState<string | null>(null);
  const initialized = useRef(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/customer-order/locations", { cache: "no-store" });
        const data = (await res.json()) as { ok: boolean; locations?: ChatLocation[] };
        if (data.ok && data.locations) setLocations(data.locations);
      } catch {
        /* still allow input flow until location step */
      }
    })();
  }, []);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    void askPrompt("product", EMPTY_STATE);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, step]);

  async function askPrompt(s: Step, ctx: OrderState) {
    setLoadingPrompt(true);
    let text = STATIC_FALLBACK[s];
    try {
      const res = await fetch("/api/customer-order/prompt", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          step: s,
          context: {
            product: ctx.product || undefined,
            quantity: ctx.quantity ?? undefined,
            name: ctx.name || undefined,
            phone: ctx.phone || undefined,
            pickup_time: ctx.pickup_time || undefined,
            locationName: ctx.locationName || undefined,
          },
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { ok: boolean; text?: string };
        if (data.ok && data.text) text = data.text;
      }
    } catch {
      /* keep fallback */
    } finally {
      setLoadingPrompt(false);
    }
    setMessages((prev) => [...prev, { id: uid(), role: "bot", text }]);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function pushUser(text: string) {
    setMessages((prev) => [...prev, { id: uid(), role: "user", text }]);
  }

  function pushBot(text: string) {
    setMessages((prev) => [...prev, { id: uid(), role: "bot", text }]);
  }

  function handleSubmitInput() {
    if (step === "summary" || step === "done") return;
    const value = input.trim();
    if (!value) return;
    setError(null);

    if (step === "quantity") {
      const n = Number.parseInt(value.replace(/[^\d-]/g, ""), 10);
      if (!Number.isFinite(n) || n <= 0 || n > 9999) {
        setError("Bitte eine gültige Stückzahl eingeben (1–9999).");
        return;
      }
      pushUser(String(n));
      const updated = { ...state, quantity: n };
      setState(updated);
      setInput("");
      void advance("quantity", updated);
      return;
    }

    if (step === "phone") {
      const cleaned = value.replace(/[^+0-9()\s\-/.]/g, "");
      if (cleaned.length < 4) {
        setError("Telefonnummer scheint zu kurz.");
        return;
      }
      pushUser(value);
      const updated = { ...state, phone: cleaned };
      setState(updated);
      setInput("");
      void advance("phone", updated);
      return;
    }

    pushUser(value);
    const updated: OrderState = { ...state };
    if (step === "product") updated.product = value;
    if (step === "name") updated.name = value;
    if (step === "pickup_time") updated.pickup_time = value;
    setState(updated);
    setInput("");
    void advance(step, updated);
  }

  async function advance(from: Step, ctx: OrderState) {
    const ns = nextStep(from);
    if (ns === "done") {
      setStep("summary");
      pushBot("Danke! Hier deine Zusammenfassung:");
      return;
    }
    setStep(ns);
    await askPrompt(ns, ctx);
  }

  function handleLocationPick(loc: ChatLocation) {
    if (step !== "location") return;
    pushUser(loc.name);
    const updated: OrderState = {
      ...state,
      location_id: loc.id,
      locationName: loc.name,
    };
    setState(updated);
    void advance("location", updated);
  }

  async function submitOrder() {
    if (submitting || resultId) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/customer-order", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          product: state.product,
          quantity: state.quantity,
          name: state.name,
          phone: state.phone,
          pickup_time: state.pickup_time,
          location_id: state.location_id,
        }),
      });
      const data = (await res.json()) as { ok: boolean; id?: string; error?: string };
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Bestellung konnte nicht gespeichert werden.");
      }
      setResultId(data.id ?? "ok");
      setStep("done");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Bestellung fehlgeschlagen.");
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setState(EMPTY_STATE);
    setStep("product");
    setMessages([]);
    setInput("");
    setError(null);
    setResultId(null);
    initialized.current = false;
    setTimeout(() => {
      initialized.current = true;
      void askPrompt("product", EMPTY_STATE);
    }, 50);
  }

  const placeholder = useMemo(() => {
    switch (step) {
      case "product":
        return "z. B. Vollkornbrot";
      case "quantity":
        return "Anzahl Stück";
      case "name":
        return "Vor- und Nachname";
      case "phone":
        return "z. B. +43 660 1234567";
      case "pickup_time":
        return "z. B. morgen 14:00";
      default:
        return "";
    }
  }, [step]);

  const showInput = step !== "location" && step !== "summary" && step !== "done";

  return (
    <div className="flex-1 flex flex-col min-h-screen bg-[#fff7ee]">
      <header className="px-4 pt-5 pb-3 border-b border-black/10 flex items-center gap-3 bg-white">
        <Link
          href="/login"
          className="rounded-full border border-black/15 bg-white px-3 py-1 text-[13px] font-semibold text-black/70 hover:bg-black/5"
        >
          ← Zurück
        </Link>
        <div className="flex items-center gap-2 ml-1">
          <Image
            src="/logo.png"
            alt="Ordarella"
            width={32}
            height={32}
            className="h-8 w-8 rounded-xl object-contain"
          />
          <h1 className="text-[18px] font-black tracking-tight">Bestellung aufgeben</h1>
        </div>
      </header>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-5 space-y-3"
      >
        {messages.map((m) => (
          <div
            key={m.id}
            className={
              m.role === "bot"
                ? "max-w-[82%] rounded-2xl rounded-bl-sm bg-white border border-black/10 px-4 py-3 text-[15px] text-black shadow-sm"
                : "max-w-[82%] ml-auto rounded-2xl rounded-br-sm bg-black text-white px-4 py-3 text-[15px] shadow-sm"
            }
          >
            {m.text}
          </div>
        ))}
        {loadingPrompt ? (
          <div className="max-w-[60%] rounded-2xl rounded-bl-sm bg-white border border-black/10 px-4 py-3 text-[15px] text-black/40 shadow-sm">
            …
          </div>
        ) : null}

        {step === "location" ? (
          <div className="pt-1">
            <div className="text-[12px] font-bold uppercase tracking-wider text-black/50 mb-2">
              Filiale wählen
            </div>
            <div className="grid grid-cols-1 gap-2">
              {locations.length === 0 ? (
                <div className="text-[14px] text-black/50">
                  Filialen werden geladen…
                </div>
              ) : (
                locations.map((l) => (
                  <button
                    key={l.id}
                    onClick={() => handleLocationPick(l)}
                    className="rounded-2xl border-2 border-black bg-white px-4 py-3 text-left text-[16px] font-extrabold text-black hover:bg-black/5 active:scale-[0.99]"
                  >
                    {l.name}
                  </button>
                ))
              )}
            </div>
          </div>
        ) : null}

        {step === "summary" ? (
          <div className="rounded-3xl border-2 border-black bg-white p-5 shadow-sm space-y-3">
            <div className="text-[12px] font-bold uppercase tracking-wider text-black/50">
              Zusammenfassung
            </div>
            <SummaryRow label="Produkt" value={state.product} />
            <SummaryRow label="Menge" value={`${state.quantity ?? "?"} Stück`} />
            <SummaryRow label="Name" value={state.name} />
            <SummaryRow label="Telefon" value={state.phone} />
            <SummaryRow label="Abholzeit" value={state.pickup_time} />
            <SummaryRow label="Filiale" value={state.locationName} />
            {error ? (
              <div className="rounded-2xl bg-red-50 px-4 py-3 text-[14px] text-red-800">
                {error}
              </div>
            ) : null}
            <div className="grid grid-cols-1 gap-2 pt-1">
              <Button onClick={submitOrder} disabled={submitting}>
                {submitting ? "Wird gesendet…" : "Bestellung bestätigen"}
              </Button>
              <ButtonSecondary onClick={reset} disabled={submitting}>
                Neu starten
              </ButtonSecondary>
            </div>
          </div>
        ) : null}

        {step === "done" ? (
          <div className="rounded-3xl border-2 border-black bg-white p-5 shadow-sm space-y-3">
            <div className="text-[20px] font-black">Danke!</div>
            <div className="text-[15px] text-black/70">
              Deine Bestellung wurde übermittelt. Wir melden uns bei Rückfragen
              unter <span className="font-bold">{state.phone}</span>.
            </div>
            <div className="grid grid-cols-1 gap-2 pt-1">
              <ButtonSecondary onClick={reset}>Neue Bestellung</ButtonSecondary>
              <Link
                href="/login"
                className="block w-full text-center rounded-2xl border-2 border-black bg-white px-5 py-4 text-[17px] font-extrabold text-black"
              >
                Zur Startseite
              </Link>
            </div>
          </div>
        ) : null}
      </div>

      {showInput ? (
        <div className="border-t border-black/10 bg-white px-4 py-3">
          {error ? (
            <div className="mb-2 rounded-2xl bg-red-50 px-4 py-2 text-[14px] text-red-800">
              {error}
            </div>
          ) : null}
          <div className="flex gap-2">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={placeholder}
              inputMode={step === "quantity" ? "numeric" : step === "phone" ? "tel" : "text"}
              autoComplete={step === "phone" ? "tel" : step === "name" ? "name" : "off"}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSubmitInput();
              }}
              className="flex-1 rounded-2xl border-2 border-black bg-white px-4 py-4 text-[17px] text-black outline-none placeholder:text-black/40 focus:ring-2 focus:ring-black/20"
            />
            <button
              onClick={handleSubmitInput}
              disabled={!input.trim()}
              className="rounded-2xl bg-black px-5 py-4 text-white font-extrabold disabled:opacity-40"
              aria-label="Antwort senden"
            >
              ↑
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-black/10 pb-2 last:border-0 last:pb-0">
      <div className="text-[12px] font-bold uppercase tracking-wider text-black/50">
        {label}
      </div>
      <div className="text-[15px] font-extrabold text-black text-right">
        {value || "—"}
      </div>
    </div>
  );
}
