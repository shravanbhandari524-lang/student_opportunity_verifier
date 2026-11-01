import React from "react";
import { notFound } from "next/navigation.js";
import Link from "next/link.js";
import { getGuideByType } from "../../../lib/guides/index.js";

const h = React.createElement;

export const dynamic = "force-static";

export function generateStaticParams() {
  return [
    { type: "scholarship_scam" },
    { type: "internship_scam" },
    { type: "task_scam" },
    { type: "mule_account" },
    { type: "contest_fraud" },
    { type: "overseas_agent" },
  ];
}

export async function generateMetadata({ params }) {
  const { type } = await params;
  const guide = getGuideByType(type);

  if (!guide) {
    return {
      title: "Guide Not Found",
      description: "The requested opportunity fraud guide was not found.",
    };
  }

  return {
    title: `${guide.title} — Scam Awareness Guide`,
    description: guide.summary,
    openGraph: {
      title: `${guide.title} — Student Scam Guide`,
      description: guide.summary,
      type: "article",
    },
  };
}

export default async function GuideDetailPage({ params }) {
  const { type } = await params;
  const guide = getGuideByType(type);

  if (!guide) {
    notFound();
  }

  return h(
    "div",
    {
      style: {
        maxWidth: "840px",
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        gap: "2.5rem",
      },
    },
    // Top Breadcrumb & Category
    h(
      "div",
      null,
      h(
        Link,
        {
          href: "/guides",
          style: {
            display: "inline-flex",
            alignItems: "center",
            gap: "0.4rem",
            fontSize: "0.88rem",
            color: "var(--accent-primary, #2563eb)",
            textDecoration: "none",
            marginBottom: "0.75rem",
          },
        },
        "← All Guides & Archetypes"
      ),
      h(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            flexWrap: "wrap",
            marginBottom: "0.5rem",
          },
        },
        h(
          "span",
          {
            style: {
              fontSize: "0.75rem",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              padding: "0.2rem 0.5rem",
              borderRadius: "4px",
              backgroundColor: "var(--bg-card-subtle, #f3f4f6)",
              color: "var(--text-secondary)",
            },
          },
          guide.type.replace(/_/g, " ")
        ),
        h(
          "span",
          {
            style: {
              fontSize: "0.75rem",
              padding: "0.2rem 0.5rem",
              borderRadius: "4px",
              backgroundColor:
                guide.reviewStatus === "human_reviewed"
                  ? "rgba(16, 185, 129, 0.12)"
                  : "rgba(245, 158, 11, 0.12)",
              color:
                guide.reviewStatus === "human_reviewed"
                  ? "var(--success-primary, #10b981)"
                  : "var(--warning-primary, #f59e0b)",
              fontWeight: 600,
            },
          },
          guide.reviewStatus === "human_reviewed" ? "✓ Human Reviewed" : "Draft — Needs Review"
        ),
        h(
          "span",
          {
            style: {
              fontSize: "0.8rem",
              color: "var(--text-muted, #9ca3af)",
            },
          },
          `Last reviewed: ${guide.lastReviewed}`
        )
      ),
      h(
        "h1",
        {
          style: {
            fontSize: "2.2rem",
            fontWeight: 800,
            letterSpacing: "-0.02em",
            margin: "0.25rem 0",
          },
        },
        guide.title
      ),
      h(
        "p",
        {
          style: {
            color: "var(--text-secondary)",
            fontSize: "1.05rem",
            lineHeight: 1.6,
            marginTop: "0.5rem",
          },
        },
        guide.summary
      )
    ),

    // How It Works Section
    h(
      "section",
      {
        className: "card",
        style: {
          display: "flex",
          flexDirection: "column",
          gap: "1rem",
        },
      },
      h(
        "h2",
        {
          style: {
            fontSize: "1.25rem",
            fontWeight: 700,
            margin: 0,
          },
        },
        "How This Pattern Operates"
      ),
      h(
        "ol",
        {
          style: {
            margin: 0,
            paddingLeft: "1.25rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.75rem",
          },
        },
        ...guide.howItWorks.map((step, idx) =>
          h(
            "li",
            {
              key: idx,
              style: {
                fontSize: "0.95rem",
                lineHeight: 1.5,
              },
            },
            step
          )
        )
      )
    ),

    // Red Flags Section
    h(
      "section",
      {
        className: "card",
        style: {
          display: "flex",
          flexDirection: "column",
          gap: "1rem",
          borderColor: "rgba(239, 68, 68, 0.25)",
        },
      },
      h(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            gap: "0.4rem",
          },
        },
        h("span", { style: { fontSize: "1.2rem" } }, "🚩"),
        h(
          "h2",
          {
            style: {
              fontSize: "1.25rem",
              fontWeight: 700,
              margin: 0,
              color: "var(--danger-primary, #ef4444)",
            },
          },
          "Warning Red Flags"
        )
      ),
      h(
        "ul",
        {
          style: {
            margin: 0,
            paddingLeft: "1.25rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.6rem",
          },
        },
        ...guide.redFlags.map((flag, idx) =>
          h(
            "li",
            {
              key: idx,
              style: {
                fontSize: "0.95rem",
                lineHeight: 1.5,
              },
            },
            flag
          )
        )
      )
    ),

    // What to Verify Before Acting
    h(
      "section",
      {
        className: "card",
        style: {
          display: "flex",
          flexDirection: "column",
          gap: "1rem",
        },
      },
      h(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            gap: "0.4rem",
          },
        },
        h("span", { style: { fontSize: "1.2rem" } }, "🔍"),
        h(
          "h2",
          {
            style: {
              fontSize: "1.25rem",
              fontWeight: 700,
              margin: 0,
            },
          },
          "What to Verify Before Acting"
        )
      ),
      h(
        "ul",
        {
          style: {
            margin: 0,
            paddingLeft: "1.25rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.6rem",
          },
        },
        ...guide.whatToVerify.map((item, idx) =>
          h(
            "li",
            {
              key: idx,
              style: {
                fontSize: "0.95rem",
                lineHeight: 1.5,
              },
            },
            item
          )
        )
      )
    ),

    // What To Do (Safe Actions)
    h(
      "section",
      {
        className: "card",
        style: {
          display: "flex",
          flexDirection: "column",
          gap: "1rem",
        },
      },
      h(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            gap: "0.4rem",
          },
        },
        h("span", { style: { fontSize: "1.2rem" } }, "🛡️"),
        h(
          "h2",
          {
            style: {
              fontSize: "1.25rem",
              fontWeight: 700,
              margin: 0,
            },
          },
          "Recommended Safe Next Steps"
        )
      ),
      h(
        "ul",
        {
          style: {
            margin: 0,
            paddingLeft: "1.25rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.6rem",
          },
        },
        ...guide.whatToDo.map((step, idx) =>
          h(
            "li",
            {
              key: idx,
              style: {
                fontSize: "0.95rem",
                lineHeight: 1.5,
              },
            },
            step
          )
        )
      )
    ),

    // Already Paid or Shared Details Help Callout
    h(
      "section",
      {
        className: "card",
        style: {
          display: "flex",
          flexDirection: "column",
          gap: "1rem",
          backgroundColor: "var(--bg-card-subtle, #f9fafb)",
        },
      },
      h(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            gap: "0.4rem",
          },
        },
        h("span", { style: { fontSize: "1.2rem" } }, "⚠️"),
        h(
          "h2",
          {
            style: {
              fontSize: "1.25rem",
              fontWeight: 700,
              margin: 0,
            },
          },
          "Already Paid or Shared Details?"
        )
      ),
      h(
        "ul",
        {
          style: {
            margin: 0,
            paddingLeft: "1.25rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.6rem",
          },
        },
        ...guide.alreadyPaid.map((item, idx) =>
          h(
            "li",
            {
              key: idx,
              style: {
                fontSize: "0.95rem",
                lineHeight: 1.5,
              },
            },
            item
          )
        )
      ),
      h(
        "div",
        { style: { marginTop: "0.5rem" } },
        h(
          Link,
          {
            href: "/report-fraud",
            className: "button button-primary",
            style: {
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: "0.4rem",
              padding: "0.6rem 1.1rem",
              fontWeight: 700,
            },
          },
          "🚨 Go to Fraud Assistance & Complaint Generator →"
        )
      )
    ),

    // Sources & Citations
    guide.sources && guide.sources.length > 0
      ? h(
          "section",
          {
            className: "card",
            style: {
              display: "flex",
              flexDirection: "column",
              gap: "0.75rem",
            },
          },
          h(
            "h3",
            {
              style: {
                fontSize: "1.05rem",
                fontWeight: 700,
                margin: 0,
              },
            },
            "Sources & Public Advisories"
          ),
          h(
            "ul",
            {
              style: {
                margin: 0,
                paddingLeft: "1.25rem",
                display: "flex",
                flexDirection: "column",
                gap: "0.5rem",
              },
            },
            ...guide.sources.map((src) =>
              h(
                "li",
                {
                  key: src.id,
                  style: {
                    fontSize: "0.88rem",
                    lineHeight: 1.4,
                  },
                },
                h(
                  "a",
                  {
                    href: src.url,
                    target: "_blank",
                    rel: "noopener noreferrer",
                    style: {
                      color: "var(--accent-primary, #2563eb)",
                      textDecoration: "underline",
                    },
                  },
                  src.title
                ),
                " ",
                h(
                  "span",
                  {
                    style: {
                      color: "var(--text-muted, #9ca3af)",
                    },
                  },
                  `(${src.publisher})`
                )
              )
            )
          )
        )
      : null,

    // Bottom CTA Card
    h(
      "div",
      {
        className: "card",
        style: {
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "1rem",
          padding: "1.25rem 1.5rem",
        },
      },
      h(
        "div",
        null,
        h(
          "strong",
          { style: { fontSize: "1.05rem" } },
          "Have a message or screenshot you want to verify?"
        ),
        h(
          "p",
          {
            style: {
              margin: "0.2rem 0 0 0",
              fontSize: "0.88rem",
              color: "var(--text-secondary)",
            },
          },
          "Our 6-agent verification pipeline analyzes payment IDs, domains, and text patterns."
        )
      ),
      h(
        Link,
        {
          href: "/check",
          className: "button button-accent",
          style: {
            textDecoration: "none",
            padding: "0.65rem 1.25rem",
            fontWeight: 700,
          },
        },
        "Check an Offer Now →"
      )
    )
  );
}
