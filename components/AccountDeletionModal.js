"use client";

import React, { useEffect, useState } from "react";
import Button from "./ui/Button.js";

export default function AccountDeletionModal({ isOpen, onClose, onConfirm }) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === "Escape" && isOpen && !deleting) {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, deleting, onClose]);

  if (!isOpen) return null;

  async function handleDelete() {
    try {
      setDeleting(true);
      setError(null);
      await onConfirm();
    } catch (err) {
      setError(err?.message || "Failed to delete account. Please try again.");
      setDeleting(false);
    }
  }

  return React.createElement(
    "div",
    {
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": "delete-account-title",
      className: "fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-150",
    },
    React.createElement("div", {
      className: "fixed inset-0",
      onClick: () => !deleting && onClose(),
      "aria-hidden": "true",
    }),
    React.createElement(
      "div",
      {
        className: "relative w-full max-w-md bg-white dark:bg-[#121215] border border-[#E5E7EB] dark:border-white/10 rounded-2xl p-6 shadow-2xl flex flex-col gap-4 z-10 animate-in zoom-in-95 duration-150",
      },
      React.createElement(
        "div",
        { className: "flex items-start gap-3" },
        React.createElement(
          "div",
          { className: "w-10 h-10 rounded-full bg-red-100 dark:bg-red-950/50 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0" },
          React.createElement(
            "svg",
            { width: "20", height: "20", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2" },
            React.createElement("path", { d: "M3 6h18" }),
            React.createElement("path", { d: "M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" }),
            React.createElement("path", { d: "M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" }),
            React.createElement("line", { x1: "10", y1: "11", x2: "10", y2: "17" }),
            React.createElement("line", { x1: "14", y1: "11", x2: "14", y2: "17" })
          )
        ),
        React.createElement(
          "div",
          null,
          React.createElement("h2", { id: "delete-account-title", className: "text-base font-semibold text-neutral-900 dark:text-white" }, "Delete account and data?"),
          React.createElement("p", { className: "mt-1 text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed" }, "This will permanently delete your user profile and active sessions. Your verification history will be disassociated from your account and will expire automatically after 24 hours.")
        )
      ),
      error && React.createElement("div", { className: "p-3 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/30" }, error),
      React.createElement(
        "div",
        { className: "flex items-center justify-end gap-2.5 pt-2 border-t border-neutral-100 dark:border-white/5" },
        React.createElement(Button, { type: "button", variant: "outline", size: "sm", onClick: onClose, disabled: deleting }, "Cancel"),
        React.createElement("button", {
          type: "button",
          onClick: handleDelete,
          disabled: deleting,
          className: "inline-flex items-center justify-center px-4 py-2 rounded-lg text-xs font-semibold text-white bg-red-600 hover:bg-red-700 active:scale-[0.98] transition-all disabled:opacity-50",
        }, deleting ? "Deleting..." : "Delete Account")
      )
    )
  );
}
