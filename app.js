/**
 * Visor de Rutas Logísticas
 * ---------------------------------------------------------
 * Lee ?id_ruta=... de la URL, pide el ruteo a la API,
 * extrae el GeoJSON embebido en la respuesta y lo dibuja
 * en un mapa Leaflet, ajustando el zoom a la ruta completa.
 */

// URL base de la API real. Cámbiala por tu endpoint cuando lo tengas.
const API_BASE_URL = "https://api.empresa.com/rutas";

// Referencia global al mapa (se crea una sola vez).
let mapa = null;

/**
 * Punto de entrada. Orquesta el flujo completo:
 * leer parámetro -> fetch -> extraer geojson -> dibujar.
 */
async function main() {
  const idRuta = obtenerIdRutaDesdeUrl();

  if (!idRuta) {
    mostrarError(
      "Falta el parámetro 'id_ruta' en la URL. " +
        "Agrega algo como ?id_ruta=Ruta01 al final del enlace."
    );
    return;
  }

  document.getElementById("ruta-titulo").textContent = `Ruta: ${idRuta}`;
  mapa = inicializarMapa();
  mostrarCargando(`Cargando datos de la ruta "${idRuta}"...`);

  try {
    const jsonComplejo = await obtenerDatosRuta(idRuta);
    const geoJson = procesarYExtraerGeoJson(jsonComplejo);
    dibujarRuta(geoJson);
    ocultarStatus();
  } catch (error) {
    console.error("Error al cargar la ruta:", error);
    mostrarError(error.message || "Ocurrió un error inesperado al cargar la ruta.");
  }
}

/**
 * Lee el parámetro 'id_ruta' de la query string actual.
 * @returns {string|null}
 */
