import {
  LEGAL_STATUS,
  LEGAL_UPDATED,
  LEGAL_UPDATED_KO,
  legalDocs,
  type LegalDoc,
  type LegalDocId,
} from "../../../shared/legal";
import { L, LOCALE } from "../i18n";
import { Notice, Sheet } from "./ui";

/** 개인정보처리방침·이용약관 본문. 시트 안에서도, 동의 화면 안에서도 쓴다. */
export function LegalDocView({ doc }: { doc: LegalDoc }) {
  return (
    <article className="legal">
      {LEGAL_STATUS === "draft" && (
        <Notice tone="monitor">
          <strong>{L("Draft for legal review.", "법률 검토 전 초안입니다.")}</strong>{" "}
          {L("This text isn't final and isn't in effect yet.", "아직 확정되지 않았고 시행 전이에요.")}
        </Notice>
      )}
      <h3>{doc.title}</h3>
      <p className="legal-meta">
        {L(`Last updated ${LEGAL_UPDATED}`, `최종 수정 ${LEGAL_UPDATED_KO}`)}
      </p>
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
  const content = legalDocs(LOCALE)[doc];
  return (
    <Sheet label={content.title} onClose={onClose}>
      <LegalDocView doc={content} />
      <button className="btn btn-secondary mt-24" onClick={onClose}>
        {L("Close", "닫기")}
      </button>
    </Sheet>
  );
}
