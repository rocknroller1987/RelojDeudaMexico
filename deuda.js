import './style.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibregl from 'maplibre-gl';

// 1. INICIALIZACIÓN DEL MAPA FINANCIERO
const map = new maplibregl.Map({
  container: 'mapa-financiero',
  style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  center: [-102.552784, 23.634501],
  zoom: 4.5,
  pitch: 20,
  maxZoom: 14,
  minZoom: 4
});

// --- VARIABLES GLOBALES DEL MOTOR DE RELOJES ---
let datosFinancieros = null;
let deudaBaseActual = 0;
let incrementoPorMilisegundo = 0;
let poblacionActual = 1;
let timestampReporte = 0;

// 2. CONSTRUCCIÓN DE LA CAPA GEOJSON DESDE EL JSON DE DEUDA
function convertirA_GeoJSON(datosOriginales) {
  const puntosGeoJSON = [];
  
  // Procesamos la capa de estados (Homologando la propiedad 'nombre')
  datosOriginales.CAPA_ESTATAL.forEach(est => {
    const nombreEstado = est.nombre || est.estado || "Desconocido";
    puntosGeoJSON.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [est.lng, est.lat] },
      properties: { 
        ...est, 
        nombre: nombreEstado, // Forzamos consistencia
        tipoCapa: "estatal", 
        intensidad_heatmap: est.deuda_base / 1000000000 
      }
    });
  });

  // Procesamos la capa municipal
  datosOriginales.CAPA_MUNICIPAL.forEach(mun => {
    const nombreMunicipio = mun.municipio || mun.nombre || "Desconocido";
    puntosGeoJSON.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [mun.lng, mun.lat] },
      properties: { 
        ...mun, 
        nombre: nombreMunicipio, // Forzamos consistencia
        tipoCapa: "municipal", 
        intensidad_heatmap: mun.deuda_base / 100000000 
      }
    });
  });

  return { type: "FeatureCollection", features: puntosGeoJSON };
}

// 3. CARGA DE DATOS Y RENDERIZADO BIFÁSICO
map.on('load', async () => {
  try {
    // Intentamos cargar desde la raíz relativa
    const response = await fetch('./deuda_estados.json');
    datosFinancieros = await response.json();
    
    // Fijamos el timestamp antes de arrancar cualquier reloj
    timestampReporte = datosFinancieros.METADATA?.actualizacion 
      ? new Date(datosFinancieros.METADATA.actualizacion).getTime() 
      : Date.now();

    // Homologamos la inicialización por si las claves cambian
    const defaultData = datosFinancieros.CAPA_ESTATAL.find(e => e.id === "NL" || (e.nombre && e.nombre.toUpperCase().includes("NUEVO")));
    
    if (defaultData) {
      // Asegurar que lleve la propiedad 'nombre' mapeada para el panel
      const datosIniciales = { ...defaultData, nombre: defaultData.nombre || defaultData.estado || "NUEVO LEÓN" };
      arrancarReloj(datosIniciales);
    } else if (datosFinancieros.CAPA_ESTATAL.length > 0) {
      // Si no encuentra Nuevo León por algún motivo, toma el primero de la lista para no dejar la pantalla en ceros
      const primerEstado = datosFinancieros.CAPA_ESTATAL[0];
      const datosIniciales = { ...primerEstado, nombre: primerEstado.nombre || primerEstado.estado };
      arrancarReloj(datosIniciales);
    }

    const geojsonData = convertirA_GeoJSON(datosFinancieros);
    map.addSource('puntos-deuda', { type: 'geojson', data: geojsonData });
    
    generarRanking(datosFinancieros);

    // ==========================================
    // CAPA 1: MACRO (ESTADOS) - Visible de Zoom 0 a 7
    // ==========================================
    map.addLayer({
      id: 'calor-estatal',
      type: 'heatmap',
      source: 'puntos-deuda',
      maxzoom: 7,
      filter: ['==', 'tipoCapa', 'estatal'],
      paint: {
        'heatmap-weight': ['interpolate', ['linear'], ['get', 'intensidad_heatmap'], 0, 0, 100, 1],
        'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 4, 1.5, 7, 3],
        'heatmap-color': [
          'interpolate', ['linear'], ['heatmap-density'],
          0, 'rgba(0,0,0,0)', 
          0.2, '#eab308',
          0.5, '#ff0055',
          0.8, '#ffffff'
        ],
        'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 4, 35, 7, 80],
        'heatmap-opacity': 0.8
      }
    });

    map.addLayer({
      id: 'interactivo-estatal',
      type: 'circle',
      source: 'puntos-deuda',
      maxzoom: 7,
      filter: ['==', 'tipoCapa', 'estatal'],
      paint: { 'circle-radius': 30, 'circle-color': 'transparent' }
    });

    // ==========================================
    // CAPA 2: MICRO (MUNICIPIOS) - Visible de Zoom 7 en adelante
    // ==========================================
    map.addLayer({
      id: 'calor-municipal',
      type: 'heatmap',
      source: 'puntos-deuda',
      minzoom: 7,
      filter: ['==', 'tipoCapa', 'municipal'],
      paint: {
        'heatmap-weight': ['interpolate', ['linear'], ['get', 'intensidad_heatmap'], 0, 0, 20, 1],
        'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 7, 1.5, 14, 5],
        'heatmap-color': [
          'interpolate', ['linear'], ['heatmap-density'],
          0, 'rgba(0,0,0,0)', 
          0.2, '#06b6d4',
          0.5, '#a855f7',
          0.8, '#ffffff'
        ],
        'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 7, 20, 14, 60],
        'heatmap-opacity': 0.95
      }
    });

    map.addLayer({
      id: 'interactivo-municipal',
      type: 'circle',
      source: 'puntos-deuda',
      minzoom: 7,
      filter: ['==', 'tipoCapa', 'municipal'],
      paint: { 'circle-radius': 20, 'circle-color': 'transparent' }
    });

    // ==========================================
    // INTERACCIÓN Y RADAR
    // ==========================================
    const capasBlancos = ['interactivo-estatal', 'interactivo-municipal'];

    capasBlancos.forEach(capa => {
      map.on('click', capa, (e) => {
        const propiedades = e.features[0].properties;
        arrancarReloj(propiedades);
      });

      map.on('mousemove', capa, (e) => {
        map.getCanvas().style.cursor = 'crosshair';
        const props = e.features[0].properties;
        const hud = document.getElementById('hud-financiero');
        
        if (hud && props.nombre) {
          hud.style.opacity = '1';
          document.getElementById('hud-fin-region').innerText = props.nombre.toUpperCase();
          
          let colorSemaforo = '#22c55e';
          if (props.deuda_base > 0) colorSemaforo = '#eab308';
          if (props.deuda_base > 50000000000) colorSemaforo = '#ff0055';
          
          document.getElementById('hud-fin-status').innerHTML = `<span style="color: ${colorSemaforo}; font-weight: bold;">OBJETIVO FIJADO [${props.tipoCapa.toUpperCase()}]</span>`;
        }
      });

      map.on('mouseleave', capa, () => {
        map.getCanvas().style.cursor = '';
        const hud = document.getElementById('hud-financiero');
        if (hud) hud.style.opacity = '0';
      });
    });

  } catch (error) {
    console.error("Error crítico cargando la matriz de deuda:", error);
  }
});

