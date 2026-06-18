'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import toast, { Toaster } from 'react-hot-toast';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;

    setLoading(false);
    setLoading(true);

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
      
      // O FastAPI espera os dados formatados como URL-encoded form
      const formData = new URLSearchParams();
      formData.append('username', email); // O FastAPI lê o campo de login como 'username'
      formData.append('password', password);

      const response = await fetch(`${apiUrl}/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || 'Falha ao efetuar login');
      }

      // SALVA O TOKEN: Guarda o token JWT gerado pelo backend
      localStorage.setItem('fleet_token', data.access_token);
      
      toast.success('Login efetuado com sucesso!');
      
      // Redireciona o usuário para o Dashboard principal
      router.push('/');
    } catch (err: any) {
      toast.error(err.message || 'E-mail ou senha incorretos.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <Toaster position="top-right" />
      
      <div className="w-full max-w-md bg-white p-8 rounded-2xl border border-gray-200 shadow-sm">
        <div className="text-center mb-8">
          <div className="text-4xl mb-2">🚛</div>
          <h1 className="text-2xl font-bold text-gray-800">Controle de Frota</h1>
          <p className="text-sm text-gray-400 mt-1">Insira suas credenciais para acessar o painel</p>
        </div>

        <form onSubmit={handleLogin} className="flex flex-col gap-4">
          <div>
            <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-1">
              Usuário ou E-mail
            </label>
            <input
              type="text"
              placeholder="Ex: admin"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-2 border border-gray-200 rounded-xl outline-none focus:border-blue-500 bg-gray-50/50"
              required
            />
          </div>

          <div>
            <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-1">
              Senha
            </label>
            <input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2 border border-gray-200 rounded-xl outline-none focus:border-blue-500 bg-gray-50/50"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-xl transition shadow-sm mt-2 disabled:bg-blue-400"
          >
            {loading ? 'Autenticando...' : 'Entrar no Sistema'}
          </button>
        </form>
      </div>
    </div>
  );
}