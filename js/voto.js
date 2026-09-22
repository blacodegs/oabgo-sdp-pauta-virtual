/* ══════════════════════════════════════════════════════════════
   voto.js — Página dedicada de voto (SDP-OAB/GO)
   Apenas o que é específico da página: leitura do fichaId,
   requisição única ao backend e renderização inicial.
   Toda a lógica de manipulação de votos vem de pauta.js.
══════════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', function() {
  const params = new URLSearchParams(window.location.search);
  const fichaId = params.get('fichaId');

  if (!fichaId) {
    mostrarEstadoErro(
      'Link inválido: informe o parâmetro <strong>fichaId</strong> na URL.'
    );
    return;
  }

  // Atribui ao global do pauta.js (sem redeclarar)
  _mvFichaId = fichaId;

  // 1º: dados — não pode ser interrompido por falha de UI da Materialize
  carregarTudo();

  // 2º: listener de colagem do editor de "novo voto" (o card já existe
  // estaticamente em voto.html, então isso só precisa rodar uma vez)
  mvInicializarEditorNovoVoto();

  // 3º: inicialização de componentes Materialize (tooltips, dropdowns etc.)
  // isolada — se falhar, não deve derrubar o carregamento dos dados acima
  try {
    if (typeof M !== 'undefined') {
      M.AutoInit();
    } else {
      console.warn('[voto.js] Materialize (M) ainda não disponível — pulando AutoInit.');
    }
  } catch (err) {
    console.error('[voto.js] Erro em M.AutoInit():', err);
  }
});

/**
 * Fluxo de carregamento da página de voto.
 * Ordem:
 *   1. Mostra estado "loading" (lista + esconde botões)
 *   2. Busca dados no backend
 *   3. Em sucesso: renderiza e libera os botões
 *   4. Em erro: mostra estado de erro e mantém botões escondidos
 */
async function carregarTudo() {
  mostrarEstadoCarregando();

  try {
    const res = await gasGet({ acao: 'votoPage', fichaId: _mvFichaId });
    if (!res.sucesso) throw new Error(res.erro || 'Erro ao carregar.');

    _mvFichaInfo  = (res.fichaInfo && typeof res.fichaInfo === 'object') ? res.fichaInfo : {};
    _mvVotosCache = res.votos || [];
    _mvMembros    = res.membros || [];

    // ── Popula o cache global de membros usado pelos filtros/autocomplete ──
    // (filtrarRelatoresNovoVoto e outros leem de _membrosCache)
    _membrosCache = {};
    _mvMembros.forEach(function(nome) {
      if (nome) _membrosCache[nome] = 'Masculino';   // votoPage só devolve nomes, sem gênero
    });

    renderBannerVoto(_mvFichaInfo);
    mvRenderLista(_mvVotosCache);
    liberarBotaoAdicionar();

  } catch (err) {
    console.error('[votoPage] erro ao carregar:', err);
    mostrarEstadoErro(err.message);
    esconderBotaoAdicionar();
  }
}

/**
 * Sobrescreve mvRenderLista() de pauta.js.
 * A versão original grava em '#mvBody' (container do MODAL, em index.html).
 * Nesta página standalone a lista vai em '#mvListaContainer', e o card
 * "novo voto" já existe estático no HTML — não deve ser recriado aqui,
 * senão duplicaria ids (mvNovoCard, mvNovoTipo, mvNovoRelator, mvNovoTexto...)
 * e quebraria mvMostrarFormNovo/mvFecharFormNovo/mvSalvarNovoVoto etc.
 */
