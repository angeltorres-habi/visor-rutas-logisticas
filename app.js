/**
 * Visor de Rutas Logísticas
 * ---------------------------------------------------------
 * Dos modos, según el parámetro que traiga la URL:
 *
 *  - ?ciudad=bogota   -> modo API real: llama al backend de
 *    ruteo y renderiza su map_geojson. Al terminar, agrega
 *    "&fecha=YYYY-MM-DD" (hoy) a la URL del navegador.
 *  - ?id_ruta=Ruta01  -> modo archivo local: carga
 *    data/<id_ruta>.geojson (para pruebas sin backend).
 */

// Backend intermedio que arma el payload completo (visitas + visitadores)
// y llama a /get_visit_routes, devolviendo el resultado ya resuelto para
// una ciudad. TODO: reemplazar por la URL real cuando ese backend exista.
const API_ROUTING_URL = "https://TU-BACKEND-INTERMEDIO.example.com/ruta";

// Referencia global al mapa (se crea una sola vez).
let mapa = null;

/**
 * Punto de entrada. Decide el modo según los parámetros de la URL
 * y ejecuta el flujo completo: fetch -> extraer geojson -> dibujar.
 */
async function main() {
  const params = new URLSearchParams(window.location.search);
  const ciudad = (params.get("ciudad") || "").trim();
  const idRuta = (params.get("id_ruta") || "").trim();

  if (ciudad) {
    await ejecutarFlujo({
      titulo: `Ciudad: ${ciudad}`,
      mensajeCargando: `Consultando rutas de "${ciudad}"...`,
      obtenerJson: () => obtenerDatosRutaApi(ciudad),
      alTerminar: agregarFechaDeHoyALaUrl,
    });
    return;
  }

  if (idRuta) {
    await ejecutarFlujo({
      titulo: `Ruta: ${idRuta}`,
      mensajeCargando: `Cargando datos de la ruta "${idRuta}"...`,
      obtenerJson: () => obtenerDatosRutaSimulada(idRuta),
    });
    return;
  }

  mostrarError(
    "Falta el parámetro 'ciudad' en la URL. " +
      "Agrega algo como ?ciudad=bogota al final del enlace " +
      "(o ?id_ruta=Ruta01 para pruebas con archivos locales)."
  );
}

/**
 * Orquesta un flujo de carga: muestra el título y el estado de
 * carga, pide el JSON, extrae el GeoJSON y lo dibuja. Cualquier
 * error a lo largo del camino se muestra en pantalla.
 *
 * @param {Object} opciones
 * @param {string} opciones.titulo - Texto a mostrar junto al encabezado.
 * @param {string} opciones.mensajeCargando - Mensaje del overlay de carga.
 * @param {() => Promise<Object>} opciones.obtenerJson - Obtiene el JSON crudo de la API.
 * @param {() => void} [opciones.alTerminar] - Se ejecuta tras dibujar la ruta con éxito.
 */
async function ejecutarFlujo({ titulo, mensajeCargando, obtenerJson, alTerminar }) {
  document.getElementById("ruta-titulo").textContent = titulo;
  mapa = inicializarMapa();
  mostrarCargando(mensajeCargando);

  try {
    const jsonComplejo = await obtenerJson();
    const geoJson = procesarYExtraerGeoJson(jsonComplejo);
    dibujarRuta(geoJson);
    ocultarStatus();
    if (alTerminar) alTerminar();
  } catch (error) {
    console.error("Error al cargar la ruta:", error);
    mostrarError(error.message || "Ocurrió un error inesperado al cargar la ruta.");
  }
}

/**
 * Agrega "fecha=YYYY-MM-DD" (hoy, hora local) a la URL del navegador
 * sin recargar la página, para que el link refleje el día en que se
 * consultó la ruta. No pisa una fecha que ya venga en la URL.
 */
function agregarFechaDeHoyALaUrl() {
  const url = new URL(window.location.href);
  if (url.searchParams.get("fecha")) return;

  const hoy = new Date();
  const año = hoy.getFullYear();
  const mes = String(hoy.getMonth() + 1).padStart(2, "0");
  const dia = String(hoy.getDate()).padStart(2, "0");

  url.searchParams.set("fecha", `${año}-${mes}-${dia}`);
  window.history.replaceState({}, "", url);
}

