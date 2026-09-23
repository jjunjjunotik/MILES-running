import { useEffect, useMemo, useState } from "react";
import {
  ARTICLES,
  ARTICLE_CATEGORIES,
  ARTICLE_CATEGORY_LABELS,
  ARTICLE_DISCLAIMER,
  type ArticleCategory,
} from "../../../shared/articles";
import { fetchArticle, listArticles, type ArticleSummary } from "../lib/server";
import { STANDALONE_DEMO } from "../lib/api";
import { ChevronIcon, InfoIcon, SparkIcon } from "../components/Icons";
import { Empty, Notice, TopBar } from "../components/ui";

type Filter = "all" | ArticleCategory;

/**
 * 건강 정보 라이브러리.
 *
 * 서버에서 받아오되, 서버가 없거나(데모 빌드) 네트워크가 끊겼으면 앱에 함께 실린
 * 같은 내용으로 보여 준다. 읽을거리는 오프라인에서도 막히지 않아야 한다.
 */
export function LibraryScreen() {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState<ArticleSummary[] | null>(null);
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const [body, setBody] = useState<string | null>(null);

  // 서버 목록을 한 번 받아 둔다. 실패하면 내장 내용으로 돌아간다.
  useEffect(() => {
    if (STANDALONE_DEMO) return;
    let cancelled = false;
    void listArticles({})
      .then((articles) => {
        if (!cancelled) setRemote(articles);
      })
      .catch(() => {
        if (!cancelled) setRemote(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const all: ArticleSummary[] = useMemo(
    () =>
      remote ??
      ARTICLES.map((article) => ({
        id: article.slug,
        slug: article.slug,
        category: article.category,
        title: article.title,
        summary: article.summary,
        tags: article.tags,
      })),
    [remote],
  );

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return all.filter((article) => {
      if (filter !== "all" && article.category !== filter) return false;
      if (!needle) return true;
      const bundled = ARTICLES.find((item) => item.slug === article.slug);
      return [article.title, article.summary, article.tags, bundled?.body ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [all, filter, query]);

  async function open(slug: string) {
    setOpenSlug(slug);
    const bundled = ARTICLES.find((item) => item.slug === slug);
    setBody(bundled?.body ?? null);

    if (STANDALONE_DEMO) return;
    try {
      const article = await fetchArticle(slug);
      setBody(article.body);
    } catch {
      // 내장 내용이 이미 떠 있으므로 그대로 둔다.
    }
  }

  if (openSlug) {
    const summary = all.find((item) => item.slug === openSlug);
    return (
      <>
        <TopBar
          title="건강 정보"
          left={
            <button
              className="icon-btn"
              onClick={() => {
                setOpenSlug(null);
                setBody(null);
              }}
              aria-label="목록으로"
            >
              <span style={{ transform: "rotate(180deg)", display: "grid" }}>
                <ChevronIcon size={18} />
              </span>
            </button>
          }
        />
        <main className="screen stagger">
          <div className="article-head">
            <span className="pill pill-accent">
              {ARTICLE_CATEGORY_LABELS[
                (summary?.category ?? "care") as ArticleCategory
              ]}
            </span>
            <h2>{summary?.title}</h2>
            <p className="small muted">{summary?.summary}</p>
          </div>

          <article className="card article-body">
            {(body ?? "").split("\n\n").map((paragraph, index) => (
              <Paragraph key={index} text={paragraph} />
            ))}
          </article>

          <div className="mt-16">
            <Notice icon={<InfoIcon size={15} />}>{ARTICLE_DISCLAIMER}</Notice>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <TopBar title="건강 정보" />
      <main className="screen stagger">
        <input
          className="field"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="궁금한 내용을 검색해 보세요"
          aria-label="건강 정보 검색"
        />

        <div className="chip-row mt-12">
          <button
            className={`chip${filter === "all" ? " active" : ""}`}
            onClick={() => setFilter("all")}
          >
            전체
          </button>
          {ARTICLE_CATEGORIES.map((category) => (
            <button
              key={category}
              className={`chip${filter === category ? " active" : ""}`}
              onClick={() => setFilter(category)}
            >
              {ARTICLE_CATEGORY_LABELS[category]}
            </button>
          ))}
        </div>

        {shown.length === 0 ? (
          <Empty
            icon={<SparkIcon size={24} />}
            title="찾는 내용이 없어요"
            body="다른 단어로 검색하거나 카테고리를 바꿔 보세요."
          />
        ) : (
          <div className="mt-16">
            {shown.map((article) => (
              <button
                key={article.slug}
                className="card article-card"
                onClick={() => void open(article.slug)}
              >
                <div className="flex-1">
                  <span className="small muted">
                    {ARTICLE_CATEGORY_LABELS[article.category]}
                  </span>
                  <div className="t">{article.title}</div>
                  <div className="s">{article.summary}</div>
                </div>
                <ChevronIcon size={16} />
              </button>
            ))}
          </div>
        )}

        <div className="mt-16">
          <Notice icon={<InfoIcon size={15} />}>{ARTICLE_DISCLAIMER}</Notice>
        </div>
      </main>
    </>
  );
}

/** 굵게 표시(**)만 가볍게 살린다. 본문은 앱이 직접 쓴 글이라 이 정도면 충분하다. */
function Paragraph({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <p className="para">
      {lines.map((line, lineIndex) => (
        <span key={lineIndex}>
          {line.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
            part.startsWith("**") && part.endsWith("**") ? (
              <strong key={index}>{part.slice(2, -2)}</strong>
            ) : (
              <span key={index}>{part}</span>
            ),
          )}
          {lineIndex < lines.length - 1 ? <br /> : null}
        </span>
      ))}
    </p>
  );
}
