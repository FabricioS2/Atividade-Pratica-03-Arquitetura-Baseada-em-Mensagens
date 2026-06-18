'use client';

import { useState, useEffect, useRef } from 'react';
import toast, { Toaster } from 'react-hot-toast';
import { connectToBroker, TruckTelemetry } from '@/lib/mqttClient';
import TruckCard from './TruckCard';

const TEMP_MIN_C = -25.0;
const TEMP_MAX_C = -10.0;
const HUMIDITY_MAX_PCT = 90.0;
const SPEED_MAX_KMH = 80.0;
const DOOR_OPEN_MAX_SEC = 120.0;

const ALERT_COOLDOWN_MS = 30000;

export default function Dashboard() {
  const [trucks, setTrucks] = useState<Record<string, TruckTelemetry>>({});
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connectedRef = useRef(false);

  const hiddenTrucksRef = useRef<Record<string, boolean>>({});
  const [hiddenTrucks, setHiddenTrucks] = useState<Record<string, boolean>>({});
  const [inputTruckId, setInputTruckId] = useState('');

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
      toast.error(`${truckId}: Temperatura MUITO BAIXA (${temp}°C < ${TEMP_MIN_C}°C)`, { icon: '❄️', duration: 5000 });
    } else if (temp > TEMP_MAX_C && shouldSendAlert(truckId, 'temp_high')) {
      toast.error(`${truckId}: Temperatura MUITO ALTA (${temp}°C > ${TEMP_MAX_C}°C)`, { icon: '🔥', duration: 5000 });
    }

    const hum = data.humidity;
    if (hum > HUMIDITY_MAX_PCT && shouldSendAlert(truckId, 'humidity')) {
      toast.error(`${truckId}: Umidade elevada (${hum}% > ${HUMIDITY_MAX_PCT}%)`, { icon: '💧', duration: 5000 });
    }

    const speed = data.speed;
    if (speed > SPEED_MAX_KMH && shouldSendAlert(truckId, 'speed')) {
      toast.error(`${truckId}: Velocidade excessiva (${speed} km/h > ${SPEED_MAX_KMH} km/h)`, { icon: '🚛💨', duration: 5000 });
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
            toast.error(`${truckId}: Porta aberta há ${Math.floor(openDuration)} segundos`, { icon: '🚪⚠️', duration: 7000 });
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

    // 1. CARGA INICIAL: Busca dados históricos/recentes da API para não abrir a tela vazia
    const loadInitialTelemetry = async () => {
      try {
        const res = await fetch(`${apiUrl}/telemetry?limit=50`);
        if (!res.ok) return;
        const data: TruckTelemetry[] = await res.json();
        
        // Agrupa pelo ID do caminhão pegando apenas o registro mais recente de cada um
        const latestTrucksMap: Record<string, TruckTelemetry> = {};
        data.reverse().forEach((record) => {
          latestTrucksMap[record.truck_id] = record;
        });

        if (isMounted) {
          setTrucks(latestTrucksMap);
        }
      } catch (err) {
        console.warn('Não foi possível carregar a telemetria inicial da API. Aguardando MQTT...', err);
      }
    };

    loadInitialTelemetry();

    // 2. CONEXÃO EM TEMPO REAL: Conecta ao broker MQTT
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
      if (client) {
        client.end();
      }
    };
  }, []);

  const handleAddTruck = (e: React.FormEvent) => {
    e.preventDefault();
    const id = inputTruckId.trim();
    if (!id) return;

    hiddenTrucksRef.current = { ...hiddenTrucksRef.current, [id]: false };
    setHiddenTrucks({ ...hiddenTrucksRef.current });
    setInputTruckId('');
    toast.success(`Veículo ${id} adicionado ao painel`, { duration: 3000 });
  };

  const handleRemoveTruck = (truckId: string) => {
    hiddenTrucksRef.current = { ...hiddenTrucksRef.current, [truckId]: true };
    setHiddenTrucks({ ...hiddenTrucksRef.current });
    toast.success(`Veículo ${truckId} removido da visualização`, { duration: 3000 });
  };

  if (error) {
    return (
      <div className="p-4 text-red-600 bg-red-50 rounded border border-red-200">
        <h2 className="font-bold">Erro de conexão</h2>
        <p>{error}</p>
        <p className="text-sm mt-2">Certifique-se de que o broker MQTT e a API estão rodando corretamente.</p>
      </div>
    );
  }

  const activeTrucks = Object.values(trucks).filter((truck) => !hiddenTrucks[truck.truck_id]);

  return (
    <div className="container mx-auto p-4">
      <Toaster position="top-right" reverseOrder={false} />
      
      <header className="mb-6 flex justify-between items-center bg-gray-50 p-4 rounded-xl border border-gray-100">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">Frota Refrigerada</h1>
          <p className="text-sm text-gray-500 mt-1">Monitoramento em Tempo Real</p>
        </div>
        
        <div className="flex items-center gap-4">
          <a 
            className="p-2.5 rounded-xl bg-white border border-gray-200 text-gray-600 hover:text-blue-600 hover:bg-gray-50 transition shadow-sm flex items-center justify-center" 
            href="/notifications"
            title="Ver Histórico de Alertas"
          >
            <svg xmlns="http://www.w3.org/2000/svg" height="22px" viewBox="0 -960 960 960" width="22px" fill="currentColor">
              <path d="M160-200v-80h80v-280q0-83 50-147.5T420-792v-28q0-25 17.5-42.5T480-880q25 0 42.5 17.5T540-820v28q80 20 130 84.5T720-560v280h80v80H160Zm320-300Zm0 420q-33 0-56.5-23.5T400-160h160q0 33-23.5 56.5T480-80ZM320-280h320v-280q0-66-47-113t-113-47q-66 0-113 47t-47 113v280Z"/>
            </svg>
          </a>
          <div
            className={`px-3 py-1.5 rounded-full text-sm font-semibold shadow-sm ${
              connected ? 'bg-green-100 text-green-800 border border-green-200' : 'bg-yellow-100 text-yellow-800 border border-yellow-200'
            }`}
          >
            {connected ? '● Conectado' : '○ Conectando ao Broker...'}
          </div>
        </div>
      </header>

      <section className="mb-8 bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <form onSubmit={handleAddTruck} className="flex flex-1 max-w-md items-center gap-2">
          <input
            type="text"
            placeholder="ID do Caminhão (Ex: truck_01)"
            value={inputTruckId}
            onChange={(e) => setInputTruckId(e.target.value)}
            className="w-full px-4 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-blue-500 transition shadow-inner bg-gray-50/50"
          />
          <button
            type="submit"
            className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-xl text-sm font-medium transition shadow-sm shrink-0"
          >
            Monitorar Veículo
          </button>
        </form>

        <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Ativos no Painel: <span className="text-gray-700 font-bold font-mono">{activeTrucks.length}</span>
        </div>
      </section>

      {activeTrucks.length === 0 ? (
        <div className="text-center text-gray-500 py-16 bg-white rounded-2xl border border-gray-100 shadow-sm">
          <p className="text-lg font-medium text-gray-600">Nenhum veículo ativo na tela.</p>
          <p className="text-sm text-gray-400 mt-1 max-w-sm mx-auto">
            Digite o ID de um caminhão acima para adicioná-lo ou certifique-se de que o simulador está rodando.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 justify-items-center md:justify-items-start">
          {activeTrucks.map((truck) => (
            <div key={truck.truck_id} className="relative w-full max-w-[380px] group">
              <button
                onClick={() => handleRemoveTruck(truck.truck_id)}
                className="absolute top-3 left-3 z-20 bg-white/95 backdrop-blur-sm text-gray-400 hover:text-red-600 w-7 h-7 rounded-lg flex items-center justify-center border border-gray-200 shadow-sm transition opacity-0 group-hover:opacity-100"
                title="Remover do painel"
              >
                <svg xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 -960 960 960" width="18px" fill="currentColor">
                  <path d="M280-120q-33 0-56.5-23.5T200-200v-520h-40v-80h200v-40h240v40h200v80h-40v520q0 33-23.5 56.5T680-120H280Zm400-600H280v520h400v-520ZM360-280h80v-360h80v360h-80Z"/>
                </svg>
              </button>
              <TruckCard truck={truck} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}