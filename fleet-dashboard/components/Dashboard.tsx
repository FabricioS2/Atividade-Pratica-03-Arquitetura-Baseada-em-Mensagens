'use client';

import { useState, useEffect, useRef } from 'react';
import toast, { Toaster } from 'react-hot-toast';
import { connectToBroker, TruckTelemetry } from '@/lib/mqttClient';
import TruckCard from './TruckCard';

// ========== LIMITES ==========
const TEMP_MIN_C = -25.0;
const TEMP_MAX_C = -10.0;
const HUMIDITY_MAX_PCT = 90.0;
const SPEED_MAX_KMH = 80.0;
const DOOR_OPEN_MAX_SEC = 120.0;

const ALERT_COOLDOWN_MS = 30000; // 30 segundos

interface LiveAlert {
  id: string;
  truckId: string;
  message: string;
  icon: string;
  time: string;
}

export default function Dashboard() {
  const [trucks, setTrucks] = useState<Record<string, TruckTelemetry>>({});
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connectedRef = useRef(false);

  // Estados de Interface
  const [searchQuery, setSearchQuery] = useState('');
  const [newTruckId, setNewTruckId] = useState('');
  const [hiddenTrucks, setHiddenTrucks] = useState<Record<string, boolean>>({});
  const hiddenTrucksRef = useRef<Record<string, boolean>>({});

  // Lista de alertas locais em tempo real
  const [liveAlerts, setLiveAlerts] = useState<LiveAlert[]>([]);

  // Controle de tempos e cooldowns
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

  const addLiveAlert = (truckId: string, message: string, icon: string) => {
    const newAlert: LiveAlert = {
      id: `${Date.now()}-${Math.random()}`,
      truckId,
      message,
      icon,
      time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    };
    setLiveAlerts((prev) => [newAlert, ...prev].slice(0, 35));
  };

  const handleAlerts = (truckId: string, data: TruckTelemetry) => {
    const temp = data.temperature;
    if (temp < TEMP_MIN_C && shouldSendAlert(truckId, 'temp_low')) {
      const msg = `Temperatura MUITO BAIXA (${temp}°C < ${TEMP_MIN_C}°C)`;
      addLiveAlert(truckId, msg, '❄️');
      toast.error(`${truckId}: ${msg}`, { duration: 3000 });
    } else if (temp > TEMP_MAX_C && shouldSendAlert(truckId, 'temp_high')) {
      const msg = `Temperatura MUITO ALTA (${temp}°C > ${TEMP_MAX_C}°C)`;
      addLiveAlert(truckId, msg, '🔥');
      toast.error(`${truckId}: ${msg}`, { duration: 3000 });
    }

    const hum = data.humidity;
    if (hum > HUMIDITY_MAX_PCT && shouldSendAlert(truckId, 'humidity')) {
      const msg = `Umidade elevada (${hum}% > ${HUMIDITY_MAX_PCT}%)`;
      addLiveAlert(truckId, msg, '💧');
      toast.error(`${truckId}: ${msg}`, { duration: 3000 });
    }

    const speed = data.speed;
    if (speed > SPEED_MAX_KMH && shouldSendAlert(truckId, 'speed')) {
      const msg = `Velocidade excessiva (${speed} km/h > ${SPEED_MAX_KMH} km/h)`;
      addLiveAlert(truckId, msg, '🚛💨');
      toast.error(`${truckId}: ${msg}`, { duration: 3000 });
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
            const msg = `Porta aberta há ${Math.floor(openDuration)}s (limite: ${DOOR_OPEN_MAX_SEC}s)`;
            addLiveAlert(truckId, msg, '🚪⚠️');
            toast.error(`${truckId}: ${msg}`, { duration: 4000 });
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
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
    const brokerUrl = process.env.NEXT_PUBLIC_MQTT_BROKER;
    
    if (!brokerUrl) {
      setError('Variável NEXT_PUBLIC_MQTT_BROKER não definida');
      return;
    }

    let isMounted = true;
    let timeoutId: NodeJS.Timeout;

    const loadInitialTelemetry = async () => {
      try {
        const res = await fetch(`${apiUrl}/telemetry?limit=100`);
        if (!res.ok) return;
        const data: TruckTelemetry[] = await res.json();
        
        const latestTrucksMap: Record<string, TruckTelemetry> = {};
        data.reverse().forEach((record) => {
          latestTrucksMap[record.truck_id] = record;
        });

        if (isMounted) setTrucks(latestTrucksMap);
      } catch (err) {
        console.warn('Aguardando dados iniciais...', err);
      }
    };

    loadInitialTelemetry();

    const client = connectToBroker(brokerUrl, (topic, data) => {
      if (!isMounted) return;
      setConnected(true);
      connectedRef.current = true;
      setTrucks((prev) => ({ ...prev, [data.truck_id]: data }));

      if (!hiddenTrucksRef.current[data.truck_id]) {
        handleAlerts(data.truck_id, data);
      }
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

  const handleSimulateNewTruck = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = newTruckId.trim();
    if (!id) return;

    hiddenTrucksRef.current = { ...hiddenTrucksRef.current, [id]: false };
    setHiddenTrucks({ ...hiddenTrucksRef.current });

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
      const initialTelemetry = {
        truck_id: id,
        timestamp: new Date().toISOString(),
        temperature: -18.2,
        humidity: 65.0,
        door: 'fechada',
        lat: -23.55052,
        lon: -46.633308,
        speed: 0.0,
        total_odometer: 15000.0,
        trip_odometer: 0.0,
        external_temperature: 22.8,
        external_humidity: 55.0
      };

      const response = await fetch(`${apiUrl}/telemetry`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('fleet_token')}`
        },
        body: JSON.stringify(initialTelemetry),
      });

      const resData = await response.json();
      if (!response.ok) throw new Error(resData.detail || 'Falha ao injetar veículo.');

      toast.success(`Caminhão ${id} adicionado com sucesso!`);
      setNewTruckId('');
    } catch (err: any) {
      toast.error(err.message || 'Erro ao simular novo veículo.');
    }
  };

  const handleRemoveFromView = (truckId: string) => {
    hiddenTrucksRef.current = { ...hiddenTrucksRef.current, [truckId]: true };
    setHiddenTrucks({ ...hiddenTrucksRef.current });
    toast.success(`Veículo ${truckId} ocultado do painel`, { duration: 3000 });
  };

  const filteredActiveTrucks = Object.values(trucks).filter((truck) => {
    const isHidden = hiddenTrucks[truck.truck_id];
    const matchesSearch = truck.truck_id.toLowerCase().includes(searchQuery.toLowerCase());
    return !isHidden && matchesSearch;
  });

  if (error) {
    return (
      <div className="p-4 text-red-600 bg-red-50 rounded border border-red-200">
        <h2 className="font-bold">Erro de conexão</h2>
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 max-w-[1600px]">
      <Toaster position="top-right" reverseOrder={false} />
      
      {/* Cabeçalho */}
      <header className="mb-6 flex justify-between items-center bg-gray-50 p-4 rounded-xl border border-gray-100">
        <div className="flex items-center gap-4">
          <a className="p-2 rounded-lg bg-white border border-gray-200 text-gray-400 hover:text-blue-600 transition shadow-sm flex items-center justify-center" href='/notifications' title="Ver Banco de Notificações Completo">
            <svg xmlns="http://www.w3.org/2000/svg" height="22px" viewBox="0 -960 960 960" width="22px" fill="currentColor"><path d="M160-200v-80h80v-280q0-83 50-147.5T420-792v-28q0-25 17.5-42.5T480-880q25 0 42.5 17.5T540-820v28q80 20 130 84.5T720-560v280h80v80H160Zm320-300Zm0 420q-33 0-56.5-23.5T400-160h160q0 33-23.5 56.5T480-80ZM320-280h320v-280q0-66-47-113t-113-47q-66 0-113 47t-47 113v280Z"/></svg>
          </a>
          <h1 className="text-2xl font-bold text-gray-800 leading-tight">
            Frota Refrigerada <span className="text-sm font-normal text-gray-400 block md:inline md:ml-2">Monitoramento Operacional</span>
          </h1>
        </div>
        <div className={`px-3 py-1.5 rounded-full text-xs font-bold border ${connected ? 'bg-green-50 text-green-700 border-green-200' : 'bg-yellow-50 text-yellow-700 border-yellow-200'}`}>
          {connected ? '● Conectado' : '○ Conectando...'}
        </div>
      </header>

      {/* Barra de Ações */}
      <div className="flex flex-col md:flex-row gap-4 mb-8">
        <div className="flex-1 bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex items-center gap-3">
          <span className="text-gray-400 text-lg">🔍</span>
          <input
            type="text"
            placeholder="Filtrar painel por ID do caminhão..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full text-sm bg-transparent outline-none text-gray-700 placeholder:text-gray-400"
          />
        </div>

        <form onSubmit={handleSimulateNewTruck} className="bg-white p-2 pl-4 rounded-xl border border-gray-200 shadow-sm flex items-center justify-between gap-2 md:w-[350px]">
          <input
            type="text"
            placeholder="Novo ID para adicionar"
            value={newTruckId}
            onChange={(e) => setNewTruckId(e.target.value)}
            className="w-full text-sm outline-none text-gray-700 bg-transparent pl-1"
          />
          <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-xs font-bold transition whitespace-nowrap">
            + Adicionar
          </button>
        </form>
      </div>
      
      {/* ========== CONTEÚDO PRINCIPAL (LADO A LADO SEGURO NO DESKTOP) ========== */}
      <div className="flex flex-col md:flex-row gap-6 items-start w-full">
        
        {/* COLUNA DA ESQUERDA: Cards dos Caminhões (Ocupa o espaço dinâmico livre) */}
        <div className="flex-1 w-full">
          {filteredActiveTrucks.length === 0 ? (
            <div className="text-center text-gray-500 py-16 bg-white rounded-xl border border-gray-100 shadow-sm w-full">
              <p className="text-lg font-medium text-gray-600">Nenhum veículo ativo encontrado.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3 gap-6 justify-items-center sm:justify-items-start">
              {filteredActiveTrucks.map((truck) => (
                <div key={truck.truck_id} className="relative group w-full max-w-[380px]">
                  <button
                    onClick={() => handleRemoveFromView(truck.truck_id)}
                    className="absolute top-3 left-3 z-20 bg-white/90 backdrop-blur-sm text-gray-400 hover:text-red-600 w-7 h-7 rounded-lg border border-gray-200 shadow-sm flex items-center justify-center transition md:opacity-0 md:group-hover:opacity-100"
                  >
                    ✕
                  </button>
                  <TruckCard truck={truck} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* COLUNA DA DIREITA: Barra Lateral Fixa de Alertas (Largura travada em 350px no desktop) */}
        <section className="w-full md:w-[350px] shrink-0 bg-white border border-gray-200 rounded-xl p-4 shadow-sm flex flex-col gap-3 md:sticky md:top-4 max-h-[80vh]">
          <div className="flex justify-between items-center border-b border-gray-100 pb-2">
            <h2 className="text-sm font-bold text-gray-800 flex items-center gap-1.5">
              <span>🚨</span> Ocorrências ao Vivo
            </h2>
            {liveAlerts.length > 0 && (
              <button onClick={() => setLiveAlerts([])} className="text-[10px] text-gray-400 hover:text-red-500 font-semibold uppercase">
                Limpar
              </button>
            )}
          </div>

          <div className="flex flex-col gap-2 overflow-y-auto pr-1 text-xs">
            {liveAlerts.length === 0 ? (
              <div className="text-center py-12 text-gray-400 border border-dashed border-gray-100 rounded-lg bg-gray-50/50">
                <p className="font-medium text-[12px]">Nenhum evento crítico</p>
                <p className="text-[10px] text-gray-300 mt-0.5">Sensores operando nas faixas ideais.</p>
              </div>
            ) : (
              liveAlerts.map((alert) => (
                <div key={alert.id} className="p-3 bg-red-50/50 border border-red-100/60 rounded-xl flex items-start gap-2">
                  <div className="text-base shrink-0 mt-0.5">{alert.icon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-center gap-2 mb-1">
                      <span className="font-mono font-bold text-blue-700 bg-blue-50 border border-blue-100 px-1.5 py-0.5 rounded text-[10px]">
                        {alert.truckId}
                      </span>
                      <span className="text-[9px] text-gray-400 font-medium">{alert.time}</span>
                    </div>
                    <p className="text-gray-600 font-medium text-[11px] leading-relaxed break-words">
                      {alert.message}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

      </div>
    </div>
  );
}