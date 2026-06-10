# #!/usr/bin/env python3
# """
# Simulador de telemetria para caminhões refrigerados.
# Gera dados contínuos de sensores (temperatura, umidade, porta, localização, velocidade, odômetros)
# e condições externas, imprimindo uma linha JSON por leitura.
# """

# import json
# import random
# import time
# import math
# from datetime import datetime, timezone
# from typing import Dict, Any

# # Parâmetros globais da simulação
# NUM_TRUCKS = random.randint(3, 10)          # número aleatório entre 3 e 10
# SLEEP_INTERVAL_SEC = 1.5                    # intervalo entre ciclos de atualização
# EARTH_RADIUS_M = 6371000                    # raio da Terra em metros

# # Faixas iniciais para cada caminhão
# LAT_RANGE = (-30.0, -15.0)                  # Brasil: Sul/Sudeste
# LON_RANGE = (-55.0, -40.0)
# TOTAL_ODOMETER_RANGE = (10000.0, 200000.0)  # km
# INIT_TEMP_RANGE = (-25.0, -10.0)            # °C
# INIT_HUMIDITY_RANGE = (70.0, 95.0)          # %
# EXTERNAL_TEMP_RANGE = (15.0, 35.0)          # °C
# EXTERNAL_HUMIDITY_RANGE = (40.0, 90.0)      # %


# class Truck:
#     """Representa um caminhão com sua dinâmica interna e de movimento."""

#     def __init__(self, truck_id: str, lat: float, lon: float):
#         self.id = truck_id
#         self.lat = lat
#         self.lon = lon
#         self.heading_deg = random.uniform(0, 360)      # direção em graus
#         self.speed_kmh = 0.0                          # km/h

#         # Odômetros
#         self.total_odometer_km = random.uniform(*TOTAL_ODOMETER_RANGE)
#         self.trip_odometer_km = 0.0

#         # Condições internas
#         self.temperature_c = random.uniform(*INIT_TEMP_RANGE)
#         self.humidity_pct = random.uniform(*INIT_HUMIDITY_RANGE)
#         self.door_open = random.choice([True, False])

#         # Condições externas (variam lentamente)
#         self.ext_temp_c = random.uniform(*EXTERNAL_TEMP_RANGE)
#         self.ext_humidity_pct = random.uniform(*EXTERNAL_HUMIDITY_RANGE)

#         # Alvo da refrigeração (temperatura desejada)
#         self.target_temp_c = -18.0

#         # Último timestamp de atualização
#         self.last_update = time.time()

#         # Parâmetros de dinâmica
#         self.temp_rate_closed = 0.05      # °C/s aproximação ao alvo
#         self.temp_rate_open = 0.3         # °C/s aquecimento quando porta aberta
#         self.humidity_rate_closed = 0.1   # %/s rumo a 60%
#         self.humidity_rate_open = 0.2     # %/s rumo à umidade externa
#         self.humidity_target_closed = 60.0

#         # Pequena variação externa a cada passo
#         self.ext_temp_walk = 0.005        # °C/s
#         self.ext_humidity_walk = 0.02     # %/s

#     def _update_external_conditions(self, dt: float):
#         """Evolui temperatura e umidade externas com passeio aleatório."""
#         self.ext_temp_c += random.uniform(-self.ext_temp_walk, self.ext_temp_walk) * dt
#         self.ext_humidity_pct += random.uniform(-self.ext_humidity_walk, self.ext_humidity_walk) * dt
#         # Mantém dentro de limites realistas
#         self.ext_temp_c = max(-5.0, min(45.0, self.ext_temp_c))
#         self.ext_humidity_pct = max(20.0, min(100.0, self.ext_humidity_pct))

#     def _update_movement(self, dt: float) -> float:
#         """
#         Atualiza posição e velocidade, retorna distância percorrida (km).
#         """
#         # Mudança gradual da velocidade (aceleração/frenagem)
#         speed_change = random.uniform(-0.5, 0.5) * dt   # km/h por segundo
#         self.speed_kmh += speed_change
#         self.speed_kmh = max(0.0, min(100.0, self.speed_kmh))

#         # Pequena alteração na direção
#         heading_change = random.uniform(-10.0, 10.0) * dt
#         self.heading_deg = (self.heading_deg + heading_change) % 360

#         # Distância percorrida neste passo (km)
#         delta_t_hours = dt / 3600.0
#         distance_km = self.speed_kmh * delta_t_hours

#         if distance_km > 0:
#             # Atualiza odômetros
#             self.total_odometer_km += distance_km
#             self.trip_odometer_km += distance_km

#             # Pequena chance de resetar o odômetro de viagem (nova rota)
#             if random.random() < 0.0005 * dt:   # ~0,05% por segundo
#                 self.trip_odometer_km = 0.0

