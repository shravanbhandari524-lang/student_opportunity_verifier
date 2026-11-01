import { NextResponse } from "next/server";

export function middleware(request) {
  const { pathname } = request.nextUrl;
  const accept = request.headers.get("accept") || "";
  const secFetchDest = request.headers.get("sec-fetch-dest") || "";

  // A browser document navigation explicitly requests text/html
  const isHtmlNavigation = accept.includes("text/html") || secFetchDest === "document";

  // If this is an API call or JSON request to /history or /history/:id
  if (pathname === "/history" && !isHtmlNavigation) {
    return NextResponse.rewrite(new URL("/api/history", request.url));
  }

  const historyDetailMatch = pathname.match(/^\/history\/([^/]+)$/);
  if (historyDetailMatch && !isHtmlNavigation) {
    const runId = historyDetailMatch[1];
    return NextResponse.rewrite(new URL(`/api/history/${runId}`, request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/history", "/history/:id*"],
};
