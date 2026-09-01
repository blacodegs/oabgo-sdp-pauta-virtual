/* ══════════════════════════════════════════════════════════════
   votacao.js — SDP-OAB/GO
   Funções da aba "Votação Individual"
══════════════════════════════════════════════════════════════ */

let _votacaoFichaId = null;
let _pollingVotantesVotacao = null;

async function iniciarVotacao() {
  var estadoEl = document.getElementById('votacaoEstado');
  var mainEl   = document.getElementById('votacaoMain');

  if (estadoEl) { estadoEl.style.display = 'flex'; estadoEl.className = 'estado loading'; }
  if (mainEl)   mainEl.style.display = 'none';

  try {
    // 1. Busca o estado ativo do tipo "Processo em votação"
    var estado = await gasGet({ acao: 'estadoAtivo' });
    if (!estado.processoVotacao) {
      if (estadoEl) {
        estadoEl.className = 'estado vazio';
        estadoEl.innerHTML = '<i class="material-icons">how_to_vote</i><p>Nenhum processo em votação no momento.</p>';
      }
      return;
    }

    _votacaoFichaId = estado.processoVotacao;

    // 2. Carrega membros + dados da votação
    var [dadosVotacao] = await Promise.all([
      gasGet({ acao: 'infoVotacao', fichaId: _votacaoFichaId }),
      carregarMembros()
    ]);

    if (!dadosVotacao.sucesso) throw new Error(dadosVotacao.erro || 'Erro ao carregar dados.');

    // 3. Renderiza o banner da sessão (título + metadados)
    document.getElementById('votacaoTitulo').textContent = dadosVotacao.titulo || 'Votação';

    var infoSessao = dadosVotacao.sessaoInfo || {};
    var dataHtml = '';

    // 3.1 Ordem da sessão (ex.: 13ª Sessão)
    if (infoSessao.ordemOrdinal) {
      dataHtml += '<i class="material-icons" style="font-size:16px">gavel</i> ' + infoSessao.ordemOrdinal + ' Sessão';
    }

    // 3.2 Data da sessão
    if (dadosVotacao.dataSessao) {
      dataHtml += (dataHtml ? ' &nbsp;·&nbsp; ' : '') +
        '<i class="material-icons" style="font-size:16px">event</i> ' + dadosVotacao.dataSessao;
    }

    // 3.3 Órgão da sessão
    if (dadosVotacao.orgao) {
      dataHtml += (dataHtml ? ' &nbsp;·&nbsp; ' : '') + dadosVotacao.orgao;
    }

    document.getElementById('votacaoData').innerHTML = dataHtml;

    // 4. Renderiza cabeçalho do processo (requerente, requerido, ementa)
    var cabecalhoEl = document.getElementById('votacaoCabecalho');
    if (cabecalhoEl && dadosVotacao) {
      var html = '';
      if (dadosVotacao.requerente) html += '<div class="votacao-info-linha"><span class="votacao-rotulo">Requerente</span><span class="votacao-valor">' + dadosVotacao.requerente + '</span></div>';
      if (dadosVotacao.requerido) html += '<div class="votacao-info-linha"><span class="votacao-rotulo">Requerido</span><span class="votacao-valor">' + dadosVotacao.requerido + '</span></div>';
      if (dadosVotacao.ementa) html += '<div class="votacao-info-linha votacao-ementa"><span class="votacao-rotulo">Ementa</span><span class="votacao-valor">' + dadosVotacao.ementa + '</span></div>';
      cabecalhoEl.innerHTML = html;
    }

    // 5. Renderiza exposição dos votos
    renderExposicaoVotos(dadosVotacao.votos || []);

    // 6. Renderiza formulário de votação
    renderFormularioVotacao(dadosVotacao.opcoesVoto || []);

    // 7. Extrai o idSessao a partir do sessaoInfo
    var idSessao = (dadosVotacao.sessaoInfo && dadosVotacao.sessaoInfo.id) ? dadosVotacao.sessaoInfo.id : '';

    // 8. Carrega membros que já votaram pela primeira vez e inicia polling
    if (idSessao) {
      await atualizarVotantesVotacao(idSessao);

      // Inicia polling automático a cada 15 segundos
      if (_pollingVotantesVotacao) clearInterval(_pollingVotantesVotacao);
      _pollingVotantesVotacao = setInterval(function() {
        if (_abaAtiva === 'votacao' && _votacaoFichaId && idSessao) {
          atualizarVotantesVotacao(idSessao);
        }
      }, 15000);
    } else {
      console.warn('[votacao] idSessao não encontrado em dadosVotacao.');
    }

    // 9. Exibe a interface
    if (estadoEl) estadoEl.style.display = 'none';
    if (mainEl)   mainEl.style.display = 'block';

  } catch (err) {
    console.error('[votacao] erro:', err);
    if (estadoEl) {
      estadoEl.className = 'estado erro';
      estadoEl.innerHTML = '<i class="material-icons">error_outline</i><p>Não foi possível carregar os dados.<br>' + err.message + '</p>';
    }
  }
}