/**
 * Crea y configura el mapa Leaflet con una capa base OSM.
 * @returns {L.Map}
 */
function inicializarMapa() {
  const map = L.map("map", {
    zoomControl: true,
    zoomSnap: 0, // zoom continuo: evita que fitBounds redondee hacia un zoom que recorte la ruta
  }).setView([4.6097, -74.0817], 6); // Vista inicial: Bogotá, se ajustará luego con fitBounds

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);

  return map;
}

/**
 * Llama al backend de ruteo real para una ciudad dada.
 *
 * NOTA: este backend intermedio arma el payload completo que espera
 * /get_visit_routes (visitas + visitadores del día) y expone algo
 * simple para el visor. Mientras no exista, esta función fallará con
 * un error de red claro — reemplaza API_ROUTING_URL cuando esté listo.
 *
 * Cualquier token/API key que ese backend necesite para llamar a
 * /get_visit_routes debe vivir en el backend, nunca aquí: este es
 * código estático que cualquiera puede leer en el navegador.
 *
 * @param {string} ciudad
 * @returns {Promise<Object>} JSON crudo devuelto por la API
 */
async function obtenerDatosRutaApi(ciudad) {
  const url = `${API_ROUTING_URL}?ciudad=${encodeURIComponent(ciudad)}`;
  const respuesta = await fetch(url);
  if (!respuesta.ok) {
    throw new Error(`La API de ruteo respondió con estado ${respuesta.status} para "${ciudad}".`);
  }
  return await respuesta.json();
}

/**
 * Extrae el GeoJSON del ruteo desde la respuesta cruda de la API,
 * probando las formas conocidas: la de /get_visit_routes
 * (data.map_geojson) y la de la simulación local
 * (resultado_ruteo.mapa_geojson).
 *
 * @param {Object} jsonComplejo
 * @returns {Object} GeoJSON válido
 */
function procesarYExtraerGeoJson(jsonComplejo) {
  const candidatos = [
    jsonComplejo?.data?.map_geojson,
    jsonComplejo?.resultado_ruteo?.mapa_geojson,
    jsonComplejo?.map_geojson,
  ];
  const geoJson = candidatos.find((candidato) => candidato && typeof candidato === "object");

  if (!geoJson) {
    throw new Error(
      "La respuesta de la API no contiene un GeoJSON reconocible " +
        "(se buscó en data.map_geojson y resultado_ruteo.mapa_geojson)."
    );
  }

  return geoJson;
}

const COLOR_POR_DEFECTO = "#2563eb";

// Bounding box amplio de Colombia. Se usa solo para decidir qué
// coordenadas entran en el fitBounds: algunas visitas o trayectos
// llegan con coordenadas de geocodificación fallida (ver
// "geolocalizacion_exito" en la respuesta de la API) muy lejos de
// la ciudad real, y sin este filtro el mapa termina encuadrando
// medio continente en vez de la ruta.
const COLOMBIA_BBOX = { latMin: -4.5, latMax: 13.5, lngMin: -79.5, lngMax: -66.5 };

/**
 * Dibuja el GeoJSON de la ruta en el mapa, coloreando cada
 * visitador con su propio color, y ajusta el zoom para encuadrar
 * la geometría (fitBounds), ignorando coordenadas fuera de Colombia.
 *
 * @param {Object} geoJson
 */
function dibujarRuta(geoJson) {
  const capaRuta = L.geoJSON(geoJson, {
    style: (feature) => ({
      color: colorDeFeature(feature) || COLOR_POR_DEFECTO,
      weight: 4,
      opacity: 0.9,
    }),
    pointToLayer: (feature, latlng) => {
      const color = colorDeFeature(feature) || COLOR_POR_DEFECTO;
      const info = infoDeVisita(feature);
      const tipo = tipoDePunto(feature, info);

      if (!tipo) {
        return L.circleMarker(latlng, {
          radius: 6,
          color,
          fillColor: color,
          fillOpacity: 1,
        });
      }

      const marcador = L.marker(latlng, { icon: crearIconoPunto(tipo, color) });
      marcador.bindPopup(
        tipo === "visita" ? crearPopupVisita(feature, info) : crearPopupInicio(feature)
      );
      return marcador;
    },
  }).addTo(mapa);

  const bounds = calcularBoundsValidos(geoJson);
  if (bounds.isValid()) {
    mapa.fitBounds(bounds, { padding: [50, 50] });
  } else {
    throw new Error("El GeoJSON de la ruta no tiene coordenadas válidas para encuadrar.");
  }

  mostrarLeyenda(geoJson);
}

