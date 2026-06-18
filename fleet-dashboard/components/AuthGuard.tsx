'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    // Se a rota atual já for a página de login, ignora a validação para evitar loop infinito
    if (pathname === '/login') {
      setAuthorized(true);
      return;
    }

    const token = localStorage.getItem('fleet_token');

    if (!token) {
      setAuthorized(false);
      router.push('/login');
    } else {
      setAuthorized(true);
    }
  }, [pathname, router]);

  // Enquanto verifica o token, exibe uma tela neutra de carregamento
  if (!authorized && pathname !== '/login') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-500 text-sm font-medium">
        Verificando autenticação...
      </div>
    );
  }

  return <>{children}</>;
}