#             # Atualiza coordenadas baseado em velocidade e rumo
#             heading_rad = math.radians(self.heading_deg)
#             # Conversão: 1 grau lat ≈ 111320 m, 1 grau lon depende da latitude
#             lat_rad = math.radians(self.lat)
#             meters_per_deg_lat = 111320.0
#             meters_per_deg_lon = 111320.0 * math.cos(lat_rad)

#             delta_m = distance_km * 1000.0   # metros
#             delta_lat = (delta_m * math.cos(heading_rad)) / meters_per_deg_lat
#             delta_lon = (delta_m * math.sin(heading_rad)) / meters_per_deg_lon

#             self.lat += delta_lat
#             self.lon += delta_lon

#             # Mantém dentro de limites continentais do Brasil
#             self.lat = max(-33.0, min(5.0, self.lat))
#             self.lon = max(-74.0, min(-34.0, self.lon))

#         return distance_km

#     def _update_internal_conditions(self, dt: float):
#         """
#         Atualiza temperatura e umidade internas com base no estado da porta.
#         """
#         # Temperatura
#         if self.door_open:
#             # Porta aberta: temperatura sobe em direção à externa
#             diff = self.ext_temp_c - self.temperature_c
#             change = self.temp_rate_open * dt * (diff / 10.0)   # proporcional à diferença
#             self.temperature_c += change
#         else:
#             # Porta fechada: aproxima-se do alvo da refrigeração
#             diff = self.target_temp_c - self.temperature_c
#             self.temperature_c += self.temp_rate_closed * diff * dt

#         # Umidade
#         if self.door_open:
#             target_humidity = self.ext_humidity_pct
#             rate = self.humidity_rate_open
#         else:
#             target_humidity = self.humidity_target_closed
#             rate = self.humidity_rate_closed
#         diff_h = target_humidity - self.humidity_pct
#         self.humidity_pct += rate * diff_h * dt

#         # Limites físicos
#         self.temperature_c = max(-30.0, min(30.0, self.temperature_c))
#         self.humidity_pct = max(0.0, min(100.0, self.humidity_pct))

#     def _update_door(self, dt: float):
#         """Alterna aleatoriamente o estado da porta."""
#         # Probabilidade de mudar o estado: ~0.5% por segundo
#         if random.random() < 0.005 * dt:
#             self.door_open = not self.door_open

#     def update(self, now: float) -> Dict[str, Any]:
#         """
#         Atualiza todo o estado do caminhão desde o último chamado.
#         Retorna um dicionário com todas as variáveis de telemetria.
#         """
#         dt = now - self.last_update
#         if dt <= 0:
#             dt = 0.001   # evita divisão por zero
#         dt = min(dt, 2.0)  # segurança para passos muito grandes

#         self._update_external_conditions(dt)
#         self._update_movement(dt)
#         self._update_door(dt)
#         self._update_internal_conditions(dt)

#         self.last_update = now

#         # Monta a saída conforme os campos solicitados
#         data = {
#             "truck_id": self.id,
#             "timestamp": datetime.now(timezone.utc).isoformat(timespec='microseconds'),
#             "temperature": round(self.temperature_c, 2),
#             "humidity": round(self.humidity_pct, 1),
#             "door": "aberta" if self.door_open else "fechada",
#             "lat": round(self.lat, 6),
#             "lon": round(self.lon, 6),
#             "speed": round(self.speed_kmh, 1),
#             "total_odometer": round(self.total_odometer_km, 1),
#             "trip_odometer": round(self.trip_odometer_km, 1),
#             "external_temperature": round(self.ext_temp_c, 1),
#             "external_humidity": round(self.ext_humidity_pct, 1),
#         }
#         return data


# def create_trucks() -> list:
#     """Cria uma lista de caminhões com posições iniciais aleatórias."""
#     trucks = []
#     for i in range(1, NUM_TRUCKS + 1):
#         truck_id = f"truck_{i:02d}"
#         lat = random.uniform(*LAT_RANGE)
#         lon = random.uniform(*LON_RANGE)
#         trucks.append(Truck(truck_id, lat, lon))
#     return trucks


# def main():
#     print(f"Simulando {NUM_TRUCKS} caminhões. Pressione Ctrl+C para encerrar.", file=sys.stderr)
#     trucks = create_trucks()

#     try:
#         while True:
#             now = time.time()
#             for truck in trucks:
#                 reading = truck.update(now)
#                 # Imprime uma linha JSON por leitura
#                 print(json.dumps(reading, ensure_ascii=False))
#                 sys.stdout.flush()
#             time.sleep(SLEEP_INTERVAL_SEC)
#     except KeyboardInterrupt:
#         print("\nSimulação encerrada.", file=sys.stderr)


# if __name__ == "__main__":
#     import sys
#     main()