/**
 * Calcula los límites geográficos a partir de las coordenadas del
 * GeoJSON que caen dentro de Colombia, descartando outliers de
 * geocodificación fallida (ver COLOMBIA_BBOX). Los features siguen
 * dibujándose todos; esto solo afecta el encuadre del mapa.
 *
 * @param {Object} geoJson
 * @returns {L.LatLngBounds}
 */
function calcularBoundsValidos(geoJson) {
  const features = geoJson.type === "FeatureCollection" ? geoJson.features : [geoJson];
  const bounds = L.latLngBounds([]);

  for (const feature of features) {
    recorrerCoordenadas(feature.geometry, ([lng, lat]) => {
      const dentroDeColombia =
        lat >= COLOMBIA_BBOX.latMin &&
        lat <= COLOMBIA_BBOX.latMax &&
        lng >= COLOMBIA_BBOX.lngMin &&
        lng <= COLOMBIA_BBOX.lngMax;

      if (dentroDeColombia) bounds.extend([lat, lng]);
    });
  }

  return bounds;
}

function recorrerCoordenadas(geometry, callback) {
  if (!geometry) return;
  const { type, coordinates } = geometry;

  if (type === "Point") return callback(coordinates);
  if (type === "LineString" || type === "MultiPoint") return coordinates.forEach(callback);
  if (type === "Polygon" || type === "MultiLineString") {
    return coordinates.forEach((linea) => linea.forEach(callback));
  }
  if (type === "MultiPolygon") {
    return coordinates.forEach((poligono) => poligono.forEach((linea) => linea.forEach(callback)));
  }
}

/**
 * Determina el color de un feature. El backend real (kind-based,
 * ver infoDeVisita) ya manda un "color" correcto en las propiedades.
 * Los exports de Google My Maps no traen ese campo: ahí se infiere
 * desde stroke/styleUrl, corrigiendo un bug conocido de la conversión
 * KML -> GeoJSON que invierte los canales rojo y azul de las líneas.
 *
 * @param {Object} feature
 * @returns {string|null} color en formato "#rrggbb", o null si no hay info de color
 */
function colorDeFeature(feature) {
  const props = feature.properties || {};

  if (props.color) return props.color;

  const esLinea =
    feature.geometry &&
    (feature.geometry.type === "LineString" || feature.geometry.type === "MultiLineString");

  const hexCrudo = props.stroke || extraerHexDeStyleUrl(props.styleUrl);
  if (!hexCrudo) return null;

  const hex = esLinea ? invertirRojoAzul(hexCrudo) : hexCrudo;
  return `#${hex}`;
}

function extraerHexDeStyleUrl(styleUrl) {
  const match = /-([0-9a-f]{6})-/i.exec(styleUrl || "");
  return match ? match[1].toLowerCase() : null;
}

function invertirRojoAzul(hex) {
  const r = hex.slice(0, 2);
  const g = hex.slice(2, 4);
  const b = hex.slice(4, 6);
  return `${b}${g}${r}`;
}

/**
 * Normaliza los datos de una visita a { Agente, NID, Tipo, Direccion,
 * Hora, Duracion }, sin importar si vienen como propiedades directas
 * (API real: kind === "visita") o como HTML/CDATA en "description"
 * (exports de Google My Maps).
 *
 * @param {Object} feature
 * @returns {Object|null}
 */
function infoDeVisita(feature) {
  const props = feature.properties || {};

  if (props.kind === "visita") {
    return {
      Agente: props.agente_nombre,
      NID: props.nid,
      Tipo: props.tipo,
      Direccion: props.direccion,
      Hora: props.hora,
      Duracion: props.duracion,
    };
  }

  return descripcionAObjeto(props.description);
}

/**
 * Convierte el campo "description" (HTML con CDATA que exporta
 * Google My Maps, ej. "<![CDATA[<br>NID: 25<br>Hora: 08:30am...")
 * en un objeto { NID: "25", Hora: "08:30am", ... }.
 *
 * @param {string|undefined} description
 * @returns {Object|null}
 */
