"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAdmin } from "@/app/admin-provider";
import { listProducts, updateProductAllFields } from "@/lib/db";
import {
  PRODUCT_LIST_CATEGORIES,
  PRODUCT_LIST_LABELS,
  type ProductListCategory,
  parseListCategory,
} from "@/lib/productListCategory";
import type { Product } from "@/lib/types";
import { errorMessage } from "@/lib/error";
import { formatProductName } from "@/lib/formatProductName";
import {
  adminBannerErrorClass,
  adminBannerInfoClass,
  adminCardClass,
  adminCardHeadlineClass,
  adminInputClass,
  adminMutedTextClass,
  adminPrimaryButtonClass,
  adminSecondaryButtonClass,
  adminSectionTitleClass,
  adminTableClass,
  adminTableRowClass,
  adminTableShellClass,
  adminTableStickyHeadCellClass,
} from "@/app/admin/_components/adminUi";
import { AdminPageHeader } from "@/app/admin/_components/AdminPageHeader";

type EditState = {
  id: string;
  brand: string;
  product_name: string;
  zusatz: string;
  barcode: string;
  short_name: string;
  min_quantity: string;
  supplier: string;
  purchase_price: string;
  selling_price: string;
  metro_order_number: string;
  metro_unit: string;
  list_category: ProductListCategory;
};

function toEditState(p: Product): EditState {
  return {
    id: p.id,
    brand: p.brand ?? "",
    product_name: p.product_name ?? "",
    zusatz: p.zusatz ?? "",
    barcode: p.barcode ?? "",
    short_name: p.short_name ?? "",
    min_quantity:
      p.min_quantity === null || p.min_quantity === undefined
        ? ""
        : String(p.min_quantity),
    supplier: p.supplier ?? "",
    purchase_price:
      p.purchase_price === null || p.purchase_price === undefined
        ? ""
        : String(p.purchase_price),
    selling_price:
      p.selling_price === null || p.selling_price === undefined
        ? ""
        : String(p.selling_price),
    metro_order_number: p.metro_order_number ?? "",
    metro_unit: p.metro_unit ?? "",
    list_category: parseListCategory(p.list_category),
  };
}

