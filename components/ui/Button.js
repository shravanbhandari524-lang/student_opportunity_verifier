import React from "react";

export default function Button({
  children,
  variant = "primary",
  size = "md",
  className = "",
  disabled = false,
  loading = false,
  type = "button",
  onClick,
  ...props
}) {
  const baseStyles =
    "inline-flex items-center justify-center font-medium rounded-md select-none transition-all duration-150 ease-out active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 dark:focus-visible:ring-white focus-visible:ring-offset-2 dark:focus-visible:ring-offset-black";

  const sizeStyles = {
    sm: "h-8 px-2.5 text-xs gap-1.5",
    md: "h-9 sm:h-9 min-h-[44px] sm:min-h-0 px-4 text-sm gap-2",
    lg: "h-11 px-5 text-base gap-2.5",
  }[size] || "h-9 px-4 text-sm gap-2";

  const variantStyles = {
    primary:
      "bg-[#0A0A0A] dark:bg-white text-white dark:text-[#0A0A0A] hover:bg-neutral-800 dark:hover:bg-neutral-200 shadow-xs",
    secondary:
      "bg-neutral-100 dark:bg-white/10 text-neutral-900 dark:text-neutral-100 hover:bg-neutral-200 dark:hover:bg-white/15",
    outline:
      "border border-[#E5E7EB] dark:border-white/15 bg-transparent text-neutral-800 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-white/5",
    ghost:
      "bg-transparent text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-white/10",
    danger:
      "bg-rose-600 text-white hover:bg-rose-700 shadow-xs",
  }[variant] || "";

  const content = loading
    ? [
        React.createElement("span", {
          key: "spinner",
          className: "w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin",
          "aria-hidden": "true",
        }),
        React.createElement("span", { key: "label" }, children),
      ]
    : children;

  return React.createElement(
    "button",
    {
      type,
      disabled: disabled || loading,
      onClick,
      className: `${baseStyles} ${sizeStyles} ${variantStyles} ${className}`,
      ...props,
    },
    content
  );
}
