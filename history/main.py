#!/usr/bin/env python3
"""
Microserviço FastAPI para capturar e armazenar telemetria e notificações de caminhões refrigerados.
- Subscreve tópicos MQTT (fleet/+/telemetry)
- Armazena dados em banco de dados SQLite (ou PostgreSQL)
- Gera e persiste notificações baseadas em limites configuráveis
- Disponibiliza API REST para consulta, gerenciamento de usuários controladores e health check
"""

import json
import os
import logging
import asyncio
from datetime import datetime, timezone
from typing import Optional, List, Dict
from contextlib import asynccontextmanager

import paho.mqtt.client as mqtt
from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy import create_engine, Column, String, Float, Integer, DateTime, Boolean, desc
from sqlalchemy.orm import declarative_base, sessionmaker, Session
from pydantic import BaseModel, Field, ConfigDict
import uvicorn
import requests

# Criptografia nativa e Tokens JWT (Sem dependência de passlib)
import bcrypt
import jwt

# ========== CONFIGURAÇÕES ==========
MQTT_BROKER = os.environ.get("MQTT_BROKER", "localhost")
MQTT_PORT = int(os.environ.get("MQTT_PORT", 1883))
MQTT_TOPIC = os.environ.get("MQTT_TOPIC", "fleet/+/telemetry")
MQTT_QOS = int(os.environ.get("MQTT_QOS", 0))
DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./telemetry.db")
LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO").upper()
API_HOST = os.environ.get("API_HOST", "0.0.0.0")
API_PORT = int(os.environ.get("API_PORT", 8000))

# Limites para geração de notificações
TEMP_MIN_C = float(os.environ.get("TEMP_MIN_C", "-25.0"))
TEMP_MAX_C = float(os.environ.get("TEMP_MAX_C", "-10.0"))
HUMIDITY_MAX_PCT = float(os.environ.get("HUMIDITY_MAX_PCT", "90.0"))
SPEED_MAX_KMH = float(os.environ.get("SPEED_MAX_KMH", "80.0"))
DOOR_OPEN_MAX_SEC = float(os.environ.get("DOOR_OPEN_MAX_SEC", "120.0"))

# Webhook opcional (Slack, Discord, etc.)
ALERT_WEBHOOK_URL = os.environ.get("ALERT_WEBHOOK_URL", "")
ENABLE_CONSOLE_ALERTS = os.environ.get("ENABLE_CONSOLE_ALERTS", "true").lower() == "true"
NOTIFICATIONS_URL = os.environ.get("NOTIFICATIONS_URL", "http://notifications:8001")

# Configurações de Segurança e JWT
SECRET_KEY = os.environ.get("JWT_SECRET", "sua_chave_secreta_super_segura_para_desenvolvimento")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login")

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

class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)
    truck_id = Column(String, index=True, nullable=False)
    timestamp = Column(DateTime, nullable=False, index=True)
    alert_type = Column(String, nullable=False)  # temp_low, temp_high, humidity, speed, door_open
    message = Column(String, nullable=False)
    data_snapshot = Column(String, nullable=True)  # JSON snapshot da telemetria

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)

# Inicializa as tabelas do banco de dados (Telemetry, Notification e User)
Base.metadata.create_all(bind=engine)