function mvRenderLista(votos) {
  const body = document.getElementById('mvListaContainer');
  if (!body) return;

  var lista = (votos || []).map(function(v) {
    return {
      id: v.id,
      tipo: v.tipovoto || 'Voto',
      relator: v.relator || '',
      texto: v.voto || '',
      url: v['url relatório'] || v['url relatorio'] || ''
    };
  });

  var html = '';
  if (!lista.length) {
    html += '<div class="mv-empty">Nenhum voto registrado para esta ficha.</div>';
  } else {
    lista.forEach(function(v) {
      var pdfChip = v.url
        ? '<a href="' + v.url + '" target="_blank" class="chip-pdf-link tooltipped" data-position="bottom" title="Abrir relatório"><i class="material-icons" style="font-size:12px">picture_as_pdf</i>Relatório</a>'
        : '<button class="chip-pdf-pending tooltipped" data-position="bottom" title="Anexar relatório" onclick="mvAnexarRelatorio(\'' + esc(v.id) + '\')"><i class="material-icons" style="font-size:12px">picture_as_pdf</i>Relatório</button>';

      var textoHtml = v.texto || '';

      html +=
        '<div class="mv-voto-card" data-mvid="' + esc(v.id) + '">' +
          '<div class="mv-voto-header" onclick="mvToggle(\'' + esc(v.id) + '\')" style="cursor:pointer">' +
            '<div class="mv-voto-info"><span class="mv-voto-tipo">' + (v.tipo) + '</span><span class="mv-voto-relator">' + (v.relator || '—') + '</span></div>' +
            '<div class="mv-voto-actions" onclick="event.stopPropagation()">' + pdfChip +
              '<button class="action-icon tooltipped" data-position="bottom" title="Expandir texto do voto" onclick="mvToggle(\'' + esc(v.id) + '\')"><i class="material-icons" style="font-size:18px">expand_more</i></button>' +
            '</div>' +
          '</div>' +
          '<div class="mv-voto-body" id="mvbody-' + esc(v.id) + '"><p class="mv-voto-texto">' + textoHtml + '</p></div>' +
        '</div>';
    });
  }

  body.innerHTML = html;

  var tooltips = body.querySelectorAll('.tooltipped');
  if (typeof M !== 'undefined' && M.Tooltip) {
    M.Tooltip.init(tooltips, { enterDelay: 200, exitDelay: 100 });
  }
}

/**
 * Anexa, uma única vez, o listener de limpeza de texto colado no editor
 * de "novo voto" (#mvNovoTexto), que em voto.html é estático — diferente
 * do modal, onde é recriado a cada mvRenderLista().
 */
function mvInicializarEditorNovoVoto() {
  var editorNovo = document.getElementById('mvNovoTexto');
  if (!editorNovo || editorNovo.dataset.pasteHandlerInit) return;

  editorNovo.addEventListener('paste', function(e) {
    e.preventDefault();
    var textoColado = (e.clipboardData || window.clipboardData).getData('text/plain');
    var textoLimpo = limparTextoColado(textoColado);
    document.execCommand('insertText', false, textoLimpo);
  });

  editorNovo.dataset.pasteHandlerInit = 'true';
}

function renderBannerVoto(info) {
  const numero = info.numeroProcesso || '(sem número)';
  const data = info.dataSessaoISO
    ? new Date(info.dataSessaoISO).toLocaleDateString('pt-BR')
    : (info.dataSessao || '');
  document.getElementById('votoPageTitulo').textContent = 'Voto do processo ' + numero;
  document.getElementById('votoPageMeta').textContent = data ? ('Sessão de ' + data) : '';
}

/**
 * Mostra estado de carregamento na área da lista e esconde botões de ação.
 */
function mostrarEstadoCarregando() {
  const listaEl = document.getElementById('mvListaContainer');
  if (listaEl) {
    listaEl.innerHTML =
      '<div class="estado loading">' +
        '<i class="material-icons">autorenew</i>' +
        '<p>Carregando dados do processo…</p>' +
      '</div>';
  }

  esconderBotaoAdicionar();

  const cardNovo = document.getElementById('mvNovoCard');
  if (cardNovo) cardNovo.style.display = 'none';
}

/**
 * Mostra estado de erro e mantém os botões de ação escondidos.
 * @param {string} mensagem
 */
function mostrarEstadoErro(mensagem) {
  const listaEl = document.getElementById('mvListaContainer');
  if (listaEl) {
    listaEl.innerHTML =
      '<div class="estado erro">' +
        '<i class="material-icons">error_outline</i>' +
        '<p>' + mensagem + '</p>' +
      '</div>';
  }
  esconderBotaoAdicionar();
}

/**
 * Exibe o botão de adicionar voto (apenas após carregamento bem-sucedido).
 */
function liberarBotaoAdicionar() {
  const btn = document.getElementById('btnAddVotoSection');
  if (btn) btn.style.display = 'block';
}

/**
 * Esconde o botão de adicionar voto.
 */
function esconderBotaoAdicionar() {
  const btn = document.getElementById('btnAddVotoSection');
  if (btn) btn.style.display = 'none';
}