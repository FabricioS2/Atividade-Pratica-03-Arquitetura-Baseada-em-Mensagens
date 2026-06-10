import { TruckTelemetry } from '@/lib/mqttClient';

interface TruckCardProps {
  truck: TruckTelemetry;
}

export default function TruckCard({ truck }: TruckCardProps) {
  const isDoorOpen = truck.door === 'aberta';
  const tempColor =
    truck.temperature < -15
      ? 'text-blue-600'
      : truck.temperature > -10
      ? 'text-red-600'
      : 'text-gray-800';

  const cardBg = isDoorOpen
    ? 'bg-yellow-50 border-l-4 border-yellow-500'
    : 'bg-white border-l-4 border-green-500';

  const formattedDate = new Date(truck.timestamp).toLocaleString('pt-BR');

  return (
    <div className={`rounded-lg shadow-md p-4 ${cardBg} transition-all hover:shadow-lg`}>
      <div className="flex justify-between items-start mb-2">
        <h2 className="text-xl font-bold text-gray-800">{truck.truck_id}</h2>
        <span className={`text-2xl font-mono ${tempColor}`}>
          {truck.temperature}°C
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="flex items-center gap-1">
          <span className="font-semibold">🚪 Porta:</span>
          <span className={isDoorOpen ? 'text-yellow-700' : 'text-green-700'}>
            {truck.door}
          </span>
        </div>
        <div>
          <span className="font-semibold">💧 Umidade:</span> {truck.humidity}%
        </div>
        <div>
          <span className="font-semibold">📏 Velocidade:</span> {truck.speed} km/h
        </div>
        <div>
          <span className="font-semibold">📊 Odômetro total:</span> {truck.total_odometer.toLocaleString()} km
        </div>
        <div className="col-span-2">
          <span className="font-semibold">📍 Local:</span> {truck.lat.toFixed(4)}, {truck.lon.toFixed(4)}
        </div>
        <div>
          <span className="font-semibold">🌡️ Temp ext:</span> {truck.external_temperature}°C
        </div>
        <div>
          <span className="font-semibold">💧 Umidade ext:</span> {truck.external_humidity}%
        </div>
        <div className="col-span-2 text-xs text-gray-400 mt-2">
          Última atualização: {formattedDate}
        </div>
      </div>
    </div>
  );
}