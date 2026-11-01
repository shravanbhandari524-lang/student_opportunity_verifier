import { cookies } from "next/headers";
import { Geist, JetBrains_Mono } from "next/font/google";
import Header from "../components/Header.js";
import Footer from "../components/Footer.js";
import { AuthProvider } from "../components/AuthContext.js";
import AuthErrorToast from "../components/AuthErrorToast.js";
import { getAuthSession, isGoogleAuthConfigured } from "../lib/auth.js";
import { getDb } from "../lib/db/index.js";
import { env } from "../lib/env.js";
import "./globals.css";

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata = {
  title: "Verifier — Student Digital Safety & Opportunity Authenticity",
  description:
    "Deterministic multi-agent verification workspace for institutional authenticity, scholarship validation, and job offer fraud triage.",
};

const themeInitScript = `
(function() {
  try {
    var theme = localStorage.getItem('ov_theme');
    if (!theme) {
      theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', theme);
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  } catch (e) {}
})();
`;

export default async function RootLayout({ children }) {
  let initialUser = null;
  const authConfigured = isGoogleAuthConfigured(env);

  if (authConfigured) {
    try {
      const cookieStore = await cookies();
      const auth = await getAuthSession({ cookies: cookieStore }, getDb(), env);
      if (auth?.user) {
        initialUser = {
          id: auth.user.id,
          name: auth.user.name,
          email: auth.user.email,
          avatarUrl: auth.user.avatarUrl || auth.user.avatar_url || null,
        };
      }
    } catch {}
  }

  return (
    <html lang="en" className={`${geistSans.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-white dark:bg-[#0A0A0C] text-[#111827] dark:text-[#F9FAFB] font-sans antialiased min-h-screen flex flex-col" suppressHydrationWarning>
        <AuthProvider initialUser={initialUser} authConfigured={authConfigured}>
          <Header />
          <main id="main-content" className="flex-1 flex flex-col w-full">
            {children}
          </main>
          <Footer />
          <AuthErrorToast />
        </AuthProvider>
      </body>
    </html>
  );
}
