// Clasifica cada partido de La Quiniela en una competicion para la pestaña
// Estadisticas. Se usan los nombres de equipo tal como los escribe Eduardo
// Losilla ("ATH.CLUB", "REP.CHECA", "BARCELONA (F)") y su codigo "division":
//   1 = Primera, 2 y 3 = Segunda, 4 = liga extranjera, 5 = selecciones o
//   competiciones europeas, 10 = femenino.
// Ojo: Losilla a veces pone division 1 a partidos europeos con equipo español
// en casa (R.MADRID-INTER), asi que se mira tambien si hay un club extranjero.

const COMPETICIONES = {
  primera: 'Primera',
  segunda: 'Segunda',
  femenino: 'Femenino',
  selecciones: 'Selecciones',
  europa: 'Europa',
  copa: 'Copa',
  otras: 'Otras ligas',
};

function normalizar(nombre) {
  return String(nombre || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]/g, '');
}

const NACIONES = new Set([
  'ALBANIA', 'ALEMANIA', 'ANDORRA', 'ARMENIA', 'AUSTRIA', 'AZERBAIYAN', 'BELGICA', 'BIELORRUSIA', 'BOSNIA',
  'BULGARIA', 'CHIPRE', 'CROACIA', 'DINAMARCA', 'ESCOCIA', 'ESLOVAQUIA', 'ESLOVENIA', 'ESPANA', 'ESTONIA',
  'FEROE', 'ISLASFEROE', 'FINLANDIA', 'FRANCIA', 'GALES', 'GEORGIA', 'GIBRALTAR', 'GRECIA', 'HOLANDA',
  'PAISESBAJOS', 'HUNGRIA', 'INGLATERRA', 'IRLANDA', 'IRLANDAN', 'IRLANDADELNORTE', 'REPIRLANDA', 'ISLANDIA',
  'ISRAEL', 'ITALIA', 'KAZAJISTAN', 'KOSOVO', 'LETONIA', 'LIECHTENSTEIN', 'LITUANIA', 'LUXEMBURGO',
  'MACEDONIA', 'MACEDONIAN', 'MACEDONIADELNORTE', 'MALTA', 'MOLDAVIA', 'MONTENEGRO', 'NORUEGA', 'POLONIA',
  'PORTUGAL', 'REPCHECA', 'CHEQUIA', 'RUMANIA', 'RUSIA', 'SANMARINO', 'SERBIA', 'SUECIA', 'SUIZA', 'TURQUIA',
  'UCRANIA', 'ARGENTINA', 'BRASIL', 'URUGUAY', 'COLOMBIA', 'CHILE', 'PERU', 'ECUADOR', 'PARAGUAY', 'MEXICO',
  'EEUU', 'ESTADOSUNIDOS', 'CANADA', 'MARRUECOS', 'ARGELIA', 'TUNEZ', 'EGIPTO', 'SENEGAL', 'NIGERIA',
  'CAMERUN', 'GHANA', 'COSTADEMARFIL', 'JAPON', 'COREADELSUR', 'COREA', 'AUSTRALIA', 'ARABIASAUDI', 'IRAN',
  'QATAR', 'CATAR', 'IRAK', 'JORDANIA', 'CABOVERDE', 'NUEVAZELANDA', 'PANAMA', 'COSTARICA', 'HONDURAS',
  'JAMAICA', 'HAITI', 'CURAZAO', 'BOLIVIA', 'VENEZUELA', 'SUDAFRICA', 'UZBEKISTAN', 'MALI', 'RDCONGO',
].map(normalizar));

// Clubes españoles (Primera, Segunda y los que suelen salir en Copa). Si un
// club no esta aqui y juega contra uno que si, se considera extranjero.
const CLUBES_ESPANOLES = new Set([
  'ALAVES', 'ALBACETE', 'ALCORCON', 'ALMERIA', 'ANDORRAFC', 'ATHCLUB', 'ATHLETICCLUB', 'ATMADRID',
  'ATLETICODEMADRID', 'BARCELONA', 'BARCELONAATH', 'BETIS', 'BURGOS', 'CADIZ', 'CARTAGENA', 'CASTELLON',
  'CELTA', 'CELTAFORTUNA', 'CEUTA', 'CLEONESA', 'CULTURALLEONESA', 'CORDOBA', 'DEPORTIVO', 'EIBAR', 'ELCHE',
  'ELDENSE', 'ESPANYOL', 'FERROL', 'RACINGF', 'RACINGFERROL', 'FUENLABRADA', 'GETAFE', 'GIRONA', 'GIMNASTIC',
  'GRANADA', 'GUADALAJARA', 'HUESCA', 'IBIZA', 'LASPALMAS', 'LEGANES', 'LEVANTE', 'LUGO', 'MALAGA', 'MALLORCA',
  'MIRANDES', 'MURCIA', 'NAVALCARNERO', 'OSASUNA', 'PONFERRADINA', 'RMADRID', 'REALMADRID', 'RMADRIDCASTILLA',
  'ROVIEDO', 'REALOVIEDO', 'RSOCIEDAD', 'REALSOCIEDAD', 'RSOCIEDADB', 'REALSOCIEDADB', 'RZARAGOZA', 'ZARAGOZA',
  'RACINGS', 'RACINGDESANTANDER', 'RAYO', 'RAYOVALLECANO', 'SABADELL', 'SEVILLA', 'SPORTING', 'TENERIFE',
  'VALENCIA', 'VALLADOLID', 'RVALLADOLID', 'VILLARREAL', 'VILLARREALB', 'AMOREBIETA', 'ALCOYANO', 'LOGRONES',
  'SDLOGRONES', 'TALAVERA',
].map(normalizar));

function clasificar(local, visitante, division) {
  const l = normalizar(local);
  const v = normalizar(visitante);
  const div = Number(division);
  if (/\(F\)/i.test(`${local} ${visitante}`) || div === 10) return 'femenino';
  if ((NACIONES.has(l) && NACIONES.has(v)) || l === 'ESPANA' || v === 'ESPANA') return 'selecciones';
  // En division 5 un club nunca juega contra una seleccion: con una basta
  if (div === 5 && (NACIONES.has(l) || NACIONES.has(v))) return 'selecciones';
  if (div === 4) return 'otras';
  if (div === 5) return 'europa';
  const espanoles = Number(CLUBES_ESPANOLES.has(l)) + Number(CLUBES_ESPANOLES.has(v));
  if (espanoles === 2) return div === 1 ? 'primera' : 'segunda';
  // Un club español contra uno desconocido: en division 1 suele ser Champions
  // en casa; en 2 o 3, un rival de Copa de categoria inferior
  if (espanoles === 1) return div === 1 ? 'europa' : 'copa';
  return div === 1 || div === 2 || div === 3 ? 'otras' : 'europa';
}

module.exports = { COMPETICIONES, clasificar };
