

'use client';

import { useState, useEffect, useRef } from 'react';
import toast, { Toaster } from 'react-hot-toast';
import { connectToBroker, TruckTelemetry } from '@/lib/mqttClient';
import TruckCard from './TruckCard';

// ========== LIMITES (mesmos do microserviço) ==========
const TEMP_MIN_C = -25.0;
const TEMP_MAX_C = -10.0;
const HUMIDITY_MAX_PCT = 90.0;
const SPEED_MAX_KMH = 80.0;
const DOOR_OPEN_MAX_SEC = 120.0; // segundos

// Controle de cooldown para evitar spam de alertas (ms)
const ALERT_COOLDOWN_MS = 30000; // 30 segundos

export default function Dashboard() {
  const [trucks, setTrucks] = useState<Record<string, TruckTelemetry>>({});
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connectedRef = useRef(false);

  // Controle de tempo de porta aberta e cooldown
  const doorOpenStartRef = useRef<Record<string, number>>({});
  const doorAlertSentRef = useRef<Record<string, boolean>>({});
  const lastAlertTimeRef = useRef<Record<string, Record<string, number>>>({});

  // Função auxiliar para verificar cooldown
  const shouldSendAlert = (truckId: string, alertType: string): boolean => {
    const now = Date.now();
    const last = lastAlertTimeRef.current[truckId]?.[alertType] || 0;
    if (now - last < ALERT_COOLDOWN_MS) return false;
    if (!lastAlertTimeRef.current[truckId]) lastAlertTimeRef.current[truckId] = {};
    lastAlertTimeRef.current[truckId][alertType] = now;
    return true;
  };

  // Processamento de alertas
  const handleAlerts = (truckId: string, data: TruckTelemetry) => {
    // 1. Temperatura
    const temp = data.temperature;
    if (temp < TEMP_MIN_C && shouldSendAlert(truckId, 'temp_low')) {
      toast.error(`${truckId}: Temperatura MUITO BAIXA (${temp}°C < ${TEMP_MIN_C}°C)`, {
        icon: '❄️',
        duration: 5000,
      });
    } else if (temp > TEMP_MAX_C && shouldSendAlert(truckId, 'temp_high')) {
      toast.error(`${truckId}: Temperatura MUITO ALTA (${temp}°C > ${TEMP_MAX_C}°C)`, {
        icon: '🔥',
        duration: 5000,
      });
    }

    // 2. Umidade
    const hum = data.humidity;
    if (hum > HUMIDITY_MAX_PCT && shouldSendAlert(truckId, 'humidity')) {
      toast.error(`${truckId}: Umidade elevada (${hum}% > ${HUMIDITY_MAX_PCT}%)`, {
        icon: '💧',
        duration: 5000,
      });
    }

    // 3. Velocidade
    const speed = data.speed;
    if (speed > SPEED_MAX_KMH && shouldSendAlert(truckId, 'speed')) {
      toast.error(`${truckId}: Velocidade excessiva (${speed} km/h > ${SPEED_MAX_KMH} km/h)`, {
        icon: '🚛💨',
        duration: 5000,
      });
    }

    // 4. Porta aberta por tempo prolongado
    const isDoorOpen = data.door === 'aberta';
    const now = Date.now();

    if (isDoorOpen) {
      // Se ainda não registramos o início da abertura, faz agora
      if (!doorOpenStartRef.current[truckId]) {
        doorOpenStartRef.current[truckId] = now;
        doorAlertSentRef.current[truckId] = false;
      } else {
        const openDuration = (now - doorOpenStartRef.current[truckId]) / 1000;
        if (openDuration > DOOR_OPEN_MAX_SEC && !doorAlertSentRef.current[truckId]) {
          if (shouldSendAlert(truckId, 'door_open')) {
            toast.error(
              `${truckId}: Porta aberta há ${Math.floor(openDuration)} segundos (limite: ${DOOR_OPEN_MAX_SEC}s)`,
              { icon: '🚪⚠️', duration: 7000 }
            );
            doorAlertSentRef.current[truckId] = true;
          }
        }
      }
    } else {
      // Porta fechada: resetar controles
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

      console.log(`📨 Mensagem recebida - Tópico: ${topic}`, data);
      setConnected(true);
      connectedRef.current = true;

      // Atualiza estado dos caminhões
      setTrucks((prev) => {
        const newTrucks = { ...prev, [data.truck_id]: data };
        console.log(`Caminhões atuais: ${Object.keys(newTrucks).length}`);
        return newTrucks;
      });

      // Dispara alertas com os dados recebidos
      handleAlerts(data.truck_id, data);
    });

    timeoutId = setTimeout(() => {
      if (isMounted && !connectedRef.current) {
        setError('Conexão MQTT não estabelecida. Verifique o broker.');
      }
    }, 5000);

    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
      if (client) {
        client.end();
        console.log('Cliente MQTT finalizado');
      }
    };
  }, []);

  if (error) {
    return (
      <div className="p-4 text-red-600 bg-red-50 rounded border border-red-200">
        <h2 className="font-bold">Erro de conexão</h2>
        <p>{error}</p>
        <p className="text-sm mt-2">
          Certifique-se de que o broker MQTT está rodando e configurado corretamente.
        </p>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4">
      <Toaster position="top-right" reverseOrder={false} />
      <header className="mb-6 flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-800">
          🚛 Frota Refrigerada - Monitoramento em Tempo Real
        </h1>
        <div
          className={`px-3 py-1 rounded-full text-sm font-medium ${
            connected ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
          }`}
        >
          {connected ? '● Conectado' : '○ Conectando...'}
        </div>
      </header>
      
      {Object.keys(trucks).length === 0 ? (
        <div className="text-center text-gray-500 py-12 bg-white rounded-xl border border-gray-100 shadow-sm">
          <p className="text-lg font-medium">Aguardando dados dos caminhões...</p>
          <p className="text-sm text-gray-400 mt-1">
            Certifique-se de que o simulador MQTT está enviando mensagens.
          </p>
        </div>
      ) : (
        /* AJUSTE AQUI: 
          - Mudamos para grid-cols-1, md:grid-cols-2, xl:grid-cols-3
          - Adicionamos justify-items-center para casar com o max-w-[420px] do TruckCard
          - Em telas bem grandes (xl), alinhamos à esquerda se preferir (md:justify-items-start)
        */
        <div className="flex flex-wrap ">
          {Object.values(trucks).map((truck) => (
            <TruckCard key={truck.truck_id} truck={truck} />
          ))}
        </div>
      )}
    </div>
  );
}