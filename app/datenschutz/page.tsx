import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Datenschutz · Ordarella",
  description:
    "Informationen nach Art. 13 DSGVO zur Verarbeitung personenbezogener Daten in der Ordarella-Bestellapp.",
};

/**
 * Öffentliche Datenschutzerklärung nach Art. 13 DSGVO.
 *
 * Wichtig: Diese Seite ist ein ehrlicher technischer Stand dessen, was die App
 * tatsächlich verarbeitet. Die mit [[ ... ]] markierten Stellen müssen vor dem
 * Live-Schalten durch den Betreiber (Verantwortlicher i.S.d. DSGVO) ausgefüllt
 * oder juristisch final geprüft werden.
 */
export default function DatenschutzPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-10 text-black">
      <p className="text-[11px] font-black uppercase tracking-[0.2em] text-black/50">
        Rechtliches
      </p>
      <h1 className="mt-1 text-3xl font-black tracking-tight sm:text-4xl">
        Datenschutzerklärung
      </h1>
      <p className="mt-2 text-sm font-bold text-black/60">
        Informationen zur Verarbeitung personenbezogener Daten nach Art. 13
        DSGVO.
      </p>

      <Section title="1. Verantwortlicher">
        <p>
          Verantwortlicher im Sinne der DSGVO und des österreichischen
          Datenschutzgesetzes (DSG):
        </p>
        <Placeholder>
          Firmenname / Inhaber
          <br />
          Adresse, PLZ Ort
          <br />
          E-Mail: [[ kontakt@ ... ]]
          <br />
          Telefon: [[ ... ]]
        </Placeholder>
        <p>
          Fragen zum Datenschutz bitte an die oben genannte E-Mail-Adresse.
        </p>
      </Section>

      <Section title="2. Welche Daten wir verarbeiten">
        <h3 className="mt-3 text-base font-black">a) Kundenbestellung (Chatbot)</h3>
        <p>
          Wenn Sie über die Seite <code>/order</code> eine Bestellung
          aufgeben, verarbeiten wir:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Vor- und Nachname</li>
          <li>Telefonnummer</li>
          <li>gewünschtes Produkt, Menge, Abholzeit, Abholfiliale</li>
          <li>Zeitstempel der Bestellung</li>
        </ul>
        <p>
          <b>Rechtsgrundlage:</b> Art. 6 Abs. 1 lit. b DSGVO
          (Vertragserfüllung / vorvertragliche Maßnahmen).
        </p>
        <p>
          <b>Zweck:</b> Bearbeitung und Rückfrage zu Ihrer Bestellung.
        </p>
        <p>
          <b>Speicherdauer:</b> Abgeschlossene Bestellungen (bestätigt,
          weitergeleitet oder storniert) werden spätestens 90 Tage nach
          Abschluss automatisch gelöscht. Offene Bestellungen werden nach 180
          Tagen gelöscht.
        </p>

        <h3 className="mt-5 text-base font-black">b) Mitarbeiter-Login</h3>
        <p>
          Der Login für Mitarbeiter erfolgt über einen gemeinsamen
          Standort-Code. Wir verarbeiten dabei:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            eingegebenen Code (nur zur Prüfung, wird nicht dauerhaft mit einer
            Person verknüpft gespeichert)
          </li>
          <li>
            Zeitstempel und Art der getätigten Inventur-/Bestellaktion,
            verknüpft mit der Nutzer-ID des angemeldeten Geräts
          </li>
        </ul>
        <p>
          <b>Rechtsgrundlage:</b> Art. 6 Abs. 1 lit. f DSGVO (berechtigtes
          Interesse an der Nachvollziehbarkeit von Warenbewegungen und
          Bestellungen).
        </p>

        <h3 className="mt-5 text-base font-black">c) Technisches Audit-Log</h3>
        <p>
          Bei administrativen Aktionen (z. B. Bestellung bestätigen, Lieferung
          abschließen) protokollieren wir aus Sicherheits- und
          Rechenschaftsgründen:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            eine <b>gekürzte IP-Adresse</b> (letztes Oktett einer IPv4 bzw.
            die letzten Bit einer IPv6 werden serverseitig auf 0 gesetzt)
          </li>
          <li>die aufgerufene Aktion und den Zeitstempel</li>
          <li>ggf. betroffene Bestell- oder Standort-IDs</li>
        </ul>
        <p>
          <b>Rechtsgrundlage:</b> Art. 6 Abs. 1 lit. f DSGVO (berechtigtes
          Interesse an Missbrauchserkennung und Nachvollziehbarkeit).
        </p>
        <p>
          <b>Speicherdauer:</b> Automatische Löschung nach 180 Tagen.
        </p>

        <h3 className="mt-5 text-base font-black">
          d) Technisch notwendige Browser-Speicher
        </h3>
        <p>
          Wir verwenden ausschließlich technisch notwendigen{" "}
          <code>localStorage</code> (Login-Status der Filiale, UI-Einstellungen).
          Es werden <b>keine Analyse-, Tracking- oder Werbe-Cookies</b>{" "}
          eingesetzt. Deshalb wird auch kein Cookie-Banner angezeigt.
        </p>
      </Section>

      <Section title="3. Empfänger & Auftragsverarbeiter">
        <p>
          Wir setzen für den Betrieb der App folgende Auftragsverarbeiter im
          Sinne des Art. 28 DSGVO ein:
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <b>Supabase</b> (Datenbank-Hosting). Serverstandort:{" "}
            [[ EU-Region bitte bestätigen, z. B. eu-central-1 ]].
          </li>
          <li>
            <b>Vercel Inc.</b> (Hosting, Logs, geplante Jobs) – Sitz USA,
            EU-Unterauftragsverarbeiter. Datenübermittlung gestützt auf
            EU-Standardvertragsklauseln.
          </li>
          <li>
            <b>OpenAI, L.L.C.</b> (USA) – Verarbeitung der Chat-Eingaben im
            Kundenbestell-Chat. Wenn Sie in diesem Chat Namen oder
            Telefonnummer eingeben, werden diese zur Verarbeitung an OpenAI
            übermittelt. Datenübermittlung gestützt auf
            EU-Standardvertragsklauseln. Nutzung ausschließlich zur
            Bereitstellung der Antwort; keine Nutzung zu Trainingszwecken.
          </li>
          <li>
            <b>Resend (Plunk Inc.)</b> (USA) – Versand der
            Backup-E-Mail an den Betreiber. Datenübermittlung gestützt auf
            EU-Standardvertragsklauseln.
          </li>
        </ul>
        <p className="mt-2">
          Mit allen genannten Anbietern bestehen bzw. werden
          Auftragsverarbeitungsverträge (AVV) gemäß Art. 28 DSGVO abgeschlossen.
        </p>
      </Section>

      <Section title="4. Ihre Rechte">
        <p>
          Sie haben uns gegenüber als betroffene Person folgende Rechte:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Auskunft (Art. 15 DSGVO)</li>
          <li>Berichtigung (Art. 16 DSGVO)</li>
          <li>Löschung (&bdquo;Recht auf Vergessenwerden&ldquo;, Art. 17 DSGVO)</li>
          <li>Einschränkung der Verarbeitung (Art. 18 DSGVO)</li>
          <li>Datenübertragbarkeit (Art. 20 DSGVO)</li>
          <li>Widerspruch (Art. 21 DSGVO)</li>
          <li>
            Beschwerde bei der Aufsichtsbehörde (Art. 77 DSGVO). Zuständig in
            Österreich: Österreichische Datenschutzbehörde,
            Barichgasse 40–42, 1030 Wien,{" "}
            <a
              className="underline"
              href="https://www.dsb.gv.at/"
              target="_blank"
              rel="noopener noreferrer"
            >
              dsb.gv.at
            </a>
            .
          </li>
        </ul>
        <p>
          Zur Ausübung genügt eine formlose Nachricht an die unter Punkt 1
          genannte E-Mail-Adresse. Bitte geben Sie für eine Löschanfrage die
          verwendete Telefonnummer an, damit wir Sie den entsprechenden
          Bestellungen zuordnen können.
        </p>
      </Section>

      <Section title="5. Automatisierte Entscheidungsfindung">
        <p>
          Eine automatisierte Entscheidungsfindung einschließlich Profiling im
          Sinne des Art. 22 DSGVO findet nicht statt.
        </p>
      </Section>

      <Section title="6. Aktualität dieser Erklärung">
        <p>
          Diese Erklärung entspricht dem technischen Stand zum Zeitpunkt der
          letzten Änderung. Wenn sich die Verarbeitung ändert (z. B. neue
          Dienstleister), passen wir diese Seite an.
        </p>
        <p className="mt-3 text-xs font-bold text-black/50">
          Stand: [[ Datum bei Veröffentlichung einfügen ]]
        </p>
      </Section>

      <div className="mt-10 flex flex-wrap gap-3 border-t border-black/10 pt-6 text-sm font-black">
        <Link href="/impressum" className="underline hover:text-pink-600">
          Impressum
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
