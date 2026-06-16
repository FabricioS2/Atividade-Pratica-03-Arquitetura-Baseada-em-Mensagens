import { TruckTelemetry } from '@/lib/mqttClient';

interface TruckCardProps {
  truck: TruckTelemetry;
}

export default function TruckCard({ truck }: TruckCardProps) {
  const isDoorOpen = truck.door === 'aberta';

  const getTempBadgeStyles = (temp: number) => {
    if (temp < -25) return 'bg-blue-50 text-blue-600 border-blue-100';
    if (temp > -10) return 'bg-rose-50 text-rose-600 border-rose-100 animate-pulse';
    return 'bg-emerald-50 text-emerald-600 border-emerald-100';
  };

  const formattedDate = new Date(truck.timestamp).toLocaleString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  return (
    /* max-w-[420px] impede que o card estique demais em telas largas */
<div className="w-full max-w-[380px] flex-none bg-white rounded-2xl border border-gray-100 p-4 shadow-sm hover:shadow-md transition-all duration-300 flex flex-col gap-10 rounded-sm">      
      {/* Imagem de Destaque com tamanho controlado */}
      
      <div className="relative w-full h-36 bg-gray-100 rounded-xl overflow-hidden group">
        <img 
          src="https://images.unsplash.com/photo-1601584115197-04ecc0da31d7?auto=format&fit=crop&q=80&w=600" 
          alt="Caminhão em trânsito" 
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
        />
        <div className={`absolute top-3 right-3 px-2.5 py-1 rounded-lg border text-xs font-mono font-bold shadow-sm backdrop-blur-sm ${getTempBadgeStyles(truck.temperature)}`}>
          ❄️ {truck.temperature.toFixed(1)}°C
        </div>
      </div>

      {/* Título / Detalhe do ID */}
      <div>
        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 block mb-0.5">Identificação</span>
        <h3 className="text-base font-bold text-gray-800">Veículo #{truck.truck_id}</h3>
      </div>

      {/* Lista de Informações */}
      <div className="flex flex-col gap-2 text-xs">
        <div className="flex justify-between items-center py-0.5">
          <span className="text-gray-500 font-medium">Status da Porta</span>
          <span className={`font-bold px-2 py-0.5 rounded text-[10px] uppercase tracking-wide ${
            isDoorOpen ? 'bg-amber-50 text-amber-700 border border-amber-100' : 'bg-emerald-50 text-emerald-700 border border-emerald-100'
          }`}>
            {truck.door}
          </span>
        </div>

        <div className="flex justify-between items-center border-t border-gray-50 pt-2">
          <span className="text-gray-500 font-medium">Umidade do Baú</span>
          <span className="font-semibold text-gray-800">{truck.humidity}%</span>
        </div>

        <div className="flex justify-between items-center border-t border-gray-50 pt-2">
          <span className="text-gray-500 font-medium">Velocidade Atual</span>
          <span className={`font-semibold ${truck.speed > 80 ? 'text-rose-600 font-bold' : 'text-gray-800'}`}>
            {truck.speed} km/h
          </span>
        </div>

        <div className="flex justify-between items-center border-t border-gray-50 pt-2">
          <span className="text-gray-500 font-medium">Odômetro Total</span>
          <span className="font-semibold text-gray-800">{truck.total_odometer.toLocaleString('pt-BR')} km</span>
        </div>

        <div className="flex justify-between items-center border-t border-gray-50 pt-2">
          <span className="text-gray-500 font-medium">Ambiente Externo</span>
          <span className="text-gray-600 font-medium">
            {truck.external_temperature}°C / {truck.external_humidity}% UR
          </span>
        </div>

        <div className="flex justify-between items-center border-t border-gray-50 pt-2">
          <span className="text-gray-500 font-medium">Localização (Lat, Lon)</span>
          <span className="font-mono text-blue-600 hover:underline cursor-pointer bg-blue-50/50 px-1.5 py-0.5 rounded text-[11px]">
            {truck.lat.toFixed(4)}, {truck.lon.toFixed(4)}
          </span>
        </div>
      </div>

      {/* Rodapé sutil de atualização */}
      <div className="border-t border-gray-100 pt-2 flex items-center justify-between text-[10px] text-gray-400">
        <span className="flex items-center gap-1.5">
          <span className="relative flex h-2 w-2">
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isDoorOpen ? 'bg-amber-400' : 'bg-emerald-400'}`}></span>
            <span className={`relative inline-flex rounded-full h-2 w-2 ${isDoorOpen ? 'bg-amber-500' : 'bg-emerald-500'}`}></span>
          </span>
          Tempo real
        </span>
        <span className="font-medium">{formattedDate}</span>
      </div>

    </div>
  );
}