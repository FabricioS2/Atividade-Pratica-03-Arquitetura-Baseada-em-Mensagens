'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import toast, { Toaster } from 'react-hot-toast';
import { connectToBroker, TruckTelemetry } from '@/lib/mqttClient';
import TruckCard from './TruckCard';

// ========== LIMITES (mesmos do microserviço) ==========
const TEMP_MIN_C = -25.0;
const TEMP_MAX_C = -10.0;
const HUMIDITY_MAX_PCT = 90.0;
const SPEED_MAX_KMH = 80.0;
const DOOR_OPEN_MAX_SEC = 120.0; // segundos

const ALERT_COOLDOWN_MS = 30000; // 30 segundos
const ITEMS_PER_PAGE = 2; // Defina quantos cards quer por página

export default function Dashboard() {
  const [trucks, setTrucks] = useState<Record<string, TruckTelemetry>>({});
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connectedRef = useRef(false);

  // Estado da paginação
  const [currentPage, setCurrentPage] = useState(1);

  const doorOpenStartRef = useRef<Record<string, number>>({});
  const doorAlertSentRef = useRef<Record<string, boolean>>({});
  const lastAlertTimeRef = useRef<Record<string, Record<string, number>>>({});

  const shouldSendAlert = (truckId: string, alertType: string): boolean => {
    const now = Date.now();
    const last = lastAlertTimeRef.current[truckId]?.[alertType] || 0;
    if (now - last < ALERT_COOLDOWN_MS) return false;
    if (!lastAlertTimeRef.current[truckId]) lastAlertTimeRef.current[truckId] = {};
    lastAlertTimeRef.current[truckId][alertType] = now;
    return true;
  };

  const handleAlerts = (truckId: string, data: TruckTelemetry) => {
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

    const hum = data.humidity;
    if (hum > HUMIDITY_MAX_PCT && shouldSendAlert(truckId, 'humidity')) {
      toast.error(`${truckId}: Umidade elevada (${hum}% > ${HUMIDITY_MAX_PCT}%)`, {
        icon: '💧',
        duration: 5000,
      });
    }

    const speed = data.speed;
    if (speed > SPEED_MAX_KMH && shouldSendAlert(truckId, 'speed')) {
      toast.error(`${truckId}: Velocidade excessiva (${speed} km/h > ${SPEED_MAX_KMH} km/h)`, {
        icon: '🚛💨',
        duration: 5000,
      });
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
            toast.error(
              `${truckId}: Porta aberta há ${Math.floor(openDuration)} segundos (limite: ${DOOR_OPEN_MAX_SEC}s)`,
              { icon: '🚪⚠️', duration: 7000 }
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

      setConnected(true);
      connectedRef.current = true;

      setTrucks((prev) => ({ ...prev, [data.truck_id]: data }));
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
      if (client) client.end();
    };
  }, []);

  // ========== LÓGICA DE PAGINAÇÃO ==========
  const truckList = useMemo(() => Object.values(trucks), [trucks]);
  const totalPages = Math.ceil(truckList.length / ITEMS_PER_PAGE);

  const paginatedTrucks = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    return truckList.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [truckList, currentPage]);

  // Se os itens sumirem da página atual por algum motivo, volta para a primeira
  useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) {
      setCurrentPage(totalPages);
    }
  }, [totalPages, currentPage]);


  if (error) {
    return (
      <div className="max-w-xl mx-auto mt-12 p-6 bg-red-50 border border-red-200 rounded-xl shadow-sm text-center">
        <div className="text-red-500 text-4xl mb-3">⚠️</div>
        <h2 className="font-bold text-lg text-gray-900">Falha de Conexão com a Frota</h2>
        <p className="text-gray-600 mt-1">{error}</p>
        <p className="text-xs text-gray-400 mt-4 bg-white p-2 rounded border">
          Certifique-se de que o broker MQTT está ativo e aceitando conexões.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50/50 py-8 px-4 sm:px-6 lg:px-8">
      <Toaster position="top-right" reverseOrder={false} />
      
      <div className="max-w-7xl mx-auto">
        
        {/* 🔍 BARRA DE DIAGNÓSTICO TEMPORÁRIA */}
        <div className="mb-6 p-4 bg-blue-900 text-white rounded-xl text-xs font-mono space-y-1">
          <p>📡 Conectado: {connected ? "SIM" : "NÃO"}</p>
          <p>🚛 Total de Caminhões no Estado: {truckList.length}</p>
          <p>📄 Total de Páginas Calculadas: {totalPages}</p>
          <p>📍 Página Atual: {currentPage}</p>
          <p>📦 Caminhões na Página Atual: {paginatedTrucks.length}</p>
          <p>🔑 IDs Presentes: {truckList.map(t => t.truck_id).join(', ') || 'Nenhum'}</p>
        </div>

        {/* Header */}
        <header className="mb-8 bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight flex items-center gap-2">
              <span>🚛</span> Monitoramento de Frota Refrigerada
            </h1>
          </div>
        </header>

        {/* Grid de Conteúdo */}
        {truckList.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-2xl shadow-sm border border-gray-100 max-w-2xl mx-auto">
            <p className="text-gray-500">Aguardando dados...</p>
          </div>
        ) : (
          <>
            {/* Forçando a renderização dos itens paginados */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-6">
              {paginatedTrucks.map((truck) => (
                <div key={truck.truck_id} className="transform hover:-translate-y-1 transition-all duration-200">
                  <TruckCard truck={truck} />
                </div>
              ))}
            </div>

            {/* Removemos a trava totalPages > 1 temporariamente para ver se o HTML do botão renderiza */}
            <div className="mt-10 flex flex-col sm:flex-row items-center justify-between bg-white px-6 py-4 rounded-xl shadow-sm border border-red-400 gap-4">
              <div className="text-sm text-gray-500">
                Forçando barra: Página {currentPage} de {totalPages || 1}
              </div>
              
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    console.log("Clicou em Anterior");
                    setCurrentPage((prev) => Math.max(prev - 1, 1));
                  }}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg"
                >
                  ← Anterior
                </button>

                <button
                  onClick={() => {
                    console.log("Clicou em Próximo");
                    setCurrentPage((prev) => prev + 1);
                  }}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg"
                >
                  Próximo →
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}