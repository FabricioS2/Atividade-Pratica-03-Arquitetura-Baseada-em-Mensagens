#!/usr/bin/env python3
"""
Microserviço FastAPI para capturar e armazenar telemetria de caminhões refrigerados.
- Subscreve tópicos MQTT (fleet/+/telemetry)
- Armazena dados em banco de dados SQLite (ou PostgreSQL)
- Disponibiliza API REST para consulta e health check
"""

import json
import os
import logging
import asyncio
from datetime import datetime, timezone
from typing import Optional, List
from contextlib import asynccontextmanager

import paho.mqtt.client as mqtt
from fastapi import FastAPI, Depends, HTTPException, Query
from sqlalchemy import create_engine, Column, String, Float, Integer, DateTime, Boolean, desc
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
from pydantic import BaseModel, Field
import uvicorn

# ========== CONFIGURAÇÕES ==========
MQTT_BROKER = os.environ.get("MQTT_BROKER", "localhost")
MQTT_PORT = int(os.environ.get("MQTT_PORT", 1883))
MQTT_TOPIC = os.environ.get("MQTT_TOPIC", "fleet/+/telemetry")
MQTT_QOS = int(os.environ.get("MQTT_QOS", 0))
DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./telemetry.db")
LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO").upper()
API_HOST = os.environ.get("API_HOST", "0.0.0.0")
API_PORT = int(os.environ.get("API_PORT", 8000))

# Configuração de logging
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL),
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger("mqtt-fleet-service")

# ========== BANCO DE DADOS ==========
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False} if "sqlite" in DATABASE_URL else {})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class Telemetry(Base):
    __tablename__ = "telemetry"

    id = Column(Integer, primary_key=True, index=True)
    truck_id = Column(String, index=True, nullable=False)
    timestamp = Column(DateTime, nullable=False, index=True)
    temperature = Column(Float, nullable=False)
    humidity = Column(Float, nullable=False)
    door = Column(String, nullable=False)  # "aberta" ou "fechada"
    lat = Column(Float, nullable=False)
    lon = Column(Float, nullable=False)
    speed = Column(Float, nullable=False)
    total_odometer = Column(Float, nullable=False)
    trip_odometer = Column(Float, nullable=False)
    external_temperature = Column(Float, nullable=False)
    external_humidity = Column(Float, nullable=False)

Base.metadata.create_all(bind=engine)

# ========== SCHEMAS PYDANTIC ==========
class TelemetryIn(BaseModel):
    truck_id: str
    timestamp: str  # ISO string
    temperature: float
    humidity: float
    door: str
    lat: float
    lon: float
    speed: float
    total_odometer: float
    trip_odometer: float
    external_temperature: float
    external_humidity: float

class TelemetryOut(BaseModel):
    id: int
    truck_id: str
    timestamp: datetime
    temperature: float
    humidity: float
    door: str
    lat: float
    lon: float
    speed: float
    total_odometer: float
    trip_odometer: float
    external_temperature: float
    external_humidity: float

    class Config:
        from_attributes = True

# ========== MQTT CLIENT ==========
mqtt_client = None

def on_connect(client, userdata, flags, reason_code, properties=None):
    if reason_code == 0:
        logger.info("Conectado ao broker MQTT")
        client.subscribe(MQTT_TOPIC, qos=MQTT_QOS)
        logger.info(f"Subscrito ao tópico: {MQTT_TOPIC}")
    else:
        logger.error(f"Falha na conexão MQTT, código {reason_code}")

def on_message(client, userdata, msg):
    """Callback chamada ao receber uma mensagem MQTT."""
    try:
        payload = msg.payload.decode("utf-8")
        data = json.loads(payload)
        logger.debug(f"Mensagem recebida no tópico {msg.topic}: {payload}")

        # Converte timestamp ISO para datetime
        timestamp_str = data.get("timestamp")
        if not timestamp_str:
            logger.warning("Mensagem sem campo timestamp, ignorada")
            return
        # Tenta parsear com ou sem microssegundos
        try:
            dt = datetime.fromisoformat(timestamp_str)
        except ValueError:
            dt = datetime.strptime(timestamp_str, "%Y-%m-%dT%H:%M:%S.%f%z")
        
        # Cria objeto para banco
        telemetry = Telemetry(
            truck_id=data["truck_id"],
            timestamp=dt,
            temperature=data["temperature"],
            humidity=data["humidity"],
            door=data["door"],
            lat=data["lat"],
            lon=data["lon"],
            speed=data["speed"],
            total_odometer=data["total_odometer"],
            trip_odometer=data["trip_odometer"],
            external_temperature=data["external_temperature"],
            external_humidity=data["external_humidity"],
        )
        # Salva no banco usando sessão independente
        db = SessionLocal()
        try:
            db.add(telemetry)
            db.commit()
            logger.debug(f"Telemetria de {data['truck_id']} salva no banco")
        except Exception as e:
            db.rollback()
            logger.error(f"Erro ao salvar no banco: {e}")
        finally:
            db.close()
    except json.JSONDecodeError:
        logger.error(f"Payload inválido (JSON): {msg.payload}")
    except KeyError as e:
        logger.error(f"Campo ausente na mensagem: {e}")
    except Exception as e:
        logger.error(f"Erro inesperado ao processar mensagem: {e}")

