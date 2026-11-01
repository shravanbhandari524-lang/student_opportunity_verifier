import Link from "next/link";

export const metadata = {
  title: "Page Not Found — Opportunity Verifier",
  description: "The requested page could not be found on Opportunity Verifier.",
};

/**
 * Global 404 Not Found Page
 * Clean, accessible fallback linking to home and opportunity checking.
 */
export default function NotFound() {
  return (
    <div
      style={{
        maxWidth: "600px",
        margin: "3.5rem auto",
        padding: "2rem 1.5rem",
        textAlign: "center",
      }}
    >
      <div
        className="card"
        style={{
          padding: "2.5rem 2rem",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "1.25rem",
          borderRadius: "var(--radius-lg, 16px)",
          boxShadow: "var(--shadow-md)",
          border: "1px solid var(--border-subtle)",
        }}
      >
        <div
          style={{
            width: "56px",
            height: "56px",
            borderRadius: "50%",
            backgroundColor: "var(--accent-light, #e0f2fe)",
            color: "var(--accent-primary, #0284c7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "1.5rem",
            fontWeight: 700,
          }}
          aria-hidden="true"
        >
          404
        </div>

        <h1
          style={{
            fontSize: "1.5rem",
            fontWeight: 700,
            color: "var(--text-primary)",
            margin: 0,
            letterSpacing: "-0.015em",
          }}
        >
          Page Not Found
        </h1>

        <p
          style={{
            fontSize: "0.95rem",
            color: "var(--text-secondary)",
            lineHeight: 1.55,
            margin: 0,
            maxWidth: "440px",
          }}
        >
          The page or guide you are looking for does not exist or may have been moved.
        </p>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.75rem",
            justifyContent: "center",
            marginTop: "0.5rem",
            width: "100%",
          }}
        >
          <Link
            href="/check"
            className="btn btn-primary"
            style={{
              padding: "0.65rem 1.25rem",
              fontSize: "0.92rem",
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Check an Offer
          </Link>
          <Link
            href="/guides"
            className="btn btn-secondary"
            style={{
              padding: "0.65rem 1.25rem",
              fontSize: "0.92rem",
              fontWeight: 500,
              textDecoration: "none",
            }}
          >
            Browse Scam Guides
          </Link>
          <Link
            href="/"
            className="btn btn-secondary"
            style={{
              padding: "0.65rem 1.25rem",
              fontSize: "0.92rem",
              fontWeight: 500,
              textDecoration: "none",
            }}
          >
            Return Home
          </Link>
        </div>
      </div>
    </div>
  );
}