function descripcionAObjeto(description) {
  if (!description) return null;

  const limpio = description.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "");
  const campos = limpio
    .split(/<br\s*\/?>/i)
    .map((campo) => campo.trim())
    .filter(Boolean);

  const info = {};
  for (const campo of campos) {
    const separador = campo.indexOf(":");
    if (separador === -1) continue;
    const clave = campo.slice(0, separador).trim();
    const valor = campo.slice(separador + 1).trim();
    if (clave && valor) info[clave] = valor;
  }

  return Object.keys(info).length > 0 ? info : null;
}

/**
 * Clasifica un punto en "inicio" (persona) o "visita" (casa).
 * La API real ya lo dice en properties.kind ("agente"/"visita");
 * los exports de My Maps se infieren desde los campos de "description"
 * (ver infoDeVisita/descripcionAObjeto).
 *
 * @param {Object} feature
 * @param {Object|null} info
 * @returns {"inicio"|"visita"|null}
 */
function tipoDePunto(feature, info) {
  const kind = feature.properties && feature.properties.kind;
  if (kind === "agente") return "inicio";
  if (kind === "visita") return "visita";

  if (!info) return null;
  if ("Prioridad" in info) return "inicio";
  if ("NID" in info || "Agente" in info) return "visita";
  return null;
}

const ICONO_SVG_PERSONA =
  "M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.67-5.33-4-8-4z";
const ICONO_SVG_CASA = "M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z";

/**
 * Crea un ícono circular de color sólido (el color del visitador)
 * con un glifo de persona (punto de inicio) o casa (visita) adentro,
 * imitando los íconos de Google My Maps.
 *
 * @param {"inicio"|"visita"} tipo
 * @param {string} color
 * @returns {L.DivIcon}
 */
