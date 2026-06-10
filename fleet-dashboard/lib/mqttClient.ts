import mqtt, { MqttClient } from 'mqtt';

let client: MqttClient | null = null;

export type TruckTelemetry = {
  truck_id: string;
  timestamp: string;
  temperature: number;
  humidity: number;
  door: 'aberta' | 'fechada';
  lat: number;
  lon: number;
  speed: number;
  total_odometer: number;
  trip_odometer: number;
  external_temperature: number;
  external_humidity: number;
};

type MessageHandler = (topic: string, data: TruckTelemetry) => void;

export function connectToBroker(
  brokerUrl: string,
  onMessage: MessageHandler
): MqttClient {
  if (client && client.connected) return client;

  client = mqtt.connect(brokerUrl);

  client.on('connect', () => {
    console.log('[MQTT] Conectado ao broker:', brokerUrl);
    client?.subscribe('fleet/+/telemetry', (err) => {
      if (err) console.error('[MQTT] Erro ao subscrever:', err);
      else console.log('[MQTT] Inscrito em fleet/+/telemetry');
    });
  });

  client.on('message', (topic, payload) => {
    try {
      const data = JSON.parse(payload.toString()) as TruckTelemetry;
      onMessage(topic, data);
    } catch (err) {
      console.error('[MQTT] Erro ao parsear mensagem:', err);
    }
  });

  client.on('error', (err) => {
    console.error('[MQTT] Erro de conexão:', err);
  });

  client.on('close', () => {
    console.warn('[MQTT] Conexão fechada');
  });

  return client;
}