/**
 * The question asked before an upload is allowed to join the trends.
 *
 * It lives here, above the upload panel, for two reasons. The panel stops
 * rendering itself once the budget is spent or the gate is unavailable, and a
 * report can finish extracting on the very page that exhausts the budget — a
 * dialog inside the panel would take that report away without ever asking.
 * And the decision is about the *loaded* set, which is the app's state, not
 * the uploader's.
 *
 * The three answers are deliberately not two. "Replace" and "discard" are the
 * two right answers to the common mistake, and "add anyway" exists because
 * keeping two patients side by side is sometimes exactly what a doctor means
 * to do — refusing it would teach people to work around the guard rather than
 * with it.
 */
import { describeIdentity, type IdentityWarning } from "@bw/lab-core";
import Modal from "./Modal";

interface Props {
  /** The file being asked about. */
  fileName: string;
  warning: IdentityWarning;
  onReplace: () => void;
  onAdd: () => void;
  onDiscard: () => void;
}

export default function IdentityGate({ fileName, warning, onReplace, onAdd, onDiscard }: Props) {
  return (
    <Modal
      title={warning.kind === "mismatch" ? "Jiný pacient?" : "Pacienta nelze ověřit"}
      // Escape and the backdrop are the safe answer, and the safe answer is
      // the one that changes nothing about what is on screen.
      onDismiss={onDiscard}
      actions={[
        { label: "Nahradit načtená data", primary: true, onClick: onReplace },
        { label: "Přidat i tak", onClick: onAdd },
        { label: "Zahodit", dismiss: true, onClick: onDiscard },
      ]}
    >
      <p>
        {warning.kind === "mismatch"
          ? warning.by === "id"
            ? "Rodné číslo v nahraném PDF neodpovídá datům, která jsou teď načtená."
            : "Jméno pacienta v nahraném PDF neodpovídá datům, která jsou teď načtená."
          : "Z nahraného PDF se nepodařilo přečíst jméno ani rodné číslo, takže nelze ověřit, že jde o stejného pacienta."}{" "}
        Hodnoty dvou různých lidí by se v grafech spojily do jedné křivky.
      </p>
      <dl className="idcmp">
        <div>
          <dt>Načteno</dt>
          <dd>{warning.loaded.map(describeIdentity).join(" / ") || "neuvedeno"}</dd>
        </div>
        <div>
          <dt>Nahráno</dt>
          <dd>{describeIdentity(warning.incoming)}</dd>
        </div>
        {/* Which file this is about. Several PDFs can be read at once and the
            questions are asked one at a time, so "the upload" is not on its
            own enough to identify one. */}
        <div>
          <dt>Soubor</dt>
          <dd>{fileName}</dd>
        </div>
      </dl>
      <p className="muted" style={{ marginBottom: 0 }}>
        Přepis je hotový — „Zahodit“ ho jen nepustí do grafů, nic dalšího se
        neposílá.
      </p>
    </Modal>
  );
}
