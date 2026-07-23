/* ══════════════════════════════════════════════════════════════
   scripts.js — SDP-OAB/GO
   Globais: config, estado, navegação, rede, membros, utilidades
══════════════════════════════════════════════════════════════ */

/* ── CONFIG ─────────────────────────────────────────────────── */
const GAS_ENDPOINT = 'https://script.google.com/macros/s/AKfycbx91dyMa69vT0704BsR9iPiGhLBq884oViaLtepDYF_mWCM3RzJcqyHCPcG5-Chd-Pp/exec';
const URL_LOGO_OAB        = 'https://www.oabgo.org.br/wp-content/themes/oab/images/logo.png';
const URL_LOGO_RODAPE     = 'https://www.oabgo.org.br/wp-content/themes/oab/images/logo-rodape.png';
const URL_QR_PRESENCA     = 'https://blakodegs.github.io/oabgo-sdp-pauta-virtual/?aba=presenca';
const URL_QR_IMAGEM       = 'https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=' +
                             encodeURIComponent(URL_QR_PRESENCA) + '&color=002d56&bgcolor=ffffff';

console.log('[scripts.js] carregado');

/* ── ESTADO GLOBAL ──────────────────────────────────────────── */
let _sessaoId           = null;   // sessão da pauta virtual
let _sessaoPresencaId   = null;   // sessão da coleta de nomes
let _votantesCache      = {};
let _votosPorFichaCache = {};
let _mvFichaId          = null;
let _mvExpandido        = null;
let _mvPdfPendente      = null;
let _mvFichaInfo        = {};
let _mvVotosCache       = [];
let _orgaoSessao        = '';
let _membrosCache       = {};     // { "Nome": "Masculino"|"Feminino" }
let _participantesCache = [];     // nomes já presentes na sessão
let _abaAtiva           = 'presenca';
let _pollingPresenca    = null;   // intervalo de polling da aba 1

/* ══════════════════════════════════════════════════════════════
   NAVEGAÇÃO POR ABAS
══════════════════════════════════════════════════════════════ */
function trocarAba(novaAba, el) {
  // Remove classe ativa de todos
  document.querySelectorAll('.aba-item').forEach(function(i) { i.classList.remove('ativa'); });
  document.querySelectorAll('.aba-panel').forEach(function(p) { p.classList.remove('ativa'); });

  // Ativa a aba clicada
  if (el) el.classList.add('ativa');
  var panel = document.getElementById('aba-' + novaAba);
  if (panel) panel.classList.add('ativa');

  _abaAtiva = novaAba;

  // Inicializa a aba se ainda não foi carregada
  if (novaAba === 'presenca' && !_sessaoPresencaId) {
    iniciarPresenca();
  }
  if (novaAba === 'votacao' && !window._votacaoIniciada) {
    window._votacaoIniciada = true;
    iniciarVotacao();
  }
  if (novaAba === 'pauta' && !_sessaoId) {
    iniciarPauta();
  }

  // Atualiza a URL para deep linking (?aba=presenca etc.)
  var url = new URL(window.location.href);
  url.searchParams.set('aba', novaAba);
  window.history.replaceState({}, '', url.toString());
}

/* ══════════════════════════════════════════════════════════════
   UTILITÁRIOS
══════════════════════════════════════════════════════════════ */
function toast(msg, tipo) {
  tipo = tipo || 'sucesso';
  var c = document.getElementById('toastContainer');
  var d = document.createElement('div');
  d.className = 'toast ' + tipo;
  d.innerHTML = '<i class="material-icons">' + (tipo === 'sucesso' ? 'check_circle' : 'error') + '</i>' + msg;
  c.appendChild(d);
  setTimeout(function() { d.remove(); }, 4000);
}

function fecharModal(id) { document.getElementById(id).classList.remove('ativo'); }

