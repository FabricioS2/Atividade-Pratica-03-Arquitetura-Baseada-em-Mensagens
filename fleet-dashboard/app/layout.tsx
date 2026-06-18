import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// 1. IMPORTANTE: Importe o componente Guardião aqui. 
// Ajuste o caminho se a sua pasta "components" estiver em outro local (ex: "../components/AuthGuard")
import AuthGuard from "@/components/AuthGuard";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Fleet Monitor - Caminhões Refrigerados",
  description: "Monitoramento em tempo real da frota via MQTT",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className={inter.className}>
        
        {/* 2. O AuthGuard intercepta o carregamento de qualquer página */}
        <AuthGuard>
          {children}
        </AuthGuard>

      </body>
    </html>
  );
}