#!/usr/bin/env python3
"""
Simulador de telemetria para caminhões refrigerados (modo ESP32 via MQTT).
Gera dados contínuos e os publica em tópicos MQTT, exibindo detalhadamente
cada mensagem enviada.
"""

import json
import random
import time
import math
import sys
import os
from datetime import datetime, timezone
from typing import Dict, Any

import paho.mqtt.client as mqtt

# ========== CONFIGURAÇÕES MQTT ==========
MQTT_BROKER = os.environ.get("MQTT_BROKER", "localhost")
MQTT_PORT = int(os.environ.get("MQTT_PORT", 1883))
MQTT_KEEPALIVE = 60
MQTT_TOPIC_PREFIX = os.environ.get("MQTT_TOPIC_PREFIX", "fleet")

# ========== CONFIGURAÇÕES DO SIMULADOR ==========
NUM_TRUCKS = random.randint(3, 10)
SLEEP_INTERVAL_SEC = 1.5

# Parâmetros dos sensores (mesmos dos scripts anteriores)
LAT_RANGE = (-30.0, -15.0)
LON_RANGE = (-55.0, -40.0)
TOTAL_ODOMETER_RANGE = (10000.0, 200000.0)
INIT_TEMP_RANGE = (-25.0, -10.0)
INIT_HUMIDITY_RANGE = (70.0, 95.0)
EXTERNAL_TEMP_RANGE = (15.0, 35.0)
EXTERNAL_HUMIDITY_RANGE = (40.0, 90.0)


class Truck:
    """Modelo de caminhão com sensores e dinâmica realista."""
    def __init__(self, truck_id: str, lat: float, lon: float):
        self.id = truck_id
        self.lat = lat
        self.lon = lon
        self.heading_deg = random.uniform(0, 360)
        self.speed_kmh = 0.0
        self.total_odometer_km = random.uniform(*TOTAL_ODOMETER_RANGE)
        self.trip_odometer_km = 0.0
        self.temperature_c = random.uniform(*INIT_TEMP_RANGE)
        self.humidity_pct = random.uniform(*INIT_HUMIDITY_RANGE)
        self.door_open = random.choice([True, False])
        self.ext_temp_c = random.uniform(*EXTERNAL_TEMP_RANGE)
        self.ext_humidity_pct = random.uniform(*EXTERNAL_HUMIDITY_RANGE)
        self.target_temp_c = -18.0
        self.last_update = time.time()
        self.temp_rate_closed = 0.05
        self.temp_rate_open = 0.3
        self.humidity_rate_closed = 0.1
        self.humidity_rate_open = 0.2
        self.humidity_target_closed = 60.0
        self.ext_temp_walk = 0.005
        self.ext_humidity_walk = 0.02

    def _update_external_conditions(self, dt: float):
        self.ext_temp_c += random.uniform(-self.ext_temp_walk, self.ext_temp_walk) * dt
        self.ext_humidity_pct += random.uniform(-self.ext_humidity_walk, self.ext_humidity_walk) * dt
        self.ext_temp_c = max(-5.0, min(45.0, self.ext_temp_c))
        self.ext_humidity_pct = max(20.0, min(100.0, self.ext_humidity_pct))

    def _update_movement(self, dt: float) -> float:
        speed_change = random.uniform(-0.5, 0.5) * dt
        self.speed_kmh += speed_change
        self.speed_kmh = max(0.0, min(100.0, self.speed_kmh))
        heading_change = random.uniform(-10.0, 10.0) * dt
        self.heading_deg = (self.heading_deg + heading_change) % 360
        delta_t_hours = dt / 3600.0
        distance_km = self.speed_kmh * delta_t_hours
        if distance_km > 0:
            self.total_odometer_km += distance_km
            self.trip_odometer_km += distance_km
            if random.random() < 0.0005 * dt:
                self.trip_odometer_km = 0.0
            heading_rad = math.radians(self.heading_deg)
            lat_rad = math.radians(self.lat)
            meters_per_deg_lat = 111320.0
            meters_per_deg_lon = 111320.0 * math.cos(lat_rad)
            delta_m = distance_km * 1000.0
            delta_lat = (delta_m * math.cos(heading_rad)) / meters_per_deg_lat
            delta_lon = (delta_m * math.sin(heading_rad)) / meters_per_deg_lon
            self.lat += delta_lat
            self.lon += delta_lon
            self.lat = max(-33.0, min(5.0, self.lat))
            self.lon = max(-74.0, min(-34.0, self.lon))
        return distance_km

    def _update_internal_conditions(self, dt: float):
        if self.door_open:
            diff = self.ext_temp_c - self.temperature_c
            change = self.temp_rate_open * dt * (diff / 10.0)
            self.temperature_c += change
        else:
            diff = self.target_temp_c - self.temperature_c
            self.temperature_c += self.temp_rate_closed * diff * dt
        if self.door_open:
            target_humidity = self.ext_humidity_pct
            rate = self.humidity_rate_open
        else:
            target_humidity = self.humidity_target_closed
            rate = self.humidity_rate_closed
        diff_h = target_humidity - self.humidity_pct
        self.humidity_pct += rate * diff_h * dt
        self.temperature_c = max(-30.0, min(30.0, self.temperature_c))
        self.humidity_pct = max(0.0, min(100.0, self.humidity_pct))

    def _update_door(self, dt: float):
        if random.random() < 0.005 * dt:
            self.door_open = not self.door_open

    def update(self, now: float) -> Dict[str, Any]:
        dt = now - self.last_update
        if dt <= 0:
            dt = 0.001
        dt = min(dt, 2.0)
        self._update_external_conditions(dt)
        self._update_movement(dt)
        self._update_door(dt)
        self._update_internal_conditions(dt)
        self.last_update = now
        return {
            "truck_id": self.id,
            "timestamp": datetime.now(timezone.utc).isoformat(timespec='microseconds'),
            "temperature": round(self.temperature_c, 2),
            "humidity": round(self.humidity_pct, 1),
            "door": "aberta" if self.door_open else "fechada",
            "lat": round(self.lat, 6),
            "lon": round(self.lon, 6),
            "speed": round(self.speed_kmh, 1),
            "total_odometer": round(self.total_odometer_km, 1),
            "trip_odometer": round(self.trip_odometer_km, 1),
            "external_temperature": round(self.ext_temp_c, 1),
            "external_humidity": round(self.ext_humidity_pct, 1),
        }