// 4. LÓGICA DEL MOTOR DE RELOJES
function arrancarReloj(datos) {
  if (!datos) return;
  
  const nombrePanel = datos.nombre || datos.estado || "DESCONOCIDO";
  document.getElementById('txt-estado-seleccionado').textContent = nombrePanel.toUpperCase();
  
  const tag = document.getElementById('tag-semaforo');
  const deuda = datos.deuda_base || 0;
  
  tag.className = "semaforo-tag";
  if (deuda > 50000000000) {
    tag.textContent = "ALERTA: CRÍTICA"; tag.classList.add("tag-rojo");
  } else if (deuda > 0) {
    tag.textContent = "ALERTA: OBSERVACIÓN"; tag.classList.add("tag-amarillo");
  } else {
    tag.textContent = "FINANZAS ESTABLECIDAS"; tag.classList.add("tag-verde");
  }

  const velocidadSeg = datos.interes_segundo || 0;
  document.getElementById('txt-velocidad').textContent = `▲ $${velocidadSeg.toFixed(2)} pesos / seg`;

  // Actualizar variables de cálculo dinámico
  deudaBaseActual = deuda;
  incrementoPorMilisegundo = velocidadSeg / 1000;
  poblacionActual = datos.poblacion || 1;
}

// Bucle de renderizado continuo (60 FPS)
function actualizarRelojContinuo() {
  if (deudaBaseActual >= 0 && timestampReporte > 0) {
    const ahora = Date.now();
    const milisegundosTranscurridos = ahora - timestampReporte;
    const deudaEnVivo = deudaBaseActual + (incrementoPorMilisegundo * milisegundosTranscurridos);
    const cuotaPerCapita = deudaEnVivo / poblacionActual;

    const formateador = new Intl.NumberFormat('es-MX', {
      style: 'currency', currency: 'MXN', minimumFractionDigits: 2
    });

    const elDeudaTotal = document.getElementById('clk-deuda-total');
    const elCuotaCiudadana = document.getElementById('clk-cuota-ciudadana');

    if (elDeudaTotal) elDeudaTotal.textContent = formateador.format(deudaEnVivo);
    if (elCuotaCiudadana) elCuotaCiudadana.textContent = formateador.format(cuotaPerCapita);
  }
  requestAnimationFrame(actualizarRelojContinuo);
}

// Arrancamos el bucle de renderizado
requestAnimationFrame(actualizarRelojContinuo);

// 5. GENERADOR DE RANKING NACIONAL
function generarRanking(datos) {
  if (!datos || !datos.CAPA_ESTATAL) return;

  const ranking = [...datos.CAPA_ESTATAL]
    .sort((a, b) => b.deuda_base - a.deuda_base)
    .slice(0, 5);

  const contenedor = document.getElementById('lista-ranking');
  if (!contenedor) return;
  contenedor.innerHTML = '';

  const formateador = new Intl.NumberFormat('es-MX', {
    style: 'currency', currency: 'MXN', maximumFractionDigits: 0
  });

  ranking.forEach((estado, index) => {
    const porcentaje = (estado.deuda_base / ranking[0].deuda_base) * 100;
    const nombreEstado = estado.nombre || estado.estado || "Desconocido";
    
    contenedor.innerHTML += `
      <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
        <span style="color: #fff;">${index + 1}. ${nombreEstado.toUpperCase()}</span>
        <span style="color: #ff0055; font-weight: bold;">${formateador.format(estado.deuda_base)}</span>
      </div>
      <div style="width: 100%; background: #111; height: 4px; margin-bottom: 10px; border-radius: 2px;">
        <div style="width: ${porcentaje}%; background: #ff0055; height: 100%; border-radius: 2px;"></div>
      </div>
    `;
  });
}