function parseNumberOrNull(raw: string): number | null {
  const t = raw.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function parseIntOrNull(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = parseInt(t, 10);
  return Number.isFinite(n) ? n : null;
}

function fmtPrice(v: number | null | undefined): string {
  if (v === null || v === undefined) return "–";
  return v.toLocaleString("de-AT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function AdminProductsPage() {
  const router = useRouter();
  const { isAdmin, adminHydrated } = useAdmin();

  const [rows, setRows] = useState<Product[]>([]);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [edit, setEdit] = useState<EditState | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editErr, setEditErr] = useState<string | null>(null);

  useEffect(() => {
    if (!adminHydrated) return;
    if (!isAdmin) router.replace("/login");
  }, [adminHydrated, isAdmin, router]);

  const reload = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const data = await listProducts();
      setRows(data);
    } catch (e: unknown) {
      setErr(errorMessage(e, "Konnte Artikel nicht laden."));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!adminHydrated || !isAdmin) return;
    void reload();
  }, [adminHydrated, isAdmin, reload]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((p) => {
      const hay = [
        p.brand,
        p.product_name,
        p.zusatz,
        p.barcode,
        p.short_name,
        p.supplier,
        p.metro_order_number,
        p.metro_unit,
        PRODUCT_LIST_LABELS[parseListCategory(p.list_category)],
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [rows, query]);

  async function save() {
    if (!edit) return;
    setEditBusy(true);
    setEditErr(null);
    try {
      await updateProductAllFields({
        productId: edit.id,
        brand: edit.brand,
        product_name: edit.product_name,
        zusatz: edit.zusatz.trim() ? edit.zusatz : null,
        barcode: edit.barcode.trim() ? edit.barcode : null,
        short_name: edit.short_name.trim() ? edit.short_name : null,
        min_quantity: parseIntOrNull(edit.min_quantity),
        supplier: edit.supplier.trim() ? edit.supplier : null,
        purchase_price: parseNumberOrNull(edit.purchase_price),
        selling_price: parseNumberOrNull(edit.selling_price),
        metro_order_number: edit.metro_order_number.trim()
          ? edit.metro_order_number
          : null,
        metro_unit: edit.metro_unit.trim() ? edit.metro_unit : null,
        list_category: edit.list_category,
      });
      await reload();
      setEdit(null);
    } catch (e: unknown) {
      setEditErr(errorMessage(e, "Konnte Artikel nicht speichern."));
    } finally {
      setEditBusy(false);
    }
  }

  if (!adminHydrated) {
    return (
      <main className="w-full px-4 py-8 text-center text-black">
        <p className="font-black">Laden…</p>
      </main>
    );
  }
  if (!isAdmin) return null;

  return (
    <main className="mx-auto w-full max-w-7xl px-4 pb-28 pt-6">
      <AdminPageHeader
        eyebrow="Stammdaten"
        title="Artikel"
        description="Alle Produkte – Brand, Bezeichnung, Barcode, Einkauf, Verkauf, Metro-Bestellnummern."
        actions={
          <button
            type="button"
            className={adminSecondaryButtonClass}
            onClick={() => void reload()}
            disabled={busy}
          >
            Aktualisieren
          </button>
        }
      />

      {err ? <div className={`${adminBannerErrorClass} mt-5`}>{err}</div> : null}

      <section className={`${adminCardClass} mt-5`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className={adminSectionTitleClass}>Übersicht</p>
            <h2 className={adminCardHeadlineClass}>
              {filtered.length} / {rows.length} Artikel
            </h2>
            <p className={`mt-1 ${adminMutedTextClass}`}>
              Zeile anklicken zum Bearbeiten. Suche filtert alle Spalten.
            </p>
          </div>
          <label className="flex w-full flex-col gap-1 sm:w-72">
            <span className="text-[12px] font-black uppercase tracking-wide text-black/55">
              Suche
            </span>
            <input
              className={adminInputClass}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Brand, Produkt, Barcode, Metro…"
              type="search"
            />
          </label>
        </div>

        {busy ? (
          <div className={`${adminBannerInfoClass} mt-4`}>Lade…</div>
        ) : (
          <div className={`${adminTableShellClass} mt-4`}>
            <table className={`${adminTableClass} min-w-[1100px]`}>
              <thead>
                <tr>
                  <th className={adminTableStickyHeadCellClass}>Artikel</th>
                  <th className={adminTableStickyHeadCellClass}>Kurzname</th>
                  <th className={adminTableStickyHeadCellClass}>Barcode</th>
                  <th className={`${adminTableStickyHeadCellClass} text-right`}>
                    Min
                  </th>
                  <th className={adminTableStickyHeadCellClass}>Lieferant</th>
                  <th className={`${adminTableStickyHeadCellClass} text-right`}>
                    EK €
                  </th>
                  <th className={`${adminTableStickyHeadCellClass} text-right`}>
                    VK €
                  </th>
                  <th className={adminTableStickyHeadCellClass}>Metro-Nr.</th>
                  <th className={adminTableStickyHeadCellClass}>Metro-Einheit</th>
                  <th className={adminTableStickyHeadCellClass}>Liste</th>
                  <th className={adminTableStickyHeadCellClass}>
                    <span className="sr-only">Aktion</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr
                    key={p.id}
                    className={`${adminTableRowClass} cursor-pointer`}
                    onClick={() => {
                      setEditErr(null);
                      setEdit(toEditState(p));
                    }}
                  >
                    <td className="p-3 align-top">
                      <div className="font-black text-black">
                        {formatProductName(p)}
                      </div>
                      {p.zusatz ? (
                        <div className="mt-0.5 text-[12px] font-bold text-black/55">
                          {p.zusatz}
                        </div>
                      ) : null}
                    </td>
                    <td className="p-3 align-top text-sm font-bold text-black/75">
                      {p.short_name || "–"}
                    </td>
                    <td className="p-3 align-top font-mono text-[12px] font-bold text-black/75">
                      {p.barcode || "–"}
                    </td>
                    <td className="p-3 align-top text-right tabular-nums font-bold text-black/75">
                      {p.min_quantity ?? "–"}
                    </td>
                    <td className="p-3 align-top text-sm font-bold text-black/75">
                      {p.supplier || "–"}
                    </td>
                    <td className="p-3 align-top text-right tabular-nums font-bold text-black/75">
                      {fmtPrice(p.purchase_price ?? null)}
                    </td>
                    <td className="p-3 align-top text-right tabular-nums font-bold text-black/75">
                      {fmtPrice(p.selling_price ?? null)}
                    </td>
                    <td className="p-3 align-top font-mono text-[12px] font-bold text-black/75">
                      {p.metro_order_number || "–"}
                    </td>
                    <td className="p-3 align-top text-sm font-bold text-black/75">
                      {p.metro_unit || "–"}
                    </td>
                    <td className="p-3 align-top text-xs font-black text-black/70">
                      {PRODUCT_LIST_LABELS[parseListCategory(p.list_category)]}
                    </td>
                    <td className="p-3 align-top text-right">
                      <button
                        type="button"
                        className={adminSecondaryButtonClass}
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditErr(null);
                          setEdit(toEditState(p));
                        }}
                      >
                        Bearbeiten
                      </button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 ? (
                  <tr>
                    <td
                      className="p-4 text-sm font-bold text-black/55"
                      colSpan={11}
                    >
                      Keine Artikel gefunden.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {edit ? (
        <EditModal
          state={edit}
          busy={editBusy}
          error={editErr}
          onChange={setEdit}
          onClose={() => {
            if (editBusy) return;
            setEdit(null);
            setEditErr(null);
          }}
          onSave={() => void save()}
        />
      ) : null}
    </main>
  );
}

function EditModal({
  state,
  busy,
  error,
  onChange,
  onClose,
  onSave,
}: {
  state: EditState;
  busy: boolean;
  error: string | null;
  onChange: (next: EditState) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const disabled =
    busy || !state.brand.trim() || !state.product_name.trim();

  const set = (patch: Partial<EditState>) => onChange({ ...state, ...patch });

  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-black/40 sm:items-center sm:justify-center"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-3xl border-t-2 border-black bg-white p-5 sm:max-w-2xl sm:rounded-3xl sm:border-2"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-black uppercase tracking-[0.12em] text-black/45">
              Artikel bearbeiten
            </div>
            <div className="mt-0.5 truncate text-xl font-black leading-tight text-black sm:text-2xl">
              {state.brand || "–"}
              {state.product_name ? ` · ${state.product_name}` : ""}
            </div>
          </div>
          <button
            type="button"
            className={adminSecondaryButtonClass}
            onClick={onClose}
            disabled={busy}
          >
            Schließen
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            label="Brand *"
            value={state.brand}
            onChange={(v) => set({ brand: v })}
          />
          <Field
            label="Produkt *"
            value={state.product_name}
            onChange={(v) => set({ product_name: v })}
          />
          <div className="flex flex-col gap-1">
            <span className="text-[12px] font-black uppercase tracking-wide text-black/55">
              PWA-Liste
            </span>
            <select
              className={adminInputClass}
              value={state.list_category}
              onChange={(e) =>
                set({ list_category: e.target.value as ProductListCategory })
              }
            >
              {PRODUCT_LIST_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {PRODUCT_LIST_LABELS[c]}
                </option>
              ))}
            </select>
          </div>
          <Field
            label="Zusatz"
            value={state.zusatz}
            onChange={(v) => set({ zusatz: v })}
          />
          <Field
            label="Kurzname"
            value={state.short_name}
            onChange={(v) => set({ short_name: v })}
          />
          <Field
            label="Barcode"
            value={state.barcode}
            onChange={(v) => set({ barcode: v })}
            mono
          />
          <Field
            label="Mindestmenge"
            value={state.min_quantity}
            onChange={(v) => set({ min_quantity: v })}
            inputMode="numeric"
          />
          <Field
            label="Lieferant"
            value={state.supplier}
            onChange={(v) => set({ supplier: v })}
          />
          <div />
          <Field
            label="Einkaufspreis €"
            value={state.purchase_price}
            onChange={(v) => set({ purchase_price: v })}
            inputMode="decimal"
          />
          <Field
            label="Verkaufspreis €"
            value={state.selling_price}
            onChange={(v) => set({ selling_price: v })}
            inputMode="decimal"
          />
          <Field
            label="Metro-Bestellnummer"
            value={state.metro_order_number}
            onChange={(v) => set({ metro_order_number: v })}
            mono
          />
          <Field
            label="Metro-Einheit"
            value={state.metro_unit}
            onChange={(v) => set({ metro_unit: v })}
          />
        </div>

        {error ? (
          <div className={`${adminBannerErrorClass} mt-4`}>{error}</div>
        ) : null}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className={adminSecondaryButtonClass}
            onClick={onClose}
            disabled={busy}
          >
            Abbrechen
          </button>
          <button
            type="button"
            className={adminPrimaryButtonClass}
            onClick={onSave}
            disabled={disabled}
          >
            {busy ? "Speichert…" : "Speichern"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  mono,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  mono?: boolean;
  inputMode?: "numeric" | "decimal" | "text";
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] font-black uppercase tracking-wide text-black/55">
        {label}
      </span>
      <input
        className={`${adminInputClass} ${mono ? "font-mono" : ""}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode={inputMode}
      />
    </label>
  );
}