function crearIconoPunto(tipo, color) {
  const path = tipo === "inicio" ? ICONO_SVG_PERSONA : ICONO_SVG_CASA;
  return L.divIcon({
    className: "marcador-icono",
    html: `<span class="marcador-punto" style="background:${color}">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="#fff"><path d="${path}"/></svg>
    </span>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -15],
  });
}

/**
 * Arma el contenido del popup de una visita: dirección, NID,
 * agente, hora y duración, igual a la ficha que muestra Google
 * My Maps al hacer clic en una casa.
 *
 * @param {Object} feature
 * @param {Object} info
 * @returns {HTMLElement}
 */
function crearPopupVisita(feature, info) {
  const props = feature.properties || {};
  const contenedor = document.createElement("div");
  contenedor.className = "popup-visita";

  const titulo = document.createElement("h3");
  titulo.textContent = props.direccion || props.name || props.id || "Visita";
  contenedor.appendChild(titulo);

  const etiquetas = {
    Agente: "Agente",
    NID: "NID",
    Tipo: "Tipo",
    Direccion: "Dirección",
    Hora: "Hora",
    Duracion: "Duración",
  };

  const lista = document.createElement("dl");
  for (const [clave, etiqueta] of Object.entries(etiquetas)) {
    const valor = info && info[clave];
    if (valor === undefined || valor === null || valor === "") continue;
    const dt = document.createElement("dt");
    dt.textContent = etiqueta;
    const dd = document.createElement("dd");
    dd.textContent = valor;
    lista.append(dt, dd);
  }
  contenedor.appendChild(lista);

  return contenedor;
}

/**
 * Popup simple para el punto de inicio de un visitador (ícono de persona).
 *
 * @param {Object} feature
 * @returns {HTMLElement}
 */
function crearPopupInicio(feature) {
  const props = feature.properties || {};
  const contenedor = document.createElement("div");
  contenedor.className = "popup-visita";

  const titulo = document.createElement("h3");
  titulo.textContent = props.nombre || props.name || "Inicio de ruta";
  contenedor.appendChild(titulo);

  return contenedor;
}

/**
 * Muestra una leyenda con el nombre y color de cada visitador.
 * La API real lo marca con kind === "agente" (nombre + color
 * directos); los exports de My Maps se detectan por el nombre
 * "COD - NOMBRE" del punto de partida. Si no hay visitadores
 * identificables, la leyenda permanece oculta.
 *
 * @param {Object} geoJson
 */
function mostrarLeyenda(geoJson) {
  const features = geoJson.type === "FeatureCollection" ? geoJson.features : [geoJson];
  const coloresVistos = new Set();
  const visitadores = [];

  for (const feature of features) {
    const visitador = nombreYColorDeVisitador(feature);
    if (!visitador || coloresVistos.has(visitador.color)) continue;

    coloresVistos.add(visitador.color);
    visitadores.push(visitador);
  }

  const contenedor = document.getElementById("leyenda");

  if (visitadores.length === 0) {
    contenedor.hidden = true;
    return;
  }

  contenedor.replaceChildren(
    ...visitadores.map(({ nombre, color }) => {
      const item = document.createElement("div");
      item.className = "leyenda-item";

      const swatch = document.createElement("span");
      swatch.className = "leyenda-color";
      swatch.style.background = color;

      const texto = document.createElement("span");
      texto.textContent = nombre;

      item.append(swatch, texto);
      return item;
    })
  );
  contenedor.hidden = false;
}

function nombreYColorDeVisitador(feature) {
  const props = feature.properties || {};
  const color = colorDeFeature(feature);
  if (!color) return null;

  if (props.kind === "agente" && props.nombre) {
    return { nombre: props.nombre, color };
  }

  if (props.name && / - /.test(props.name)) {
    return { nombre: props.name.split(" - ").slice(1).join(" - ").trim(), color };
  }

  return null;
}

// -------------------------------------------------------------
// Manejo de estado en pantalla (carga / error / mensaje)
// -------------------------------------------------------------

function mostrarCargando(mensaje) {
  const overlay = document.getElementById("status-overlay");
  const box = overlay.querySelector(".status-box");
  const spinner = document.getElementById("status-spinner");
  const texto = document.getElementById("status-message");

  box.classList.remove("error");
  spinner.hidden = false;
  texto.textContent = mensaje;
  overlay.hidden = false;
}

function mostrarError(mensaje) {
  const overlay = document.getElementById("status-overlay");
  const box = overlay.querySelector(".status-box");
  const spinner = document.getElementById("status-spinner");
  const texto = document.getElementById("status-message");

  box.classList.add("error");
  spinner.hidden = true;
  texto.textContent = `⚠️ ${mensaje}`;
  overlay.hidden = false;
}

function ocultarStatus() {
  document.getElementById("status-overlay").hidden = true;
}

// -------------------------------------------------------------
// Simulación de API (solo para desarrollo/pruebas locales, modo
// ?id_ruta=...). Carga un GeoJSON real desde archivo local y lo
// envuelve en la misma forma que devolvería la API verdadera.
//
// El id_ruta de la URL selecciona el archivo: ?id_ruta=2026-05-12
// carga data/2026-05-12.geojson. Para probar tu propio GeoJSON,
// colócalo en data/<id_ruta>.geojson (debe ser un Feature o
// FeatureCollection válido) y navega con ese id_ruta.
// -------------------------------------------------------------

async function obtenerDatosRutaSimulada(idRuta) {
  console.info(`[simulación] cargando data/${idRuta}.geojson`);
  await esperar(800); // Latencia simulada para poder ver el estado "Cargando..."

  // Simula un id de ruta inexistente en el backend.
  if (idRuta.toLowerCase() === "inexistente") {
    throw new Error(`No se encontró la ruta "${idRuta}" en la API.`);
  }

  const geoJson = await cargarGeoJsonLocal(`data/${idRuta}.geojson`);

  return {
    status: "success",
    resultado_ruteo: {
      detalles: `Ruta optimizada para ${idRuta}`,
      mapa_geojson: geoJson,
    },
  };
}

/**
 * Carga y parsea un archivo GeoJSON servido de forma estática
 * (útil para probar con datos reales sin depender de la API).
 */
async function cargarGeoJsonLocal(rutaArchivo) {
  const respuesta = await fetch(rutaArchivo);
  if (!respuesta.ok) {
    throw new Error(`No se pudo cargar el archivo GeoJSON local "${rutaArchivo}".`);
  }
  return await respuesta.json();
}

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Arranca la app cuando el DOM está listo.
document.addEventListener("DOMContentLoaded", main);
