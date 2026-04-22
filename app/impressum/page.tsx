import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Impressum · Ordarella",
  description:
    "Offenlegung und Kontaktdaten des Betreibers nach § 5 ECG und § 25 MedienG.",
};

/**
 * Impressum / Offenlegung nach österreichischem Recht.
 *
 * Pflichtangaben ergeben sich insbesondere aus:
 * - § 5 E-Commerce-Gesetz (ECG)
 * - § 14 Unternehmensgesetzbuch (UGB)
 * - § 24 / § 25 Mediengesetz (MedienG)
 *
 * Die mit [[ ... ]] markierten Platzhalter müssen vor dem Live-Schalten
 * durch den Betreiber ausgefüllt werden.
 */
export default function ImpressumPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-10 text-black">
      <p className="text-[11px] font-black uppercase tracking-[0.2em] text-black/50">
        Rechtliches
      </p>
      <h1 className="mt-1 text-3xl font-black tracking-tight sm:text-4xl">
        Impressum
      </h1>
      <p className="mt-2 text-sm font-bold text-black/60">
        Offenlegung nach § 5 ECG, § 14 UGB und § 25 MedienG.
      </p>

      <Section title="Medieninhaber & Diensteanbieter">
        <Placeholder>
          Firmenname / Inhaber
          <br />
          Rechtsform (z. B. Einzelunternehmen, GmbH)
          <br />
          Adresse, PLZ Ort, Österreich
          <br />
          E-Mail: [[ kontakt@ ... ]]
          <br />
          Telefon: [[ ... ]]
          <br />
          Firmenbuchnummer / FN: [[ falls eingetragen ]]
          <br />
          Firmenbuchgericht: [[ ... ]]
          <br />
          UID-Nummer: [[ falls vorhanden ]]
          <br />
          Gewerbe: [[ z. B. Bäckerei ]]
          <br />
          Gewerbebehörde: [[ zuständige Bezirkshauptmannschaft / Magistrat ]]
        </Placeholder>
      </Section>

      <Section title="Anwendbare Rechtsvorschriften">
        <p>
          Gewerbeordnung (GewO):{" "}
          <a
            className="underline"
            href="https://www.ris.bka.gv.at/"
            target="_blank"
            rel="noopener noreferrer"
          >
            ris.bka.gv.at
          </a>
        </p>
      </Section>

      <Section title="Online-Streitbeilegung (OS-Plattform)">
        <p>
          Die Europäische Kommission stellt eine Plattform zur
          Online-Streitbeilegung (OS) bereit:{" "}
          <a
            className="underline"
            href="https://ec.europa.eu/consumers/odr/"
            target="_blank"
            rel="noopener noreferrer"
          >
            ec.europa.eu/consumers/odr
          </a>
          . Verbraucher haben die Möglichkeit, diese Plattform für die
          Beilegung ihrer Streitigkeiten zu nutzen.
        </p>
      </Section>

      <Section title="Haftungsausschluss">
        <p>
          Inhalte dieser App werden mit größter Sorgfalt erstellt. Für die
          Richtigkeit, Vollständigkeit und Aktualität der Inhalte kann jedoch
          keine Gewähr übernommen werden.
        </p>
      </Section>

      <Section title="Urheberrecht">
        <p>
          Sämtliche Inhalte (Texte, Grafiken, Logos) sind urheberrechtlich
          geschützt. Die Vervielfältigung oder Nutzung außerhalb der
          gesetzlichen Schranken bedarf der vorherigen schriftlichen
          Zustimmung des Betreibers.
        </p>
      </Section>

      <div className="mt-10 flex flex-wrap gap-3 border-t border-black/10 pt-6 text-sm font-black">
        <Link href="/datenschutz" className="underline hover:text-pink-600">
          Datenschutz
        </Link>
        <Link href="/login" className="underline hover:text-pink-600">
          Zurück zur Startseite
        </Link>
      </div>
    </main>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8 space-y-2 text-[15px] leading-relaxed text-black/80">
      <h2 className="text-lg font-black tracking-tight text-black sm:text-xl">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-3 rounded-xl border-2 border-dashed border-amber-500/60 bg-amber-50 p-3 text-[14px] font-bold text-amber-900">
      <div className="mb-1 text-[10px] uppercase tracking-wider text-amber-700">
        Vom Betreiber zu ergänzen
      </div>
      <div className="whitespace-pre-line">{children}</div>
    </div>
  );
}