def setup_mqtt():
    """Inicializa e conecta o cliente MQTT."""
    global mqtt_client
    mqtt_client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    mqtt_client.on_connect = on_connect
    mqtt_client.on_message = on_message
    mqtt_client.connect(MQTT_BROKER, MQTT_PORT, 60)
    mqtt_client.loop_start()  # roda em thread separada
    return mqtt_client

# ========== FASTAPI LIFESPAN ==========
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Inicializa MQTT na startup
    logger.info("Iniciando microserviço...")
    setup_mqtt()
    yield
    # Desconecta MQTT no shutdown
    if mqtt_client:
        mqtt_client.loop_stop()
        mqtt_client.disconnect()
        logger.info("Cliente MQTT desconectado")

app = FastAPI(
    title="Fleet Telemetry Service",
    description="Captura dados MQTT e armazena em banco de dados",
    version="1.0.0",
    lifespan=lifespan
)

# ========== DEPENDÊNCIAS ==========
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# ========== ENDPOINTS ==========
@app.get("/health", tags=["Health"])
async def health_check():
    """Verifica se o serviço está ativo."""
    return {"status": "ok", "mqtt_connected": mqtt_client.is_connected() if mqtt_client else False}

@app.get("/telemetry", response_model=List[TelemetryOut], tags=["Telemetry"])
def get_telemetry(
    truck_id: Optional[str] = Query(None, description="Filtrar por ID do caminhão"),
    start_time: Optional[str] = Query(None, description="ISO inicial (ex: 2025-01-01T00:00:00)"),
    end_time: Optional[str] = Query(None, description="ISO final"),
    limit: int = Query(100, ge=1, le=1000, description="Máximo de registros"),
    offset: int = Query(0, ge=0, description="Pular registros"),
    db: Session = Depends(get_db)
):
    """
    Retorna registros de telemetria com filtros opcionais.
    """
    query = db.query(Telemetry)
    if truck_id:
        query = query.filter(Telemetry.truck_id == truck_id)
    if start_time:
        try:
            start_dt = datetime.fromisoformat(start_time)
            query = query.filter(Telemetry.timestamp >= start_dt)
        except ValueError:
            raise HTTPException(status_code=400, detail="Formato start_time inválido, use ISO")
    if end_time:
        try:
            end_dt = datetime.fromisoformat(end_time)
            query = query.filter(Telemetry.timestamp <= end_dt)
        except ValueError:
            raise HTTPException(status_code=400, detail="Formato end_time inválido, use ISO")
    
    results = query.order_by(desc(Telemetry.timestamp)).offset(offset).limit(limit).all()
    return results

@app.get("/telemetry/latest/{truck_id}", response_model=TelemetryOut, tags=["Telemetry"])
def get_latest_telemetry(truck_id: str, db: Session = Depends(get_db)):
    """Retorna a última telemetria de um caminhão específico."""
    record = db.query(Telemetry).filter(Telemetry.truck_id == truck_id).order_by(desc(Telemetry.timestamp)).first()
    if not record:
        raise HTTPException(status_code=404, detail="Caminhão não encontrado ou sem dados")
    return record

@app.get("/trucks", tags=["Telemetry"])
def list_trucks(db: Session = Depends(get_db)):
    """Lista todos os IDs de caminhões que já enviaram dados."""
    trucks = db.query(Telemetry.truck_id).distinct().all()
    return [t[0] for t in trucks]

# ========== PONTO DE ENTRADA ==========
if __name__ == "__main__":
    logger.info(f"Iniciando servidor FastAPI em {API_HOST}:{API_PORT}")
    uvicorn.run(app, host=API_HOST, port=API_PORT, log_level=LOG_LEVEL.lower())