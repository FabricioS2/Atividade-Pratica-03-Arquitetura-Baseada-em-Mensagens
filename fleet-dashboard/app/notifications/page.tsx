'use client';

import { useState, useEffect } from 'react';

// Tipagem baseada no schema NotificationOut do main.py
interface NotificationLog {
  id: number;
  truck_id: string;
  timestamp: string;
  alert_type: string;
  message: string;
}

export default function NotificationsPage() {
  const [logs, setLogs] = useState<NotificationLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLogs = async () => {
    try {
      // Consome da variável de ambiente que aponta para o FastAPI (main.py)
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
      const response = await fetch(`${apiUrl}/notifications?limit=50`);
      
      if (!response.ok) {
        throw new Error('Falha na resposta da API');
      }
      
      const data = await response.json();
      setLogs(data);
      setError(null);
    } catch (err) {
      console.error('Falha ao obter o histórico de alertas:', err);
      setError('Não foi possível carregar o histórico. Verifique se a API está rodando.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
    // Atualiza automaticamente a cada 10 segundos
    const interval = setInterval(fetchLogs, 10000); 
    return () => clearInterval(interval);
  }, []);

  const getAlertIcon = (type: string) => {
    switch (type) {
      case 'temp_low': return '❄️';
      case 'temp_high': return '🔥';
      case 'humidity': return '💧';
      case 'speed': return '🚛💨';
      case 'door_open': return '🚪⚠️';
      default: return '⚠️';
    }
  };

  return (
    <div className="container mx-auto p-4 max-w-4xl">
      
      {/* Cabeçalho */}
      <header className="mb-6 flex justify-between items-center bg-gray-50 p-4 rounded-xl border border-gray-100">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            Central de Notificações
          </h1>
          <p className="text-sm text-gray-500 mt-1">Registros de anomalias detectados no servidor</p>
        </div>
        <a 
          href="/" 
          className="text-sm font-medium px-4 py-2 border border-gray-200 bg-white rounded-lg hover:bg-gray-100 text-gray-700 transition shadow-sm"
        >
          Voltar ao Painel
        </a>
      </header>

      {/* Tratamento de Estados (Carregando, Erro, Vazio) */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">Buscando histórico na API...</div>
      ) : error ? (
        <div className="p-4 text-red-600 bg-red-50 rounded border border-red-200">
          <p className="font-bold">Erro de conexão</p>
          <p className="text-sm">{error}</p>
        </div>
      ) : logs.length === 0 ? (
        <div className="text-center py-12 bg-white border border-gray-100 rounded-xl shadow-sm text-gray-400">
          Nenhum alerta crítico registrado no momento.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {/* Lista de Notificações - Agora renderizando corretamente */}
          {logs.map((log) => (
            <div 
              key={log.id} 
              className="p-4 bg-white border border-gray-200 rounded-xl shadow-sm flex items-start gap-4"
            >
              <div className="text-2xl p-2 bg-gray-50 rounded-lg border border-gray-100 shrink-0">
                {getAlertIcon(log.alert_type)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="font-mono text-xs font-bold text-blue-800 bg-blue-100 px-2 py-0.5 rounded">
                    {log.truck_id}
                  </span>
                  <span className="text-xs text-gray-500 font-medium">
                    {new Date(log.timestamp).toLocaleString('pt-BR')}
                  </span>
                </div>
                <p className="text-sm font-medium text-gray-800">{log.message}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}