def create_trucks() -> list:
    trucks = []
    for i in range(1, NUM_TRUCKS + 1):
        truck_id = f"truck_{i:02d}"
        lat = random.uniform(*LAT_RANGE)
        lon = random.uniform(*LON_RANGE)
        trucks.append(Truck(truck_id, lat, lon))
    return trucks


def on_connect(client, userdata, flags, rc):
    if rc == 0:
        print("[MQTT] Conectado ao broker com sucesso.", file=sys.stderr)
    else:
        print(f"[MQTT] Falha na conexão, código {rc}. Encerrando.", file=sys.stderr)
        sys.exit(1)


def print_mqtt_message(topic: str, payload: str):
    """
    Exibe de forma legível a mensagem MQTT que será enviada.
    """
    separator = "=" * 80
    print("\n" + separator, file=sys.stderr)
    print(f"📤 ENVIANDO MENSAGEM MQTT", file=sys.stderr)
    print(f"⏱️  Hora local: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}", file=sys.stderr)
    print(f"🏷️  Tópico    : {topic}", file=sys.stderr)
    print(f"📦 Payload   :", file=sys.stderr)
    # Formata o JSON com indentação para melhor visualização
    try:
        parsed = json.loads(payload)
        formatted = json.dumps(parsed, indent=2, ensure_ascii=False)
        print(formatted, file=sys.stderr)
    except:
        print(payload, file=sys.stderr)
    print(separator + "\n", file=sys.stderr)


def main():
    # Configura cliente MQTT
    client = mqtt.Client()
    client.on_connect = on_connect
    client.connect(MQTT_BROKER, MQTT_PORT, MQTT_KEEPALIVE)
    client.loop_start()

    print(f"\n🚚 SIMULADOR DE FROTA MQTT", file=sys.stderr)
    print(f"Broker    : {MQTT_BROKER}:{MQTT_PORT}", file=sys.stderr)
    print(f"Prefix    : {MQTT_TOPIC_PREFIX}", file=sys.stderr)
    print(f"Caminhões : {NUM_TRUCKS}", file=sys.stderr)
    print("Pressione Ctrl+C para encerrar.\n", file=sys.stderr)

    trucks = create_trucks()

    try:
        while True:
            now = time.time()
            for truck in trucks:
                data = truck.update(now)
                topic = f"{MQTT_TOPIC_PREFIX}/{truck.id}/telemetry"
                payload = json.dumps(data, ensure_ascii=False)
                
                # Exibe detalhadamente o que será enviado
                print_mqtt_message(topic, payload)
                
                # Publica no broker
                client.publish(topic, payload, qos=0, retain=False)
                
                # Pequena pausa entre caminhões
                time.sleep(0.05)
            
            # Aguarda o próximo ciclo geral
            time.sleep(SLEEP_INTERVAL_SEC)
    except KeyboardInterrupt:
        print("\n🛑 Encerrando simulação...", file=sys.stderr)
    finally:
        client.loop_stop()
        client.disconnect()
        print("Desconectado do broker.", file=sys.stderr)


if __name__ == "__main__":
    try:
        import paho.mqtt.client
    except ImportError:
        print("Erro: módulo 'paho-mqtt' não instalado. Execute: pip install paho-mqtt", file=sys.stderr)
        sys.exit(1)
    main()