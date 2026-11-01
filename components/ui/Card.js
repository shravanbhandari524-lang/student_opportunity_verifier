import React from "react";

export default function Card({ children, className = "", hover = false, ...props }) {
  const hoverClass = hover
    ? "transition-all duration-150 ease-out hover:border-neutral-400 dark:hover:border-white/25 hover:shadow-sm"
    : "";

  return React.createElement(
    "div",
    {
      className: `rounded-xl border border-[#E5E7EB] dark:border-white/10 bg-white dark:bg-[#121215] shadow-xs ${hoverClass} ${className}`,
      ...props,
    },
    children
  );
}
