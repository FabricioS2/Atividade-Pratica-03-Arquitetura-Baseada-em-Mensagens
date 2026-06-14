import { TruckTelemetry } from '@/lib/mqttClient';

interface TruckCardProps {
  truck: TruckTelemetry;
}

export default function TruckCard({ truck }: TruckCardProps) {
  const isDoorOpen = truck.door === 'aberta';

  // Lógica de cores mais suave e moderna para a temperatura interna
  const getTempStyles = (temp: number) => {
    if (temp < -25) return 'bg-blue-50 text-blue-700 border-blue-200';
    if (temp > -10) return 'bg-red-50 text-red-700 border-red-200 animate-pulse';
    return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  };

  // Bordas e fundos baseados no estado crítico da porta
  const cardStyles = isDoorOpen
    ? 'bg-amber-50/60 border-amber-200 ring-2 ring-amber-500/10'
    : 'bg-white border-gray-100 shadow-sm';

  const formattedDate = new Date(truck.timestamp).toLocaleString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  return (
    <div className={`rounded-2xl border p-5 transition-all duration-300 hover:shadow-md ${cardStyles}`}>
      {/* Cabeçalho do Card */}
      <div className="flex justify-between items-center mb-4">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-gray-400">ID do Veículo</span>
          <h2 className="text-xl font-bold text-gray-800 tracking-tight">{truck.truck_id}</h2>
        </div>
        {/* Badge de Temperatura Interna */}
        <div className={`px-3 py-1.5 rounded-xl border text-sm font-mono font-bold shadow-sm ${getTempStyles(truck.temperature)}`}>
          ❄️ {truck.temperature.toFixed(1)}°C
        </div>
      </div>

      <hr className="border-gray-100 my-3" />

      {/* Seção 1: Status da Carga (Interna) */}
      <div className="mb-4">
        <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400 block mb-2">Ambiente Interno (Baú)</span>
        <div className="grid grid-cols-2 gap-3">
          {/* Status da Porta transformado em Badge */}
          <div className="bg-gray-50/50 p-2.5 rounded-xl border border-gray-100 flex flex-col justify-between">
            <span className="text-xs text-gray-500">Porta</span>
            <span className={`text-xs font-bold uppercase mt-1 inline-block px-2 py-0.5 rounded-md w-max ${
              isDoorOpen ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
            }`}>
              {truck.door}
            </span>
          </div>

          <div className="bg-gray-50/50 p-2.5 rounded-xl border border-gray-100 flex flex-col">
            <span className="text-xs text-gray-500">Umidade Baú</span>
            <span className="text-sm font-semibold text-gray-800 mt-1">💧 {truck.humidity}%</span>
          </div>
        </div>
      </div>

      {/* Seção 2: Telemetria e Exterior */}
      <div className="space-y-2 text-xs text-gray-600 bg-gray-50/30 p-3 rounded-xl border border-gray-100">
        <div className="flex justify-between">
          <span className="text-gray-500">🚚 Velocidade:</span>
          <span className={`font-semibold ${truck.speed > 80 ? 'text-red-600 font-bold' : 'text-gray-800'}`}>
            {truck.speed} km/h
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">📊 Odômetro:</span>
          <span className="font-semibold text-gray-800">{truck.total_odometer.toLocaleString()} km</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">🌡️ Ext. (Temp/Umid):</span>
          <span className="font-medium text-gray-700">
            {truck.external_temperature}°C / {truck.external_humidity}%
          </span>
        </div>
        <div className="pt-1 border-t border-gray-100 flex justify-between items-center text-[11px]">
          <span className="text-gray-400">📍 Projeção Local:</span>
          <span className="font-mono text-gray-500 bg-white px-1.5 py-0.5 rounded border border-gray-100">
            {truck.lat.toFixed(4)}, {truck.lon.toFixed(4)}
          </span>
        </div>
      </div>

      {/* Rodapé com o horário */}
      <div className="mt-3 flex items-center justify-between text-[11px] text-gray-400">
        <span className="flex items-center gap-1">
          <span className={`h-1.5 w-1.5 rounded-full bg-emerald-500 ${isDoorOpen ? 'animate-ping' : ''}`}></span>
          Atualizado às {formattedDate}
        </span>
      </div>
    </div>
  );
}