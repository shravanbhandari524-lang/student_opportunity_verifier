"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * Global App Error Boundary
 * Displays a graceful, safe recovery interface without exposing internal errors or stack traces.
 */
export default function ErrorBoundary({ error, reset }) {
  useEffect(() => {
    // Graceful error logging
    if (error) {
      console.error("Application error boundary triggered");
    }
  }, [error]);

  return (
    <div
      style={{
        maxWidth: "600px",
        margin: "3rem auto",
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
            backgroundColor: "var(--risk-high-bg, #fee2e2)",
            color: "var(--risk-high, #dc2626)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "1.75rem",
          }}
          aria-hidden="true"
        >
          ⚠️
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
          Something Went Wrong
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
          We encountered an unexpected problem processing this page. Your verification data and inputs remain secure.
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
          <button
            type="button"
            onClick={() => reset()}
            className="btn btn-primary"
            style={{
              padding: "0.65rem 1.25rem",
              fontSize: "0.92rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try Again
          </button>
          <Link
            href="/check"
            className="btn btn-secondary"
            style={{
              padding: "0.65rem 1.25rem",
              fontSize: "0.92rem",
              fontWeight: 500,
              textDecoration: "none",
            }}
          >
            Check an Offer
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
