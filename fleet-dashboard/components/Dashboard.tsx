// 'use client';

// import { useState, useEffect } from 'react';
// import { connectToBroker, TruckTelemetry } from '@/lib/mqttClient';
// import TruckCard from './TruckCard';

// export default function Dashboard() {
//   const [trucks, setTrucks] = useState<Record<string, TruckTelemetry>>({});
//   const [connected, setConnected] = useState(false);
//   const [error, setError] = useState<string | null>(null);

//   useEffect(() => {
//     const brokerUrl = process.env.NEXT_PUBLIC_MQTT_BROKER;
//     if (!brokerUrl) {
//       setError('Variável NEXT_PUBLIC_MQTT_BROKER não definida');
//       return;
//     }

//     const client = connectToBroker(brokerUrl, (topic, data) => {
//       setConnected(true);
//       setTrucks((prev) => ({
//         ...prev,
//         [data.truck_id]: data,
//       }));
//     });

//     // Timeout para detectar falha na conexão (opcional)
//     const timeout = setTimeout(() => {
//       if (!connected) setError('Conexão MQTT não estabelecida. Verifique o broker.');
//     }, 5000);

//     return () => {
//       clearTimeout(timeout);
//       if (client) client.end();
//     };
//   }, [connected]);

//   if (error) {
//     return (
//       <div className="p-4 text-red-600 bg-red-50 rounded border border-red-200">
//         <h2 className="font-bold">Erro de conexão</h2>
//         <p>{error}</p>
//         <p className="text-sm mt-2">Certifique-se de que o broker MQTT está rodando e configurado corretamente.</p>
//       </div>
//     );
//   }

//   return (
//     <div className="container mx-auto p-4">
//       <header className="mb-6 flex justify-between items-center">
//         <h1 className="text-3xl font-bold text-gray-800">
//           🚛 Frota Refrigerada - Monitoramento em Tempo Real
//         </h1>
//         <div
//           className={`px-3 py-1 rounded-full text-sm font-medium ${
//             connected ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
//           }`}
//         >
//           {connected ? '● Conectado' : '○ Conectando...'}
//         </div>
//       </header>

//       {Object.keys(trucks).length === 0 ? (
//         <div className="text-center text-gray-500 py-12 bg-white rounded-lg shadow">
//           <p className="text-lg">Aguardando dados dos caminhões...</p>
//           <p className="text-sm">Certifique-se de que o simulador MQTT está enviando mensagens.</p>
//         </div>
//       ) : (
//         <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
//           {Object.values(trucks).map((truck) => (
//             <TruckCard key={truck.truck_id} truck={truck} />
//           ))}
//         </div>
//       )}
//     </div>
//   );
// }


'use client';

import { useState, useEffect, useRef } from 'react';
import { connectToBroker, TruckTelemetry } from '@/lib/mqttClient';
import TruckCard from './TruckCard';

export default function Dashboard() {
  const [trucks, setTrucks] = useState<Record<string, TruckTelemetry>>({});
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connectedRef = useRef(false); // para evitar race conditions no timeout

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
      
      setTrucks((prev) => {
        const newTrucks = { ...prev, [data.truck_id]: data };
        console.log(`Caminhões atuais: ${Object.keys(newTrucks).length}`, Object.keys(newTrucks));
        return newTrucks;
      });
    });

    // Timeout apenas se após 5 segundos ainda não conectou
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
  }, []); // dependência vazia = executa uma única vez na montagem

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
        <div className="text-center text-gray-500 py-12 bg-white rounded-lg shadow">
          <p className="text-lg">Aguardando dados dos caminhões...</p>
          <p className="text-sm">
            Certifique-se de que o simulador MQTT está enviando mensagens.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Object.values(trucks).map((truck) => (
            <TruckCard key={truck.truck_id} truck={truck} />
          ))}
        </div>
      )}
    </div>
  );
}