# ========== AUXILIARES DE CRIPTOGRAFIA (BCRYPT NATIVO) ==========
def get_password_hash(password: str) -> str:
    """Gera o hash da senha de forma segura usando bcrypt puro."""
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode('utf-8'), salt).decode('utf-8')

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verifica se a senha em texto limpo corresponde ao hash do banco."""
    try:
        return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))
    except Exception:
        return False


# ==================== SEED AUTOMÁTICO DO USUÁRIO ADMIN ====================
db_init = SessionLocal()
try:
    admin_exists = db_init.query(User).filter(User.email == "admin").first()
    if not admin_exists:
        logger.info("Nenhum usuário administrativo encontrado. Criando credenciais padrão...")
        default_admin = User(
            email="admin",
            hashed_password=get_password_hash("admin")
        )
        db_init.add(default_admin)
        db_init.commit()
        logger.info("🔥 Usuário padrão criado com sucesso! Login: admin | Senha: admin")
except Exception as e:
    logger.error(f"Erro na rotina de inicialização de sementes (Seed): {e}")
finally:
    db_init.close()
# ===========================================================================


# ========== SCHEMAS PYDANTIC (ATUALIZADOS PARA V2) ==========
class TelemetryIn(BaseModel):
    truck_id: str
    timestamp: str
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
    
    model_config = ConfigDict(from_attributes=True)

class NotificationOut(BaseModel):
    id: int
    truck_id: str
    timestamp: datetime
    alert_type: str
    message: str
    data_snapshot: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)

class UserCreate(BaseModel):
    email: str
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str

# ========== CONTROLE DE COOLDOWN (EVITAR SPAM) ==========
last_alert_time: Dict[str, Dict[str, float]] = {}
door_open_start: Dict[str, float] = {}
door_alert_sent: Dict[str, bool] = {}

ALERT_COOLDOWN_MS = 30000  # 30 segundos

def should_send_alert(truck_id: str, alert_type: str) -> bool:
    now_ms = datetime.now().timestamp() * 1000
    if truck_id not in last_alert_time:
        last_alert_time[truck_id] = {}
    last_ms = last_alert_time[truck_id].get(alert_type, 0)
    if now_ms - last_ms < ALERT_COOLDOWN_MS:
        return False
    last_alert_time[truck_id][alert_type] = now_ms
    return True

# ========== FUNÇÕES DE NOTIFICAÇÃO ==========
def save_notification(db: Session, truck_id: str, alert_type: str, message: str, snapshot: dict):
    notif = Notification(
        truck_id=truck_id,
        timestamp=datetime.now(timezone.utc),
        alert_type=alert_type,
        message=message,
        data_snapshot=json.dumps(snapshot, ensure_ascii=False)
    )
    db.add(notif)
    db.commit()
    logger.info(f"Notificação salva: {truck_id} - {alert_type} - {message}")

def send_alert_notification(message: str, snapshot: dict):
    if ENABLE_CONSOLE_ALERTS:
        print("\n" + "=" * 80)
        print(f"🚨 {message}")
        print("=" * 80 + "\n")
    
    if ALERT_WEBHOOK_URL:
        try:
            payload = {
                "text": message,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "data": snapshot
            }
            requests.post(ALERT_WEBHOOK_URL, json=payload, timeout=2)
        except Exception as e:
            logger.error(f"Erro ao enviar webhook: {e}")

# ========== LÓGICA DE AVALIAÇÃO DE SENSORES ==========
def check_and_notify(data: dict, db: Session):
    truck_id = data["truck_id"]
    temp = data["temperature"]
    humidity = data["humidity"]
    speed = data["speed"]
    door = data["door"]

    if temp < TEMP_MIN_C:
        if should_send_alert(truck_id, "temp_low"):
            msg = f"Temperatura MUITO BAIXA: {temp}°C < {TEMP_MIN_C}°C"
            save_notification(db, truck_id, "temp_low", msg, data)
            send_alert_notification(f"Caminhão {truck_id}: {msg}", data)
    elif temp > TEMP_MAX_C:
        if should_send_alert(truck_id, "temp_high"):
            msg = f"Temperatura MUITO ALTA: {temp}°C > {TEMP_MAX_C}°C"
            save_notification(db, truck_id, "temp_high", msg, data)
            send_alert_notification(f"Caminhão {truck_id}: {msg}", data)

    if humidity > HUMIDITY_MAX_PCT:
        if should_send_alert(truck_id, "humidity"):
            msg = f"Umidade elevada: {humidity}% > {HUMIDITY_MAX_PCT}%"
            save_notification(db, truck_id, "humidity", msg, data)
            send_alert_notification(f"Caminhão {truck_id}: {msg}", data)

    if speed > SPEED_MAX_KMH:
        if should_send_alert(truck_id, "speed"):
            msg = f"Velocidade excessiva: {speed} km/h > {SPEED_MAX_KMH} km/h"
            save_notification(db, truck_id, "speed", msg, data)
            send_alert_notification(f"Caminhão {truck_id}: {msg}", data)

    current_time = datetime.now().timestamp()
    if door == "aberta":
        if truck_id not in door_open_start:
            door_open_start[truck_id] = current_time
            door_alert_sent[truck_id] = False
        else:
            open_duration = current_time - door_open_start[truck_id]
            if open_duration > DOOR_OPEN_MAX_SEC and not door_alert_sent[truck_id]:
                if should_send_alert(truck_id, "door_open"):
                    msg = f"Porta aberta por {open_duration:.0f} segundos (limite: {DOOR_OPEN_MAX_SEC}s)"
                    save_notification(db, truck_id, "door_open", msg, data)
                    send_alert_notification(f"Caminhão {truck_id}: {msg}", data)
                    door_alert_sent[truck_id] = True
    else:
        if truck_id in door_open_start:
            del door_open_start[truck_id]
            door_alert_sent.pop(truck_id, None)

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
    try:
        payload = msg.payload.decode("utf-8")
        data = json.loads(payload)

        timestamp_str = data.get("timestamp")
        if not timestamp_str:
            return
        try:
            dt = datetime.fromisoformat(timestamp_str)
        except ValueError:
            dt = datetime.strptime(timestamp_str, "%Y-%m-%dT%H:%M:%S.%f%z")
        
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
        db = SessionLocal()
        try:
            db.add(telemetry)
            db.commit()
            check_and_notify(data, db)
        except Exception as e:
            db.rollback()
            logger.error(f"Erro ao salvar no banco: {e}")
        finally:
            db.close()
            try:
                requests.post(f"{NOTIFICATIONS_URL}/telemetry/{data['truck_id']}", json=data, timeout=1)
            except Exception:
                pass
    except Exception as e:
        logger.error(f"Erro ao processar mensagem MQTT: {e}")

def setup_mqtt():
    global mqtt_client
    mqtt_client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    mqtt_client.on_connect = on_connect
    mqtt_client.on_message = on_message
    mqtt_client.connect(MQTT_BROKER, MQTT_PORT, 60)
    mqtt_client.loop_start()
    return mqtt_client

# ========== FASTAPI LIFESPAN ==========
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Iniciando microserviço...")
    setup_mqtt()
    yield
    if mqtt_client:
        mqtt_client.loop_stop()
        mqtt_client.disconnect()
        logger.info("Cliente MQTT desconectado")

app = FastAPI(
    title="Fleet Telemetry Service with Notifications & Auth",
    description="Captura dados MQTT, armazena telemetria e gerencia segurança de acesso",
    version="2.5.0",
    lifespan=lifespan
)

# ========== MIDDLEWARE CORS TOTALMENTE ABERTO (SEM CREDENCIAIS) ==========
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ========== DEPENDÊNCIAS DE BANCO ==========
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# ========== AUXILIAR DE TOKEN JWT ==========
def create_access_token(data: dict):
    to_encode = data.copy()
    token = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    if isinstance(token, bytes):
        return token.decode("utf-8")
    return token

def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=401,
        detail="Não foi possível validar as credenciais de acesso.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        if email is None:
            raise credentials_exception
    except jwt.PyJWTError:
        raise credentials_exception
        
    user = db.query(User).filter(User.email == email).first()
    if user is None:
        raise credentials_exception
    return user

# ========== ENDPOINTS DE AUTENTICAÇÃO ==========

@app.post("/register", tags=["Autenticação"])
def register(user_in: UserCreate, db: Session = Depends(get_db)):
    """Cria uma nova conta de operador/controlador da frota."""
    user_exists = db.query(User).filter(User.email == user_in.email).first()
    if user_exists:
        raise HTTPException(status_code=400, detail="Este e-mail já está cadastrado no sistema.")
    
    new_user = User(
        email=user_in.email,
        hashed_password=get_password_hash(user_in.password)
    )
    db.add(new_user)
    db.commit()
    return {"status": "sucesso", "message": "Usuário criado com sucesso!"}

@app.post("/login", response_model=Token, tags=["Autenticação"])
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    """Valida as credenciais e retorna o Token de Acesso JWT para o Front-end."""
    user = db.query(User).filter(User.email == form_data.username).first()
    
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=400, detail="E-mail ou senha incorretos.")
    
    access_token = create_access_token(data={"sub": user.email})
    return {"access_token": access_token, "token_type": "bearer"}

@app.get("/users/me", tags=["Autenticação"])
def read_users_me(current_user: User = Depends(get_current_user)):
    """Retorna os dados do usuário conectado se o token enviado for válido."""
    return {"id": current_user.id, "email": current_user.email}

# ========== ENDPOINTS DE TELEMETRIA E NOTIFICAÇÕES ==========

@app.get("/health", tags=["Health"])
async def health_check():
    return {"status": "ok", "mqtt_connected": mqtt_client.is_connected() if mqtt_client else False}

@app.get("/telemetry", response_model=List[TelemetryOut], tags=["Telemetry"])
def get_telemetry(
    truck_id: Optional[str] = Query(None),
    start_time: Optional[str] = Query(None),
    end_time: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db)
):
    query = db.query(Telemetry)
    if truck_id:
        query = query.filter(Telemetry.truck_id == truck_id)
    if start_time:
        try:
            start_dt = datetime.fromisoformat(start_time)
            query = query.filter(Telemetry.timestamp >= start_dt)
        except ValueError:
            raise HTTPException(status_code=400, detail="Formato start_time inválido")
    if end_time:
        try:
            end_dt = datetime.fromisoformat(end_time)
            query = query.filter(Telemetry.timestamp <= end_dt)
        except ValueError:
            raise HTTPException(status_code=400, detail="Formato end_time inválido")
    results = query.order_by(desc(Telemetry.timestamp)).offset(offset).limit(limit).all()
    return results

@app.get("/telemetry/latest/{truck_id}", response_model=TelemetryOut, tags=["Telemetry"])
def get_latest_telemetry(truck_id: str, db: Session = Depends(get_db)):
    record = db.query(Telemetry).filter(Telemetry.truck_id == truck_id).order_by(desc(Telemetry.timestamp)).first()
    if not record:
        raise HTTPException(status_code=404, detail="Caminhão não encontrado")
    return record

@app.get("/trucks", tags=["Telemetry"])
def list_trucks(db: Session = Depends(get_db)):
    trucks = db.query(Telemetry.truck_id).distinct().all()
    return [t[0] for t in trucks]

@app.get("/notifications", response_model=List[NotificationOut], tags=["Notifications"])
def get_notifications(
    truck_id: Optional[str] = Query(None),
    alert_type: Optional[str] = Query(None, description="temp_low, temp_high, humidity, speed, door_open"),
    start_time: Optional[str] = Query(None),
    end_time: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db)
):
    """Retorna as notificações geradas e armazenadas, com filtros opcionais."""
    query = db.query(Notification)
    if truck_id:
        query = query.filter(Notification.truck_id == truck_id)
    if alert_type:
        query = query.filter(Notification.alert_type == alert_type)
    if start_time:
        try:
            start_dt = datetime.fromisoformat(start_time)
            query = query.filter(Notification.timestamp >= start_dt)
        except ValueError:
            raise HTTPException(status_code=400, detail="Formato start_time inválido")
    if end_time:
        try:
            end_dt = datetime.fromisoformat(end_time)
            query = query.filter(Notification.timestamp <= end_dt)
        except ValueError:
            raise HTTPException(status_code=400, detail="Formato end_time inválido")
    results = query.order_by(desc(Notification.timestamp)).offset(offset).limit(limit).all()
    return results

@app.get("/notifications/latest/{truck_id}", response_model=List[NotificationOut], tags=["Notifications"])
def get_latest_notifications(truck_id: str, limit: int = 10, db: Session = Depends(get_db)):
    """Retorna o histórico imediato de alertas de um veículo."""
    records = db.query(Notification).filter(Notification.truck_id == truck_id)\
        .order_by(desc(Notification.timestamp)).limit(limit).all()
    return records

if __name__ == "__main__":
    logger.info(f"Iniciando servidor FastAPI em {API_HOST}:{API_PORT}")
    uvicorn.run(app, host=API_HOST, port=API_PORT, log_level=LOG_LEVEL.lower())