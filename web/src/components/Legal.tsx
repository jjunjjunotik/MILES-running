import {
  LEGAL_DOCS,
  LEGAL_STATUS,
  LEGAL_UPDATED,
  type LegalDoc,
  type LegalDocId,
} from "../../../shared/legal";
import { Notice, Sheet } from "./ui";

/** 개인정보처리방침·이용약관 본문. 시트 안에서도, 동의 화면 안에서도 쓴다. */
export function LegalDocView({ doc }: { doc: LegalDoc }) {
  return (
    <article className="legal">
      {LEGAL_STATUS === "draft" && (
        <Notice tone="monitor">
          <strong>Draft for legal review.</strong> This text isn't final and isn't in
          effect yet.
        </Notice>
      )}
      <h3>{doc.title}</h3>
      <p className="legal-meta">Last updated {LEGAL_UPDATED}</p>
      <p>{doc.intro}</p>
      {doc.sections.map((section) => (
        <section key={section.heading}>
          <h4>{section.heading}</h4>
          {section.paragraphs?.map((text) => <p key={text}>{text}</p>)}
          {section.bullets && (
            <ul>
              {section.bullets.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          )}
          {section.after?.map((text) => <p key={text}>{text}</p>)}
        </section>
      ))}
    </article>
  );
}

export function LegalSheet({
  doc,
  onClose,
}: {
  doc: LegalDocId;
  onClose: () => void;
}) {
  const content = LEGAL_DOCS[doc];
  return (
    <Sheet label={content.title} onClose={onClose}>
      <LegalDocView doc={content} />
      <button className="btn btn-secondary mt-24" onClick={onClose}>
        Close
      </button>
    </Sheet>
  );
}
