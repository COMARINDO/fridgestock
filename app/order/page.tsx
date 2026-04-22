"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Button, ButtonSecondary } from "@/app/_components/ui";
import {
  publicBannerErrorClass,
  publicCardClass,
} from "@/app/_components/publicUi";

type Field =
  | "product"
  | "quantity"
  | "name"
  | "phone"
  | "pickup_time"
  | "location";
type Stage = Field | "summary" | "done";

type ChatLocation = { id: string; name: string };

type Msg =
  | { id: string; role: "bot"; text: string }
  | { id: string; role: "user"; text: string };

type OrderState = {
  product?: string;
  quantity?: number;
  name?: string;
  phone?: string;
  pickup_time?: string;
  location_id?: string;
  location_name?: string;
};

function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function placeholderFor(stage: Stage): string {
  switch (stage) {
    case "product":
      return "z. B. „2 Vollkornbrote für morgen 14 Uhr in Hofstetten\"";
    case "quantity":
      return "Anzahl Stück";
    case "name":
      return "Vor- und Nachname";
    case "phone":
      return "z. B. +43 660 1234567";
    case "pickup_time":
      return "z. B. morgen 14:00";
    default:
      return "Antwort schreiben…";
  }
}

export default function CustomerOrderPage() {
  const [state, setState] = useState<OrderState>({});
  const [threadId, setThreadId] = useState<string>(() => {
    try {
      return localStorage.getItem("customer-order-thread-id") ?? "";
    } catch {
      return "";
    }
  });
  const [stage, setStage] = useState<Stage>("product");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [locations, setLocations] = useState<ChatLocation[]>([]);
  const [waiting, setWaiting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultId, setResultId] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/customer-order/locations", {
          cache: "no-store",
        });
        const data = (await res.json()) as {
          ok: boolean;
          locations?: ChatLocation[];
        };
        if (data.ok && data.locations) setLocations(data.locations);
      } catch {
        /* keep going – Picker zeigt sich erst beim Location-Step */
      }
    })();
  }, []);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    void converse("");
    // initial greeting only on mount; converse uses fresh state internally
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, stage]);

  async function converse(message: string) {
    setWaiting(true);
    setError(null);
    try {
      const history = messages
        .slice(-12)
        .map((m) => ({
          role: m.role === "bot" ? "assistant" : "user",
          content: m.text,
        }));
      const res = await fetch("/api/customer-order/converse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ thread_id: threadId || undefined, state, history, message }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        thread_id?: string;
        state?: OrderState;
        bot_message?: string;
        next_field?: Field | "summary" | "complete";
        needs_location_picker?: boolean;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Fehler bei der Anfrage.");
      }
      if (data.thread_id && data.thread_id !== threadId) {
        setThreadId(data.thread_id);
        try {
          localStorage.setItem("customer-order-thread-id", data.thread_id);
        } catch {}
      }
      if (data.state) setState(data.state);
      if (data.bot_message) {
        setMessages((prev) => [
          ...prev,
          { id: uid(), role: "bot", text: data.bot_message ?? "" },
        ]);
      }
      const nf = data.next_field ?? "product";
      const nextStage: Stage = nf === "complete" ? "summary" : (nf as Stage);
      setStage(nextStage);
      setTimeout(() => inputRef.current?.focus(), 50);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Fehler bei der Anfrage.");
    } finally {
      setWaiting(false);
    }
  }

  function handleSubmitInput() {
    const value = input.trim();
    if (!value || waiting || stage === "summary" || stage === "done") return;
    setMessages((prev) => [...prev, { id: uid(), role: "user", text: value }]);
    setInput("");
    void converse(value);
  }

  function handleLocationPick(loc: ChatLocation) {
    if (stage !== "location" || waiting) return;
    setMessages((prev) => [
      ...prev,
      { id: uid(), role: "user", text: loc.name },
    ]);
    setState((s) => ({ ...s, location_id: loc.id, location_name: loc.name }));
    void converse(loc.name);
  }

  async function submitOrder() {
    if (submitting || resultId) return;
    setError(null);
    if (
      !state.product ||
      !state.quantity ||
      !state.name ||
      !state.phone ||
      !state.pickup_time ||
      !state.location_id
    ) {
      setError("Es fehlen noch Angaben. Bitte ergänze sie im Chat oben.");
      return;
    }
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
      const data = (await res.json()) as {
        ok: boolean;
        id?: string;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Bestellung konnte nicht gespeichert werden.");
      }
      setResultId(data.id ?? "ok");
      setStage("done");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Bestellung fehlgeschlagen.");
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setState({});
    setStage("product");
    setMessages([]);
    setInput("");
    setError(null);
    setResultId(null);
    setThreadId("");
    try {
      localStorage.removeItem("customer-order-thread-id");
    } catch {}
    initialized.current = false;
    setTimeout(() => {
      initialized.current = true;
      void converse("");
    }, 50);
  }

  function editField(field: Field) {
    setStage(field);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  const placeholder = useMemo(() => placeholderFor(stage), [stage]);
  const showInput = stage !== "location" && stage !== "summary" && stage !== "done";

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
          <h1 className="text-[18px] font-black tracking-tight">
            Bestellung aufgeben
          </h1>
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-5 space-y-3">
        <div
          role="note"
          className="rounded-2xl border border-black/10 bg-white/80 px-4 py-3 text-[12.5px] leading-snug text-black/70 shadow-sm"
        >
          <b className="mr-1 text-black">Hinweis zum Datenschutz:</b>
          Mit dem Absenden deiner Bestellung speichern wir Name, Telefonnummer
          und Abholzeit zur Bearbeitung. Zur besseren Dialogführung wird der
          Chatverlauf an OpenAI (USA) übermittelt. Bestellungen werden nach
          Abschluss automatisch gelöscht. Details in der{" "}
          <Link
            href="/datenschutz"
            className="font-extrabold text-black underline decoration-dotted underline-offset-2 hover:text-pink-700"
          >
            Datenschutzerklärung
          </Link>
          .
        </div>
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
        {waiting ? (
          <div className="max-w-[60%] rounded-2xl rounded-bl-sm bg-white border border-black/10 px-4 py-3 text-[15px] text-black/40 shadow-sm">
            …
          </div>
        ) : null}

        {stage === "location" ? (
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
                    disabled={waiting}
                    className="rounded-2xl border-2 border-black bg-white px-4 py-3 text-left text-[16px] font-extrabold text-black hover:bg-black/5 active:scale-[0.99] disabled:opacity-50"
                  >
                    {l.name}
                  </button>
                ))
              )}
            </div>
          </div>
        ) : null}

        {stage === "summary" ? (
          <div className={`${publicCardClass} space-y-3`}>
            <div className="text-[12px] font-bold uppercase tracking-wider text-black/50">
              Zusammenfassung
            </div>
            <SummaryRow
              label="Produkt"
              value={state.product ?? ""}
              onEdit={() => editField("product")}
            />
            <SummaryRow
              label="Menge"
              value={state.quantity ? `${state.quantity} Stück` : ""}
              onEdit={() => editField("quantity")}
            />
            <SummaryRow
              label="Name"
              value={state.name ?? ""}
              onEdit={() => editField("name")}
            />
            <SummaryRow
              label="Telefon"
              value={state.phone ?? ""}
              onEdit={() => editField("phone")}
            />
            <SummaryRow
              label="Abholzeit"
              value={state.pickup_time ?? ""}
              onEdit={() => editField("pickup_time")}
            />
            <SummaryRow
              label="Filiale"
              value={state.location_name ?? ""}
              onEdit={() => editField("location")}
            />
            {error ? (
              <div className={publicBannerErrorClass} role="alert">
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

        {stage === "done" ? (
          <div className={`${publicCardClass} space-y-3`}>
            <div className="text-[20px] font-black">Danke!</div>
            <div className="text-[15px] text-black/70">
              Deine Bestellung wurde übermittelt. Wir melden uns bei
              Rückfragen unter <span className="font-bold">{state.phone}</span>.
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
        <div className="border-t border-black/10 bg-white px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
          {error ? (
            <div className={`${publicBannerErrorClass} mb-2 py-2`} role="alert">
              {error}
            </div>
          ) : null}
          <div className="flex gap-2">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={placeholder}
              inputMode={
                stage === "quantity"
                  ? "numeric"
                  : stage === "phone"
                    ? "tel"
                    : "text"
              }
              autoComplete={
                stage === "phone"
                  ? "tel"
                  : stage === "name"
                    ? "name"
                    : "off"
              }
              disabled={waiting}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSubmitInput();
              }}
              className="flex-1 rounded-2xl border-2 border-black bg-white px-4 py-4 text-[17px] text-black outline-none placeholder:text-black/40 focus:ring-2 focus:ring-black/20 disabled:opacity-60"
            />
            <button
              onClick={handleSubmitInput}
              disabled={!input.trim() || waiting}
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

function SummaryRow({
  label,
  value,
  onEdit,
}: {
  label: string;
  value: string;
  onEdit?: () => void;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-black/10 pb-2 last:border-0 last:pb-0">
      <div className="text-[12px] font-bold uppercase tracking-wider text-black/50">
        {label}
      </div>
      <div className="flex items-baseline gap-3 min-w-0">
        <div className="text-[15px] font-extrabold text-black text-right truncate">
          {value || "—"}
        </div>
        {onEdit ? (
          <button
            type="button"
            onClick={onEdit}
            className="text-[12px] font-bold text-black/50 underline decoration-dotted hover:text-black"
          >
            ändern
          </button>
        ) : null}
      </div>
    </div>
  );
}
