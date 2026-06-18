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

  // Estados de Controle de Interface
  const [searchQuery, setSearchQuery] = useState(''); // Estado da barra de pesquisa/filtro
  const [newTruckId, setNewTruckId] = useState('');   // Estado para simular/criar novo caminhão
  const [hiddenTrucks, setHiddenTrucks] = useState<Record<string, boolean>>({});
  const hiddenTrucksRef = useRef<Record<string, boolean>>({});

  // Controle de tempo de porta aberta e cooldown
  const doorOpenStartRef = useRef<Record<string, number>>({});
  const doorAlertSentRef = useRef<Record<string, boolean>>({});
  const lastAlertTimeRef = useRef<Record<string, Record<string, number>>>({});

  // Função auxiliar para verificar cooldown de toasts locais
  const shouldSendAlert = (truckId: string, alertType: string): boolean => {
    const now = Date.now();
    const last = lastAlertTimeRef.current[truckId]?.[alertType] || 0;
    if (now - last < ALERT_COOLDOWN_MS) return false;
    if (!lastAlertTimeRef.current[truckId]) lastAlertTimeRef.current[truckId] = {};
    lastAlertTimeRef.current[truckId][alertType] = now;
    return true;
  };

  // Processamento de alertas locais na tela
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

    // Carga inicial: traz tudo o que já chegou/está no banco de dados para a tela
    const loadInitialTelemetry = async () => {
      try {
        const res = await fetch(`${apiUrl}/telemetry?limit=100`);
        if (!res.ok) return;
        const data: TruckTelemetry[] = await res.json();
        
        const latestTrucksMap: Record<string, TruckTelemetry> = {};
        data.reverse().forEach((record) => {
          latestTrucksMap[record.truck_id] = record;
        });

        if (isMounted) {
          setTrucks(latestTrucksMap);
        }
      } catch (err) {
        console.warn('Aguardando primeiras mensagens do MQTT...', err);
      }
    };

    loadInitialTelemetry();

    // Conexão via WebSockets com o Mosquitto
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

  // FUNÇÃO: Dispara o POST para criar/simular um caminhão totalmente novo
  const handleSimulateNewTruck = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = newTruckId.trim();
    if (!id) return;

    // Reativa visualmente caso estivesse na lista de ocultados
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

      if (!response.ok) {
        throw new Error(resData.detail || 'Falha ao injetar veículo.');
      }

      toast.success(`Caminhão ${id} injetado e publicado com sucesso!`);
      setNewTruckId('');
    } catch (err: any) {
      toast.error(err.message || 'Erro ao simular novo veículo.');
    }
  };

  // FUNÇÃO: Apenas retira o cartão da visualização local do painel
  const handleRemoveFromView = (truckId: string) => {
    hiddenTrucksRef.current = { ...hiddenTrucksRef.current, [truckId]: true };
    setHiddenTrucks({ ...hiddenTrucksRef.current });
    toast.success(`Veículo ${truckId} ocultado do painel`, { duration: 3000 });
  };

  // LÓGICA DE FILTRAGEM: Filtra o estado local com base nos ocultados e na caixa de pesquisa
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
        <p className="text-sm mt-2">Certifique-se de que o Docker e o broker estão ativos.</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4">
      <Toaster position="top-right" reverseOrder={false} />
      
      {/* Cabeçalho */}
      <header className="mb-6 flex justify-between items-center bg-gray-50 p-4 rounded-xl border border-gray-100">
        <div className="flex items-center gap-4">
          <a className="p-2 rounded-lg bg-white border border-gray-200 text-gray-400 hover:text-blue-600 transition shadow-sm flex items-center justify-center" href='/notifications' title="Ver Histórico de Alertas">
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

      {/* SEÇÃO DE AÇÕES DUPLA (Pesquisa + Adição Separados) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-8">
        
        {/* 1. ABA DE PESQUISA (Filtra de forma reativa o que já chegou) */}
        <div className="lg:col-span-2 bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex items-center gap-3">
          <span className="text-gray-400 text-lg">🔍</span>
          <input
            type="text"
            placeholder="Filtrar painel por ID do caminhão... (Ex: truck_02)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full text-sm bg-transparent outline-none text-gray-700 placeholder:text-gray-400"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="text-xs text-gray-400 hover:text-gray-600 bg-gray-100 px-2 py-0.5 rounded-md">
              Limpar
            </button>
          )}
        </div>

        {/* 2. BOTÃO/FORMULÁRIO DE INJEÇÃO (Cria e adiciona um novo caminhão ao ecossistema) */}
        <form onSubmit={handleSimulateNewTruck} className="bg-white p-2 pl-4 rounded-xl border border-gray-200 shadow-sm flex items-center justify-between gap-2">
          <input
            type="text"
            placeholder="Novo veículo(id)..."
            value={newTruckId}
            onChange={(e) => setNewTruckId(e.target.value)}
            className="w-full text-sm outline-none text-gray-700 placeholder:text-gray-400 bg-transparent"
          />
          <button
            type="submit"
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-xs font-bold transition shadow-sm shrink-0 flex items-center gap-1"
          >
            <span>+</span> Adicionar 
          </button>
        </form>

      </div>
      
      {/* Listagem de Veículos */}
      {filteredActiveTrucks.length === 0 ? (
        <div className="text-center text-gray-500 py-16 bg-white rounded-xl border border-gray-100 shadow-sm">
          <p className="text-lg font-medium text-gray-600">Nenhum veículo ativo corresponde aos critérios.</p>
          <p className="text-sm text-gray-400 mt-1 max-w-xs mx-auto">
            Remova os filtros da barra de pesquisa ou utilize o formulário ao lado para injetar um caminhão novo.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 justify-items-center md:justify-items-start">
          {filteredActiveTrucks.map((truck) => (
            <div key={truck.truck_id} className="relative group w-full max-w-[380px]">
              
              {/* Botão de remoção visual sutil reposicionado */}
              <button
                onClick={() => handleRemoveFromView(truck.truck_id)}
                className="absolute top-3 left-3 wrongs-none z-20 bg-white/90 backdrop-blur-sm text-gray-400 hover:text-red-600 w-7 h-7 rounded-lg border border-gray-200 shadow-sm flex items-center justify-center transition md:opacity-0 md:group-hover:opacity-100"
                title="Retirar do painel visual"
              >
                ✕
              </button>

              <TruckCard truck={truck} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}