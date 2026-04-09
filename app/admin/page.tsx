"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { RequireAuth } from "@/app/_components/RequireAuth";
import { Button, Input } from "@/app/_components/ui";
import {
  adminCreateLocation,
  adminCreateProduct,
  adminCreateUser,
  deleteLocation,
  deleteProduct,
  listLocations,
  listProducts,
  listUsers,
} from "@/lib/db";
import type { Location, Product } from "@/lib/types";
import { errorMessage } from "@/lib/error";

type Tab = "products" | "locations" | "users";

export default function AdminPage() {
  return (
    <RequireAuth>
      <AdminInner />
    </RequireAuth>
  );
}

function AdminInner() {
  const [tab, setTab] = useState<Tab>("products");
  const [products, setProducts] = useState<Product[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [users, setUsers] = useState<Array<{ id: string; name: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setError(null);
    const [p, l, u] = await Promise.all([
      listProducts(),
      listLocations(),
      listUsers(),
    ]);
    setProducts(p);
    setLocations(l);
    setUsers(u);
  }

  useEffect(() => {
    void refresh().catch((e: unknown) =>
      setError(errorMessage(e, "Konnte Admin-Daten nicht laden."))
    );
  }, []);

  return (
    <div className="flex-1 flex flex-col bg-zinc-50">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-zinc-50/90 backdrop-blur">
        <div className="mx-auto w-full max-w-2xl px-5 py-4 flex items-center justify-between">
          <div className="text-xl font-extrabold">Admin</div>
          <Link href="/" className="text-sm font-semibold text-zinc-700">
            Home
          </Link>
        </div>
        <div className="mx-auto w-full max-w-2xl px-5 pb-4">
          <div className="grid grid-cols-3 gap-2">
            <TabButton active={tab === "products"} onClick={() => setTab("products")}>
              Produkte
            </TabButton>
            <TabButton active={tab === "locations"} onClick={() => setTab("locations")}>
              Locations
            </TabButton>
            <TabButton active={tab === "users"} onClick={() => setTab("users")}>
              Users
            </TabButton>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl px-5 py-5 pb-24">
        {error ? (
          <div className="rounded-2xl bg-red-50 p-4 text-red-800">{error}</div>
        ) : null}

        {tab === "products" ? (
          <ProductsTab
            products={products}
            busy={busy}
            onCreate={async (name, min, barcode) => {
              setBusy(true);
              setError(null);
              try {
                await adminCreateProduct({
                  name,
                  min_quantity: min,
                  barcode: barcode || null,
                });
                await refresh();
              } catch (e: unknown) {
                setError(errorMessage(e, "Konnte Produkt nicht erstellen."));
              } finally {
                setBusy(false);
              }
            }}
          />
        ) : null}

        {tab === "locations" ? (
          <LocationsTab
            locations={locations}
            busy={busy}
            onCreate={async (name, parentId) => {
              setBusy(true);
              setError(null);
              try {
                await adminCreateLocation({ name, parent_id: parentId });
                await refresh();
              } catch (e: unknown) {
                setError(errorMessage(e, "Konnte Location nicht erstellen."));
              } finally {
                setBusy(false);
              }
            }}
          />
        ) : null}

        {tab === "users" ? (
          <UsersTab
            users={users}
            busy={busy}
            onCreate={async (name, password) => {
              setBusy(true);
              setError(null);
              try {
                await adminCreateUser({ name, password });
                await refresh();
              } catch (e: unknown) {
                setError(errorMessage(e, "Konnte User nicht erstellen."));
              } finally {
                setBusy(false);
              }
            }}
          />
        ) : null}

      </main>
    </div>
  );
}

function TabButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "h-10 rounded-xl text-sm font-extrabold active:scale-[0.99]",
        active ? "bg-zinc-900 text-white" : "bg-white border border-zinc-200",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function ProductsTab({
  products,
  busy,
  onCreate,
}: {
  products: Product[];
  busy: boolean;
  onCreate: (name: string, min: number, barcode: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [min, setMin] = useState("0");
  const [barcode, setBarcode] = useState("");

  return (
    <div className="grid gap-5">
      <div className="rounded-2xl border border-zinc-200 bg-white p-4">
        <div className="text-lg font-extrabold">Produkt erstellen</div>
        <div className="mt-3 grid gap-3">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
          <Input
            value={min}
            onChange={(e) => setMin(e.target.value)}
            inputMode="numeric"
            placeholder="min_quantity"
          />
          <Input
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            placeholder="Barcode (optional)"
            className="font-mono"
          />
          <Button
            disabled={busy || !name.trim()}
            onClick={() =>
              onCreate(name.trim(), Number(min) || 0, barcode.trim()).then(() => {
                setName("");
                setMin("0");
                setBarcode("");
              })
            }
          >
            {busy ? "Erstelle…" : "Erstellen"}
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-4">
        <div className="text-lg font-extrabold">Produkte ({products.length})</div>
        <div className="mt-3 grid gap-2">
          {products.map((p) => (
            <div key={p.id} className="flex items-center justify-between rounded-xl bg-zinc-50 px-3 py-2">
              <div>
                <div className="font-semibold">{p.name}</div>
                {p.barcode ? (
                  <div className="text-xs text-zinc-600 font-mono">{p.barcode}</div>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <div className="text-sm text-zinc-600">min {p.min_quantity}</div>
                <button
                  className="h-9 px-3 rounded-xl border border-zinc-200 bg-white text-sm font-semibold"
                  onClick={async () => {
                    if (!confirm(`Produkt löschen: ${p.name}?`)) return;
                    await deleteProduct(p.id);
                    window.location.reload();
                  }}
                >
                  Löschen
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function LocationsTab({
  locations,
  busy,
  onCreate,
}: {
  locations: Location[];
  busy: boolean;
  onCreate: (name: string, parentId: string | null) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState<string>("");

  const sorted = useMemo(() => [...locations].sort((a, b) => a.name.localeCompare(b.name)), [locations]);

  return (
    <div className="grid gap-5">
      <div className="rounded-2xl border border-zinc-200 bg-white p-4">
        <div className="text-lg font-extrabold">Location erstellen</div>
        <div className="mt-3 grid gap-3">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
          <select
            className="h-12 rounded-xl border border-zinc-200 bg-white px-4 text-base"
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
          >
            <option value="">(kein Parent)</option>
            {sorted.map((l) => (
              <option key={l.id} value={String(l.id)}>
                {l.name} (#{l.id})
              </option>
            ))}
          </select>
          <Button
            disabled={busy || !name.trim()}
            onClick={() =>
              onCreate(name.trim(), parentId ? parentId : null).then(() => {
                setName("");
                setParentId("");
              })
            }
          >
            {busy ? "Erstelle…" : "Erstellen"}
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-4">
        <div className="text-lg font-extrabold">Locations ({locations.length})</div>
        <div className="mt-3 grid gap-2">
          {sorted.map((l) => (
            <div key={l.id} className="rounded-xl bg-zinc-50 px-3 py-2">
              <div className="flex items-center justify-between">
                <div className="font-semibold">{l.name}</div>
                <div className="flex items-center gap-2">
                  <div className="text-sm text-zinc-600 font-mono">{l.id}</div>
                  <button
                    className="h-9 px-3 rounded-xl border border-zinc-200 bg-white text-sm font-semibold"
                    onClick={async () => {
                      if (!confirm(`Location löschen: ${l.name}?`)) return;
                      await deleteLocation(l.id);
                      window.location.reload();
                    }}
                  >
                    Löschen
                  </button>
                </div>
              </div>
              {l.parent_id ? <div className="text-sm text-zinc-600">parent #{l.parent_id}</div> : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function UsersTab({
  users,
  busy,
  onCreate,
}: {
  users: Array<{ id: string; name: string }>;
  busy: boolean;
  onCreate: (name: string, password: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");

  return (
    <div className="grid gap-5">
      <div className="rounded-2xl border border-zinc-200 bg-white p-4">
        <div className="text-lg font-extrabold">User erstellen</div>
        <div className="mt-3 grid gap-3">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
          <Input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Passwort"
            type="password"
          />
          <Button
            disabled={busy || !name.trim() || !password}
            onClick={() =>
              onCreate(name.trim(), password).then(() => {
                setName("");
                setPassword("");
              })
            }
          >
            {busy ? "Erstelle…" : "Erstellen"}
          </Button>
          <div className="text-xs text-zinc-600">
            Hinweis: Passwort wird absichtlich im Klartext gespeichert (wie gewünscht).
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-4">
        <div className="text-lg font-extrabold">Users ({users.length})</div>
        <div className="mt-3 grid gap-2">
          {users.map((u) => (
            <div key={u.id} className="flex items-center justify-between rounded-xl bg-zinc-50 px-3 py-2">
              <div className="font-semibold">{u.name}</div>
              <div className="text-sm text-zinc-600">#{u.id}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

