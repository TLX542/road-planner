import type { Metadata, Viewport } from "next";
import "leaflet/dist/leaflet.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Planificateur de Road Trip",
  description: "Planifiez des road trips à plusieurs étapes avec les temps de conduite et les écrans à prévoir.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Lets the mobile bottom sheets (see globals.css) pad themselves out to
  // the real edge of the screen using env(safe-area-inset-*) instead of
  // leaving a dead strip under the iOS home indicator / notch.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#edf1fa" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1120" },
  ],
};

// Applied before hydration so the map/page never flashes the wrong theme.
const themeInitScript = `
(function () {
  try {
    var stored = localStorage.getItem("trip-planner-theme");
    var theme = stored === "dark" || stored === "light"
      ? stored
      : (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.documentElement.dataset.theme = theme;
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}