function esc(s) { return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

/* ══════════════════════════════════════════════════════════════
   CAMADA DE REDE
══════════════════════════════════════════════════════════════ */
var _jsonpSeq = 0;

function jsonpGet(params) {
  return new Promise(function(resolve, reject) {
    var cbName = '__gasCallback_' + (++_jsonpSeq);
    var qs     = new URLSearchParams(params).toString();
    var url    = GAS_ENDPOINT + '?' + qs + '&callback=' + cbName;
    var script = document.createElement('script');
    var timer  = setTimeout(function() { reject(new Error('Timeout JSONP')); cleanup(); }, 30000);
    function cleanup() {
      clearTimeout(timer);
      delete window[cbName];
      if (script.parentNode) script.parentNode.removeChild(script);
    }
    window[cbName] = function(data) { resolve(data); cleanup(); };
    script.onerror = function() { reject(new Error('Falha na requisição')); cleanup(); };
    script.src = url;
    document.head.appendChild(script);
  });
}

async function gasGet(params) {
  var data = await jsonpGet(params);
  if (data.erro) throw new Error(data.erro);
  return data;
}

async function gasGetSilent(params, fallback) {
  try {
    var data = await jsonpGet(params);
    if (data.erro) { console.warn('gasGetSilent:', data.erro); return fallback; }
    return data;
  } catch (err) {
    console.warn('gasGetSilent falhou:', err.message);
    return fallback;
  }
}

async function gasPost(body) {
  await fetch(GAS_ENDPOINT, {
    method : 'POST',
    mode   : 'no-cors',
    headers: { 'Content-Type': 'application/json' },
    body   : JSON.stringify(body),
  });
}

async function gasPostViaGet(body) {
  var data = await jsonpGet({ payload: JSON.stringify(body) });
  if (data.erro) throw new Error(data.erro);
  return data;
}

/* ══════════════════════════════════════════════════════════════
   MEMBROS — carregamento compartilhado
══════════════════════════════════════════════════════════════ */
async function carregarMembros() {
  try {
    var data = await gasGet({ acao: 'membros' });
    _membrosCache = {};
    (data.membros || []).forEach(function(m) {
      if (m.nome) _membrosCache[m.nome] = m.genero || 'Masculino';
    });
    console.log('[membros] carregados:', Object.keys(_membrosCache).length);
  } catch (err) {
    console.warn('[membros] erro ao carregar:', err.message);
  }
}

function getMembrosAutocompleteData() {
  const data = {};
  Object.keys(_membrosCache).forEach(nome => { data[nome] = null; });
  return data;
}

/* ══════════════════════════════════════════════════════════════
   INICIALIZAÇÃO GERAL
══════════════════════════════════════════════════════════════ */
// Inicialização adiada para depois que todos os scripts carregarem
window.addEventListener('load', function() {
  var params  = new URLSearchParams(window.location.search);
  var abaNaUrl = params.get('aba') || 'presenca';
  var abaItem  = document.querySelector('[data-aba="' + abaNaUrl + '"]');

  if (abaItem) {
    trocarAba(abaNaUrl, abaItem);
  } else {
    trocarAba('presenca', document.querySelector('[data-aba="presenca"]'));
  }
});

function definirConstantesVisuais() {
  var logos = document.querySelectorAll('.oab-logo-dinamico');
  for (var i = 0; i < logos.length; i++) {
    logos[i].src = URL_LOGO_OAB;
  }
  var logoRodape = document.getElementById('logoRodape');
  if (logoRodape) logoRodape.src = URL_LOGO_RODAPE;

  var qrImg = document.getElementById('qrImagem');
  if (qrImg) qrImg.src = URL_QR_IMAGEM;
  var qrUrl = document.getElementById('qrUrl');
  if (qrUrl) qrUrl.textContent = URL_QR_PRESENCA;

  console.log('[constantes visuais] aplicadas');
}

// Executa imediatamente
definirConstantesVisuais();

// Segunda tentativa após um delay (para cobrir renderização tardia de abas)
setTimeout(definirConstantesVisuais, 500);

function initAutocompleteOnFocus(inputEl) {
  if (!inputEl || inputEl.hasAttribute('data-autocomplete-inited')) return;

  function ativar() {
    M.Autocomplete.init(inputEl, {
      data: getMembrosAutocompleteData(),
      minLength: 2,
      limit: 10
    });
    inputEl.setAttribute('data-autocomplete-inited', 'true');
    inputEl.addEventListener('blur', function() {
      var valor = inputEl.value.trim();
      if (valor && !_membrosCache[valor]) {
        inputEl.value = '';
        var instance = M.Autocomplete.getInstance(inputEl);
        if (instance) instance.close();
      }
    });
    inputEl.removeEventListener('focus', ativar);
  }

  inputEl.addEventListener('focus', ativar);
}