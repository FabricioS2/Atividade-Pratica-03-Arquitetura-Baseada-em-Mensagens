#!/usr/bin/env python3
"""
Microserviço de monitoramento de frota refrigerada com FastAPI.
Recebe telemetria via HTTP POST, valida e gera alertas.
"""

import os
import time
from datetime import datetime, timezone
from typing import Dict, List, Optional

from fastapi import FastAPI, HTTPException, status
from pydantic import BaseModel, Field, validator
import requests
import uvicorn

# ========== CONFIGURAÇÕES ==========
TEMP_MIN_C = float(os.environ.get("TEMP_MIN_C", "-25.0"))
TEMP_MAX_C = float(os.environ.get("TEMP_MAX_C", "-10.0"))
HUMIDITY_MAX_PCT = float(os.environ.get("HUMIDITY_MAX_PCT", "90.0"))
SPEED_MAX_KMH = float(os.environ.get("SPEED_MAX_KMH", "80.0"))
DOOR_OPEN_MAX_SEC = float(os.environ.get("DOOR_OPEN_MAX_SEC", "120.0"))

ALERT_WEBHOOK_URL = os.environ.get("ALERT_WEBHOOK_URL", "")
ENABLE_CONSOLE_ALERTS = os.environ.get("ENABLE_CONSOLE_ALERTS", "true").lower() == "true"

# Armazenamento simples de alertas (últimos 100)
alert_history: List[Dict] = []

# Controle de porta aberta por caminhão (evita spam)
door_open_start: Dict[str, float] = {}
door_alert_sent: Dict[str, bool] = {}

# ========== MODELOS PYDANTIC ==========
class TelemetryData(BaseModel):
    truck_id: str
    timestamp: str  # ISO format
    temperature: float = Field(..., ge=-30, le=30)
    humidity: float = Field(..., ge=0, le=100)
    door: str  # "aberta" ou "fechada"
    lat: float = Field(..., ge=-90, le=90)
    lon: float = Field(..., ge=-180, le=180)
    speed: float = Field(..., ge=0)
    total_odometer: float = Field(..., ge=0)
    trip_odometer: float = Field(..., ge=0)
    external_temperature: float
    external_humidity: float = Field(..., ge=0, le=100)

    @validator('door')
    def validate_door(cls, v):
        if v not in ('aberta', 'fechada'):
            raise ValueError('door deve ser "aberta" ou "fechada"')
        return v

# ========== FUNÇÕES DE ALERTA ==========
def send_alert(message: str, data: dict):
    """Envia notificação e armazena no histórico."""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    full_message = f"[ALERTA {timestamp}] {message} | Dados: {data}"

    # Armazena histórico
    alert_history.insert(0, {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "message": message,
        "data": data
    })
    # Mantém apenas os últimos 100
    if len(alert_history) > 100:
        alert_history.pop()

    if ENABLE_CONSOLE_ALERTS:
        print("\n" + "=" * 80)
        print(f"🚨 {full_message}")
        print("=" * 80 + "\n")

    if ALERT_WEBHOOK_URL:
        try:
            payload = {
                "text": full_message,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "data": data
            }
            requests.post(ALERT_WEBHOOK_URL, json=payload, timeout=2)
        except Exception as e:
            print(f"Erro ao enviar webhook: {e}")

def check_alerts(truck_id: str, data: dict):
    """Avalia os dados e gera alertas conforme os limites."""
    temp = data.get("temperature")
    if temp is not None:
        if temp < TEMP_MIN_C:
            send_alert(
                f"Caminhão {truck_id}: temperatura MUITO BAIXA ({temp}°C < {TEMP_MIN_C}°C)",
                data
            )
        elif temp > TEMP_MAX_C:
            send_alert(
                f"Caminhão {truck_id}: temperatura MUITO ALTA ({temp}°C > {TEMP_MAX_C}°C)",
                data
            )

    humidity = data.get("humidity")
    if humidity is not None and humidity > HUMIDITY_MAX_PCT:
        send_alert(
            f"Caminhão {truck_id}: umidade elevada ({humidity}% > {HUMIDITY_MAX_PCT}%)",
            data
        )

    speed = data.get("speed")
    if speed is not None and speed > SPEED_MAX_KMH:
        send_alert(
            f"Caminhão {truck_id}: velocidade excessiva ({speed} km/h > {SPEED_MAX_KMH} km/h)",
            data
        )

    door_status = data.get("door")
    now = time.time()
    if door_status == "aberta":
        if truck_id not in door_open_start:
            door_open_start[truck_id] = now
            door_alert_sent[truck_id] = False
        else:
            open_duration = now - door_open_start[truck_id]
            if open_duration > DOOR_OPEN_MAX_SEC and not door_alert_sent[truck_id]:
                send_alert(
                    f"Caminhão {truck_id}: porta aberta por {open_duration:.0f} segundos "
                    f"(limite: {DOOR_OPEN_MAX_SEC}s)",
                    data
                )
                door_alert_sent[truck_id] = True
    else:  # "fechada"
        if truck_id in door_open_start:
            del door_open_start[truck_id]
            door_alert_sent.pop(truck_id, None)

# ========== APP FASTAPI ==========
app = FastAPI(
    title="Monitor de Frota Refrigerada",
    description="Recebe telemetria de caminhões e gera alertas em tempo real.",
    version="1.0.0"
)

@app.post("/telemetry/{truck_id}", status_code=status.HTTP_202_ACCEPTED)
async def receive_telemetry(truck_id: str, data: TelemetryData):
    """
    Endpoint para envio de telemetria de um caminhão.
    O truck_id na URL deve coincidir com o campo truck_id do JSON.
    """
    if data.truck_id != truck_id:
        raise HTTPException(
            status_code=400,
            detail=f"truck_id na URL ({truck_id}) difere do campo no payload ({data.truck_id})"
        )
    
    # Converte para dicionário para compatibilidade com check_alerts
    payload_dict = data.dict()
    check_alerts(truck_id, payload_dict)
    
    return {"status": "aceito", "truck_id": truck_id, "message": "Telemetria recebida"}

@app.get("/alerts", response_model=List[Dict])
async def get_alerts(limit: int = 20):
    """Retorna os últimos alertas gerados."""
    return alert_history[:limit]

@app.get("/health")
async def health():
    return {"status": "ok"}

# ========== PONTO DE ENTRADA ==========
if __name__ == "__main__":
    port = int(os.environ.get("NOTIFICATIONS_PORT", 8001))
    uvicorn.run(app, host="0.0.0.0", port=port)