function obtenerIdRutaDesdeUrl() {
  const params = new URLSearchParams(window.location.search);
  const idRuta = params.get("id_ruta");
  return idRuta && idRuta.trim() !== "" ? idRuta.trim() : null;
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
 * Obtiene los datos de ruteo desde la API para un id_ruta dado.
 *
 * NOTA: Aquí se simula la respuesta de la API para poder probar
 * el visor sin backend real. Para conectar tu API real, reemplaza
 * el cuerpo de esta función por el fetch comentado más abajo.
 *
 * @param {string} idRuta
 * @returns {Promise<Object>} JSON complejo devuelto por la API
 */
async function obtenerDatosRuta(idRuta) {
  const url = `${API_BASE_URL}/${idRuta}`;

  // --- Implementación real (descomentar al conectar tu API) ---
  // const respuesta = await fetch(url);
  // if (!respuesta.ok) {
  //   throw new Error(`La API respondió con estado ${respuesta.status} para "${idRuta}".`);
  // }
  // return await respuesta.json();

  // --- Simulación (para desarrollo/demo sin backend) ---
  return simularFetchApi(idRuta, url);
}

/**
 * Recibe el JSON completo de la API y extrae únicamente
 * el objeto GeoJSON anidado en resultado_ruteo.mapa_geojson.
 *
 * @param {Object} jsonComplejo
 * @returns {Object} GeoJSON válido
 */
function procesarYExtraerGeoJson(jsonComplejo) {
  if (!jsonComplejo || jsonComplejo.status !== "success") {
    throw new Error("La API no devolvió un resultado exitoso ('status' distinto de 'success').");
  }

  const geoJson = jsonComplejo?.resultado_ruteo?.mapa_geojson;

  if (!geoJson || typeof geoJson !== "object") {
    throw new Error("La respuesta de la API no contiene un GeoJSON válido en 'resultado_ruteo.mapa_geojson'.");
  }

  return geoJson;
}

const COLOR_POR_DEFECTO = "#2563eb";

/**
 * Dibuja el GeoJSON de la ruta en el mapa, coloreando cada
 * visitador con su propio color (si el GeoJSON lo trae, como
 * en los exports de Google My Maps), y ajusta el zoom para
 * encuadrar toda la geometría (fitBounds).
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
      const info = descripcionAObjeto(feature.properties && feature.properties.description);
      const tipo = tipoDePunto(info);

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

  const bounds = capaRuta.getBounds();
  if (bounds.isValid()) {
    mapa.fitBounds(bounds, { padding: [50, 50] });
  } else {
    throw new Error("El GeoJSON de la ruta no tiene coordenadas válidas para encuadrar.");
  }

  mostrarLeyenda(geoJson);
}

/**
 * Determina el color de un feature a partir de las propiedades
 * que exporta Google My Maps (stroke / styleUrl).
 *
 * Los exports de My Maps codifican el color del ícono correctamente,
 * pero el color de línea (stroke y styleUrl de las líneas) viene con
 * los canales rojo y azul invertidos — un bug conocido de la
 * conversión KML -> GeoJSON. Por eso las líneas se corrigen aquí
 * para que coincidan visualmente con el color real del visitador.
 *
 * @param {Object} feature
 * @returns {string|null} color en formato "#rrggbb", o null si no hay info de color
 */
function colorDeFeature(feature) {
  const props = feature.properties || {};
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
 * Clasifica un punto según los campos que trae su descripción:
 * los puntos de inicio de cada visitador traen "Prioridad", y
 * las visitas traen "NID"/"Agente" (ver descripcionAObjeto).
 *
 * @param {Object|null} info
 * @returns {"inicio"|"visita"|null}
 */
function tipoDePunto(info) {
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
  const contenedor = document.createElement("div");
  contenedor.className = "popup-visita";

  const titulo = document.createElement("h3");
  titulo.textContent = (feature.properties && feature.properties.name) || "Visita";
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
    if (!info[clave]) continue;
    const dt = document.createElement("dt");
    dt.textContent = etiqueta;
    const dd = document.createElement("dd");
    dd.textContent = info[clave];
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
  const contenedor = document.createElement("div");
  contenedor.className = "popup-visita";

  const titulo = document.createElement("h3");
  titulo.textContent = (feature.properties && feature.properties.name) || "Inicio de ruta";
  contenedor.appendChild(titulo);

  return contenedor;
}

/**
 * Muestra una leyenda con el nombre y color de cada visitador,
 * detectados a partir de los puntos con nombre "COD - NOMBRE"
 * (el formato que usa Google My Maps para el punto de partida
 * de cada visitador). Si no hay visitadores identificables,
 * la leyenda permanece oculta.
 *
 * @param {Object} geoJson
 */
function mostrarLeyenda(geoJson) {
  const features = geoJson.type === "FeatureCollection" ? geoJson.features : [geoJson];
  const coloresVistos = new Set();
  const visitadores = [];

  for (const feature of features) {
    const nombre = feature.properties && feature.properties.name;
    if (!nombre || !/ - /.test(nombre)) continue;

    const color = colorDeFeature(feature);
    if (!color || coloresVistos.has(color)) continue;

    coloresVistos.add(color);
    visitadores.push({ nombre: nombre.split(" - ").slice(1).join(" - ").trim(), color });
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
// Simulación de API (solo para desarrollo/pruebas locales).
// En vez de generar coordenadas aleatorias, carga un GeoJSON
// real desde archivo local y lo envuelve en la misma forma
// que devolvería la API verdadera. Así se prueba el flujo
// completo (fetch -> extracción -> dibujo) con datos reales.
//
// El id_ruta de la URL selecciona el archivo: ?id_ruta=2026-05-12
// carga data/2026-05-12.geojson. Para probar tu propio GeoJSON,
// colócalo en data/<id_ruta>.geojson (debe ser un Feature o
// FeatureCollection válido) y navega con ese id_ruta.
// -------------------------------------------------------------

async function simularFetchApi(idRuta, urlSimulada) {
  console.info(`[simulación] GET ${urlSimulada}`);
  await esperar(800); // Latencia simulada para poder ver el estado "Cargando..."

  // Simula un id de ruta inexistente en el backend.
  if (idRuta.toLowerCase() === "inexistente") {
    throw new Error(`No se encontró la ruta "${idRuta}" en la API.`);
  }

  const geoJson = await cargarGeoJsonLocal(`data/${idRuta}.geojson`);

  return {
    status: "success",
    metadata: { fecha: "2026-07-21" },
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
