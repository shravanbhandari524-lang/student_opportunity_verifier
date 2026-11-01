import React from "react";

const h = React.createElement;

export default function Icon({ name, className = "w-4 h-4", size = 18 }) {
  const s = size;
  const commonProps = {
    width: s,
    height: s,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className,
  };

  switch (name) {
    case "grid_view":
      return h("svg", commonProps,
        h("rect", { x: 3, y: 3, width: 7, height: 7, rx: 1 }),
        h("rect", { x: 14, y: 3, width: 7, height: 7, rx: 1 }),
        h("rect", { x: 14, y: 14, width: 7, height: 7, rx: 1 }),
        h("rect", { x: 3, y: 14, width: 7, height: 7, rx: 1 })
      );
    case "add_circle":
      return h("svg", commonProps,
        h("circle", { cx: 12, cy: 12, r: 10 }),
        h("line", { x1: 12, y1: 8, x2: 12, y2: 16 }),
        h("line", { x1: 8, y1: 12, x2: 16, y2: 12 })
      );
    case "history":
      return h("svg", commonProps,
        h("path", { d: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" }),
        h("path", { d: "M3 3v5h5" }),
        h("path", { d: "M12 7v5l4 2" })
      );
    case "menu_book":
      return h("svg", commonProps,
        h("path", { d: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20" }),
        h("path", { d: "M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" })
      );
    case "report":
    case "flag":
      return h("svg", commonProps,
        h("path", { d: "M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" }),
        h("line", { x1: 4, y1: 22, x2: 4, y2: 15 })
      );
    case "info":
      return h("svg", commonProps,
        h("circle", { cx: 12, cy: 12, r: 10 }),
        h("line", { x1: 12, y1: 16, x2: 12, y2: 12 }),
        h("line", { x1: 12, y1: 8, x2: 12.01, y2: 8 })
      );
    case "add":
      return h("svg", commonProps,
        h("line", { x1: 12, y1: 5, x2: 12, y2: 19 }),
        h("line", { x1: 5, y1: 12, x2: 19, y2: 12 })
      );
    case "chevron_right":
      return h("svg", commonProps,
        h("polyline", { points: "9 18 15 12 9 6" })
      );
    case "arrow_forward":
      return h("svg", commonProps,
        h("line", { x1: 5, y1: 12, x2: 19, y2: 12 }),
        h("polyline", { points: "12 5 19 12 12 19" })
      );
    case "content_paste":
      return h("svg", commonProps,
        h("rect", { width: 8, height: 4, x: 8, y: 2, rx: 1, ry: 1 }),
        h("path", { d: "M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" })
      );
    case "add_photo_alternate":
    case "image":
      return h("svg", commonProps,
        h("rect", { width: 18, height: 18, x: 3, y: 3, rx: 2, ry: 2 }),
        h("circle", { cx: 9, cy: 9, r: 2 }),
        h("path", { d: "m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" })
      );
    case "close":
      return h("svg", commonProps,
        h("line", { x1: 18, y1: 6, x2: 6, y2: 18 }),
        h("line", { x1: 6, y1: 6, x2: 18, y2: 18 })
      );
    case "expand_more":
      return h("svg", commonProps,
        h("polyline", { points: "6 9 12 15 18 9" })
      );
    case "expand_less":
      return h("svg", commonProps,
        h("polyline", { points: "18 15 12 9 6 15" })
      );
    case "link":
      return h("svg", commonProps,
        h("path", { d: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" }),
        h("path", { d: "M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" })
      );
    case "account_balance_wallet":
      return h("svg", commonProps,
        h("path", { d: "M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" }),
        h("path", { d: "M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" })
      );
    case "call":
      return h("svg", commonProps,
        h("path", { d: "M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" })
      );
    case "corporate_fare":
      return h("svg", commonProps,
        h("rect", { width: 16, height: 20, x: 4, y: 2, rx: 2, ry: 2 }),
        h("path", { d: "M9 22v-4h6v4" }),
        h("path", { d: "M8 6h.01" }),
        h("path", { d: "M16 6h.01" }),
        h("path", { d: "M12 6h.01" }),
        h("path", { d: "M12 10h.01" }),
        h("path", { d: "M12 14h.01" }),
        h("path", { d: "M16 10h.01" }),
        h("path", { d: "M16 14h.01" }),
        h("path", { d: "M8 10h.01" }),
        h("path", { d: "M8 14h.01" })
      );
    case "alternate_email":
      return h("svg", commonProps,
        h("circle", { cx: 12, cy: 12, r: 4 }),
        h("path", { d: "M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" })
      );
    case "clear_all":
      return h("svg", commonProps,
        h("line", { x1: 18, y1: 6, x2: 6, y2: 6 }),
        h("line", { x1: 21, y1: 12, x2: 3, y2: 12 }),
        h("line", { x1: 15, y1: 18, x2: 9, y2: 18 })
      );
    case "error":
      return h("svg", commonProps,
        h("circle", { cx: 12, cy: 12, r: 10 }),
        h("line", { x1: 12, y1: 8, x2: 12, y2: 12 }),
        h("line", { x1: 12, y1: 16, x2: 12.01, y2: 16 })
      );
    case "menu":
      return h("svg", commonProps,
        h("line", { x1: 4, y1: 12, x2: 20, y2: 12 }),
        h("line", { x1: 4, y1: 6, x2: 20, y2: 6 }),
        h("line", { x1: 4, y1: 18, x2: 20, y2: 18 })
      );
    case "search":
      return h("svg", commonProps,
        h("circle", { cx: 11, cy: 11, r: 8 }),
        h("line", { x1: 21, y1: 21, x2: 16.65, y2: 16.65 })
      );
    case "check":
      return h("svg", commonProps,
        h("polyline", { points: "20 6 9 17 4 12" })
      );
    default:
      return h("span", { className }, name);
  }
}
