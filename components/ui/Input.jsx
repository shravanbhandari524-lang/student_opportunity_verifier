import React from "react";

export function Input({
  label,
  error,
  helperText,
  id,
  className = "",
  type = "text",
  required = false,
  ...props
}) {
  const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, "-") : undefined);

  return (
    <div className="flex flex-col gap-1.5 w-full">
      {label && (
        <label htmlFor={inputId} className="text-xs font-semibold text-neutral-800 dark:text-neutral-200">
          {label}
          {required && <span className="text-rose-500 ml-0.5">*</span>}
        </label>
      )}
      <input
        id={inputId}
        type={type}
        required={required}
        className={`w-full min-h-[44px] sm:min-h-[38px] px-3 text-sm rounded-md border bg-white dark:bg-[#121215] text-[#0A0A0A] dark:text-white placeholder:text-neutral-400 dark:placeholder:text-neutral-500 transition-colors focus:outline-none focus:ring-2 focus:ring-[#0A0A0A] dark:focus:ring-white focus:border-transparent ${
          error
            ? "border-rose-500 dark:border-rose-500 focus:ring-rose-500"
            : "border-[#E5E7EB] dark:border-white/10 hover:border-neutral-400 dark:hover:border-white/20"
        } ${className}`}
        {...props}
      />
      {error && <p className="text-xs text-rose-600 dark:text-rose-400 font-medium">{error}</p>}
      {helperText && !error && <p className="text-xs text-neutral-500 dark:text-neutral-400">{helperText}</p>}
    </div>
  );
}

export function Textarea({
  label,
  error,
  helperText,
  id,
  className = "",
  rows = 4,
  required = false,
  ...props
}) {
  const textareaId = id || (label ? label.toLowerCase().replace(/\s+/g, "-") : undefined);

  return (
    <div className="flex flex-col gap-1.5 w-full">
      {label && (
        <label htmlFor={textareaId} className="text-xs font-semibold text-neutral-800 dark:text-neutral-200">
          {label}
          {required && <span className="text-rose-500 ml-0.5">*</span>}
        </label>
      )}
      <textarea
        id={textareaId}
        rows={rows}
        required={required}
        className={`w-full p-3 text-sm rounded-md border bg-white dark:bg-[#121215] text-[#0A0A0A] dark:text-white placeholder:text-neutral-400 dark:placeholder:text-neutral-500 transition-colors focus:outline-none focus:ring-2 focus:ring-[#0A0A0A] dark:focus:ring-white focus:border-transparent resize-y ${
          error
            ? "border-rose-500 dark:border-rose-500 focus:ring-rose-500"
            : "border-[#E5E7EB] dark:border-white/10 hover:border-neutral-400 dark:hover:border-white/20"
        } ${className}`}
        {...props}
      />
      {error && <p className="text-xs text-rose-600 dark:text-rose-400 font-medium">{error}</p>}
      {helperText && !error && <p className="text-xs text-neutral-500 dark:text-neutral-400">{helperText}</p>}
    </div>
  );
}
