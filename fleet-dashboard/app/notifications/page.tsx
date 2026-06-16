'use client';

import { useState, useEffect, useRef } from 'react';
import { connectToBroker, TruckTelemetry } from '@/lib/mqttClient';

// ========== LIMITES ==========
const TEMP_MIN_C = -25.0;
const TEMP_MAX_C = -10.0;
const HUMIDITY_MAX_PCT = 90.0;
const SPEED_MAX_KMH = 80.0;
const DOOR_OPEN_MAX_SEC = 120.0;

const ALERT_COOLDOWN_MS = 30000; // 30 segundos

// Tipagem local para os alertas gerados na tela
interface LiveNotification {
  id: string;
  truck_id: string;
  timestamp: string;
  alert_type: string;
  message: string;
}

export default function NotificacoesLivePage() {
  // Estado que guarda a lista de alertas gerados em tempo real
  const [notifications, setNotifications] = useState<LiveNotification[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refs para controle (idêntico ao Dashboard)
  const connectedRef = useRef(false);
  const doorOpenStartRef = useRef<Record<string, number>>({});
  const doorAlertSentRef = useRef<Record<string, boolean>>({});
  const lastAlertTimeRef = useRef<Record<string, Record<string, number>>>({});

  // Função para verificar cooldown
  const shouldSendAlert = (truckId: string, alertType: string): boolean => {
    const now = Date.now();
    const last = lastAlertTimeRef.current[truckId]?.[alertType] || 0;
    if (now - last < ALERT_COOLDOWN_MS) return false;
    
    if (!lastAlertTimeRef.current[truckId]) lastAlertTimeRef.current[truckId] = {};
    lastAlertTimeRef.current[truckId][alertType] = now;
    return true;
  };

  // Adiciona a notificação no topo da lista
  const addNotification = (truckId: string, alertType: string, message: string) => {
    const newNotif: LiveNotification = {
      id: `${Date.now()}-${Math.random()}`, // ID único para o React
      truck_id: truckId,
      timestamp: new Date().toISOString(),
      alert_type: alertType,
      message: message,
    };

    setNotifications((prev) => [newNotif, ...prev]);
  };

  // Avalia os dados que chegam do MQTT e gera os alertas
  const handleLiveAlerts = (truckId: string, data: TruckTelemetry) => {
    const temp = data.temperature;
    if (temp < TEMP_MIN_C && shouldSendAlert(truckId, 'temp_low')) {
      addNotification(truckId, 'temp_low', `Temperatura MUITO BAIXA (${temp}°C < ${TEMP_MIN_C}°C)`);
    } else if (temp > TEMP_MAX_C && shouldSendAlert(truckId, 'temp_high')) {
      addNotification(truckId, 'temp_high', `Temperatura MUITO ALTA (${temp}°C > ${TEMP_MAX_C}°C)`);
    }

    const hum = data.humidity;
    if (hum > HUMIDITY_MAX_PCT && shouldSendAlert(truckId, 'humidity')) {
      addNotification(truckId, 'humidity', `Umidade elevada (${hum}% > ${HUMIDITY_MAX_PCT}%)`);
    }

    const speed = data.speed;
    if (speed > SPEED_MAX_KMH && shouldSendAlert(truckId, 'speed')) {
      addNotification(truckId, 'speed', `Velocidade excessiva (${speed} km/h > ${SPEED_MAX_KMH} km/h)`);
    }

    const isDoorOpen = data.door === 'aberta';
    const now = Date.now();

    if (isDoorOpen) {
      if (!doorOpenStartRef.current[truckId]) {
        doorOpenStartRef.current[truckId] = now;
        doorAlertSentRef.current[truckId] = false;
      } else {
        const openDuration = (now - doorOpenStartRef.current[truckId]) / 1000;
        if (openDuration > DOOR_OPEN_MAX_SEC && !doorAlertSentRef.current[truckId]) {
          if (shouldSendAlert(truckId, 'door_open')) {
            addNotification(
              truckId, 
              'door_open', 
              `Porta aberta há ${Math.floor(openDuration)} segundos (limite: ${DOOR_OPEN_MAX_SEC}s)`
            );
            doorAlertSentRef.current[truckId] = true;
          }
        }
      }
    } else {
      if (doorOpenStartRef.current[truckId]) {
        delete doorOpenStartRef.current[truckId];
        delete doorAlertSentRef.current[truckId];
      }
    }
  };

  useEffect(() => {
    const brokerUrl = process.env.NEXT_PUBLIC_MQTT_BROKER;
    if (!brokerUrl) {
      setError('Variável NEXT_PUBLIC_MQTT_BROKER não definida');
      return;
    }

    let isMounted = true;
    let timeoutId: NodeJS.Timeout;

    const client = connectToBroker(brokerUrl, (topic, data) => {
      if (!isMounted) return;
      
      if (!connectedRef.current) {
        setConnected(true);
        connectedRef.current = true;
      }

      handleLiveAlerts(data.truck_id, data);
    });

    timeoutId = setTimeout(() => {
      if (isMounted && !connectedRef.current) {
        setError('Conexão MQTT não estabelecida. Verifique o broker.');
      }
    }, 5000);

    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
      if (client) client.end();
    };
  }, []);

  const formatDate = (isoString: string) => {
    return new Date(isoString).toLocaleTimeString('pt-BR');
  };

  const getAlertStyle = (type: string) => {
    switch (type) {
      case 'temp_high':
      case 'temp_low': return 'bg-red-50 border-red-200 text-red-800';
      case 'speed': return 'bg-orange-50 border-orange-200 text-orange-800';
      case 'door_open': return 'bg-yellow-50 border-yellow-200 text-yellow-800';
      case 'humidity': return 'bg-blue-50 border-blue-200 text-blue-800';
      default: return 'bg-gray-50 border-gray-200 text-gray-800';
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 p-6 md:p-12">
      <div className="max-w-4xl mx-auto flex flex-col h-full">
        <header className="mb-6 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-extrabold text-gray-900">
              Notificações ao Vivo
            </h1>
            <p className="text-gray-500 mt-1">
              Monitoramento de eventos da frota em tempo real.
            </p>
          </div>
          <div
            className={`px-4 py-2 rounded-full text-sm font-bold shadow-sm ${
              connected ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
            }`}
          >
            {connected ? '● Ao Vivo' : '○ Conectando...'}
          </div>
        </header>

        {error && (
          <div className="p-4 mb-6 bg-red-100 border-l-4 border-red-500 text-red-700 rounded-md">
            <p className="font-bold">Atenção</p>
            <p>{error}</p>
          </div>
        )}

        {/* COLUNA FLEX para as notificações */}
        <div className="flex flex-col gap-4">
          {notifications.length === 0 && connected && !error && (
            <div className="text-center py-16 bg-white border border-gray-200 rounded-xl shadow-sm">
              <span className="text-4xl mb-4 block">📡</span>
              <p className="text-lg text-gray-500 font-medium">Aguardando alertas da frota...</p>
              <p className="text-sm text-gray-400 mt-2">Os eventos aparecerão aqui assim que ocorrerem.</p>
            </div>
          )}

          {notifications.map((notif) => (
            <div
              key={notif.id}
              className={`p-5 rounded-xl border shadow-sm flex flex-col md:flex-row md:items-center justify-between transition-all animate-fade-in-down ${getAlertStyle(notif.alert_type)}`}
            >
              <div className="flex flex-col">
                <div className="flex items-center gap-3 mb-2">
                  <span className="font-bold text-lg px-3 py-1 bg-white bg-opacity-70 rounded-md uppercase tracking-wide">
                    {notif.truck_id}
                  </span>
                  <span className="text-xs font-bold px-2 py-1 rounded-full bg-black bg-opacity-5 uppercase">
                    {notif.alert_type.replace('_', ' ')}
                  </span>
                </div>
                <p className="text-base font-semibold opacity-90">
                  {notif.message}
                </p>
              </div>
              <div className="mt-3 md:mt-0 text-left md:text-right">
                <span className="text-sm font-bold opacity-75 bg-white bg-opacity-60 px-2 py-1 rounded">
                  {formatDate(notif.timestamp)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}