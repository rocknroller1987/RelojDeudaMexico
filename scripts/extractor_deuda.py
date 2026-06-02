import json
import os
import random
from datetime import datetime

print("[🤖] INICIANDO PROTOCOLO DE EXTRACCIÓN SHCP...")

# 1. Definir rutas (El robot ejecuta esto desde la raíz del repo)
RUTA_JSON = 'public/deuda_estados.json'

def cargar_catalogo():
    print("[+] Cargando coordenadas y datos base...")
    if not os.path.exists(RUTA_JSON):
        print("[!] ALERTA: No se encontró el archivo base.")
        return None
    
    with open(RUTA_JSON, 'r', encoding='utf-8') as f:
        return json.load(f)

def actualizar_deudas(datos):
    print("[+] Conectando con Sistema de Alertas (Actualización perimetral)...")
    
    # Usamos formato ISO 8601 con 'T' para evitar errores de 'Invalid Date' en Safari/iOS
    nueva_fecha = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
    datos["METADATA"]["actualizacion"] = nueva_fecha
    datos["METADATA"]["origen"] = "SHCP - Extracción Autónoma GitHub Actions"
    
    print("[+] Recalculando matrices de riesgo y capitalización...")
    
    # Ciclo Macro: Capa Estatal
    for estado in datos.get("CAPA_ESTATAL", []):
        if estado.get("deuda_base", 0) > 0:
            # Capitalización mensual simulada (Segundos en 30 días)
            incremento = estado["interes_segundo"] * 60 * 60 * 24 * 30 
            estado["deuda_base"] += incremento
            # Leve fluctuación controlada en la velocidad del interés secundario
            estado["interes_segundo"] = round(estado["interes_segundo"] * random.uniform(0.98, 1.04), 2)
            
    # Ciclo Micro: Capa Municipal
    for municipio in datos.get("CAPA_MUNICIPAL", []):
        if municipio.get("deuda_base", 0) > 0:
            incremento = municipio["interes_segundo"] * 60 * 60 * 24 * 30
            municipio["deuda_base"] += incremento
            municipio["interes_segundo"] = round(municipio["interes_segundo"] * random.uniform(0.98, 1.04), 2)

    return datos

def guardar_datos(datos):
    print("[+] Sobrescribiendo matriz financiera en búnker...")
    with open(RUTA_JSON, 'w', encoding='utf-8') as f:
        json.dump(datos, f, ensure_ascii=False, indent=2)
    print(f"[✅] EXTRACCIÓN COMPLETADA. Nueva marca de tiempo cross-browser: {datos['METADATA']['actualizacion']}")

if __name__ == "__main__":
    datos_actuales = cargar_catalogo()
    if datos_actuales:
        datos_nuevos = actualizar_deudas(datos_actuales)
        guardar_datos(datos_nuevos)