function renderExposicaoVotos(votos) {
  var container = document.getElementById('votacaoVotos');
  if (!container) return;

  if (!votos.length) {
    container.innerHTML = '<div class="mv-empty">Nenhum voto registrado para esta ficha.</div>';
    return;
  }

  var html = '';
  votos.forEach(function(v) {
    var textoLimpo = (v.texto || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();
    html +=
      '<div class="voto-exposicao-card">' +
        '<div class="voto-exposicao-header">' +
          '<span class="voto-exposicao-tipo">' + (v.tipo || 'Voto').toUpperCase() + '</span>' +
          '<span class="voto-exposicao-relator">' + (v.relator || '—') + '</span>' +
        '</div>' +
        '<div class="voto-exposicao-body">' +
          '<p class="voto-exposicao-texto">' + textoLimpo + '</p>' +
        '</div>' +
      '</div>';
  });
  container.innerHTML = html;
}

function renderFormularioVotacao(opcoes) {
  var container = document.getElementById('votacaoOpcoes');
  if (!container) return;

  var html = '';
  opcoes.forEach(function(opcao) {
    html +=
      '<label class="opcao-voto-label" onclick="selecionarVoto(this)">' +
        '<input type="radio" name="votacaoOpcao" value="' + opcao + '">' +
        opcao +
      '</label>';
  });
  container.innerHTML = html;

  // Limpa o campo de busca e oculta chip/lista
  var input = document.getElementById('votacaoSelectNome');
  if (input) {
    input.value = '';
    input.removeAttribute('data-nome-selecionado');
    input.style.display = 'block';
  }
  var chipEl = document.getElementById('votante-chip-votacao');
  if (chipEl) { chipEl.innerHTML = ''; chipEl.style.display = 'none'; }
  var listaEl = document.getElementById('lista-votantes-votacao');
  if (listaEl) { listaEl.innerHTML = ''; listaEl.style.display = 'none'; }

  document.getElementById('btnConfirmarVotacao').onclick = confirmarVotoIndividual;
}

async function confirmarVotoIndividual() {
  var input = document.getElementById('votacaoSelectNome');
  var nome = input ? (input.getAttribute('data-nome-selecionado') || '').trim() : '';
  var radioSel = document.querySelector('input[name="votacaoOpcao"]:checked');

  if (!nome) { toast('Selecione seu nome na lista.', 'erro'); return; }
  if (!radioSel) { toast('Selecione uma opção de voto.', 'erro'); return; }

  var btn = document.getElementById('btnConfirmarVotacao');
  btn.disabled = true;
  btn.innerHTML = '<i class="material-icons" style="font-size:15px;animation:spin 1s linear infinite">autorenew</i> Registrando…';

  try {
    await gasPost({ acao: 'votar', nome: nome, voto: radioSel.value, idFicha: _votacaoFichaId });
    toast('Voto registrado com sucesso!');

    // Limpa o campo e a lista
    if (input) {
      input.value = '';
      input.removeAttribute('data-nome-selecionado');
      input.style.display = 'block';
    }
    var chipEl = document.getElementById('votante-chip-votacao');
    if (chipEl) { chipEl.innerHTML = ''; chipEl.style.display = 'none'; }
    var listaEl = document.getElementById('lista-votantes-votacao');
    if (listaEl) { listaEl.innerHTML = ''; listaEl.style.display = 'none'; }

    document.querySelectorAll('input[name="votacaoOpcao"]').forEach(function(r) {
      r.checked = false;
      var p = r.closest('.opcao-voto-label');
      if (p) p.classList.remove('selecionada');
    });

  } catch (err) {
    toast('Erro ao registrar voto.', 'erro');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="material-icons" style="font-size:15px">check</i> Confirmar voto';
  }
}

function filtrarVotantesVotacao() {
  var input = document.getElementById('votacaoSelectNome');
  var listaEl = document.getElementById('lista-votantes-votacao');
  if (!input || !listaEl) return;

  var termo = input.value.trim().toLowerCase();
  var nomes = Object.keys(_membrosCache).sort(function(a, b) { return a.localeCompare(b, 'pt-BR'); });

  if (!termo) {
    listaEl.innerHTML = '';
    listaEl.style.display = 'none';
    return;
  }

  var filtrados = nomes.filter(function(nome) { return nome.toLowerCase().indexOf(termo) !== -1; });

  if (filtrados.length === 0) {
    listaEl.innerHTML = '<div class="votante-opcao" style="color:var(--oab-cinza-md);font-style:italic;">Nenhum membro encontrado</div>';
    listaEl.style.display = 'block';
    return;
  }

  var html = '';
  filtrados.forEach(function(nome) {
    html +=
      '<label class="votante-opcao">' +
        '<input type="radio" name="votacao-votante" value="' + nome + '" onchange="selecionarVotanteVotacao(this.value)">' +
        '<span>' + nome + '</span>' +
      '</label>';
  });
  listaEl.innerHTML = html;
  listaEl.style.display = 'block';
}

function selecionarVotanteVotacao(nome) {
  var input = document.getElementById('votacaoSelectNome');
  var chipEl = document.getElementById('votante-chip-votacao');
  var listaEl = document.getElementById('lista-votantes-votacao');

  if (input) {
    input.value = nome;
    input.setAttribute('data-nome-selecionado', nome);
    input.style.display = 'none';
  }

  if (chipEl) {
    chipEl.innerHTML =
      '<span class="chip-nome">' + nome + '</span>' +
      '<span class="chip-remover" onclick="removerVotanteVotacao()" title="Remover">×</span>';
    chipEl.style.display = 'inline-flex';
  }

  if (listaEl) {
    listaEl.innerHTML = '';
    listaEl.style.display = 'none';
  }
}

function removerVotanteVotacao() {
  var input = document.getElementById('votacaoSelectNome');
  var chipEl = document.getElementById('votante-chip-votacao');
  var listaEl = document.getElementById('lista-votantes-votacao');

  if (input) {
    input.value = '';
    input.removeAttribute('data-nome-selecionado');
    input.style.display = 'block';
    input.focus();
  }

  if (chipEl) {
    chipEl.innerHTML = '';
    chipEl.style.display = 'none';
  }

  if (listaEl) {
    listaEl.innerHTML = '';
    listaEl.style.display = 'none';
  }
}

async function atualizarVotantesVotacao(sessaoId) {
  if (!sessaoId || !_votacaoFichaId) return;
  try {
    var data = await gasGet({ acao: 'votantes', sessaoId: sessaoId });
    var votantes = (data && data.votantes) ? (data.votantes[_votacaoFichaId] || []) : [];
    renderChipsVotantesVotacao(votantes);
  } catch (err) {
    console.warn('[votacao] erro ao atualizar votantes:', err.message);
  }
}

function renderChipsVotantesVotacao(lista) {
  var chipsEl    = document.getElementById('votacaoChips');
  var contagemEl = document.getElementById('votacaoContagem');

  if (contagemEl) contagemEl.textContent = lista.length;
  if (!chipsEl) return;

  if (!lista.length) {
    chipsEl.innerHTML = '<span class="presenca-vazio">Nenhum voto registrado ainda.</span>';
    return;
  }

  chipsEl.innerHTML = lista.map(function(nome) {
    return '<span class="chip-presente"><i class="material-icons">check_circle</i>' + nome + '</span>';
  }).join('');
}