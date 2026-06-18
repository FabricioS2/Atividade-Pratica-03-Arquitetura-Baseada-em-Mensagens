'use client';

import { useState, useEffect } from 'react';

interface NotificationOut {
  id: number;
  truck_id: string;
  timestamp: string;
  alert_type: string;
  message: string;
}

export default function NotificationCenter() {
  const [notifications, setNotifications] = useState<NotificationOut[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchNotifications = async () => {
      try {
        // Substitua pela URL da sua API
        const res = await fetch('http://localhost:8000/notifications?limit=20');
        const data = await res.json();
        setNotifications(data);
      } catch (error) {
        console.error("Erro ao buscar notificações:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchNotifications();
    
    // Polling simples para manter atualizado a cada 10 segundos
    const interval = setInterval(fetchNotifications, 10000);
    return () => clearInterval(interval);
  }, []);

  if (loading) return <div className="p-4 text-gray-500">Carregando alertas...</div>;

  return (
    <div className="w-full max-w-2xl bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
      <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
        <span className="text-red-500">🚨</span> Histórico de Alertas
      </h2>
      
      <div className="flex flex-col gap-3 max-h-[400px] overflow-y-auto pr-2">
        {notifications.length === 0 ? (
          <p className="text-sm text-gray-400">Nenhuma notificação registrada.</p>
        ) : (
          notifications.map((notif) => (
            <div key={notif.id} className="p-3 bg-gray-50 border border-gray-100 rounded-xl flex flex-col gap-1">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold uppercase tracking-wider text-gray-500">
                  {notif.truck_id}
                </span>
                <span className="text-[10px] text-gray-400">
                  {new Date(notif.timestamp).toLocaleString('pt-BR')}
                </span>
              </div>
              <p className="text-sm font-medium text-gray-800">{notif.message}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}